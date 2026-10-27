// 코드 작업 모드 도구 — 작업 폴더 안에서만 읽기·찾기·고치기, 명령은 확인 카드 뒤에만, 비밀 파일·폴더 밖은 막는다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// SDK 의 tool() 을 얇게 대체해 도구 핸들러를 직접 부른다
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => ({ name, description, schema, handler }),
  createSdkMcpServer: (o: unknown) => o
}))

const { commandEnv, createCodeTools, globToRegExp, isSecretName, resolveCodePath, runPowerShell } =
  await import('../src/main/agent/tools-code')
type CodeToolContext = import('../src/main/agent/tools-code').CodeToolContext
type CommandRunner = import('../src/main/agent/tools-code').CommandRunner

interface ToolStub {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>
}

let root: string
let outside: string
beforeEach(() => {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'noden-code-')))
  root = join(base, 'proj')
  outside = join(base, 'outside')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(
    join(root, 'src', 'app.ts'),
    'const a = 1\nexport const hello = "안녕"\nconst b = 2\n'
  )
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'export const hello = 1\n')
  writeFileSync(join(root, '.env'), 'API_KEY=secret\n')
  writeFileSync(join(root, '.git', 'config'), '[core]\n')
  writeFileSync(join(outside, 'secret.txt'), 'outside')
})
afterEach(() => rmSync(join(root, '..'), { recursive: true, force: true }))

function tools(over: Partial<CodeToolContext> = {}): {
  get: (name: string) => ToolStub
  steps: { label: string; ok: boolean }[]
  confirms: string[]
} {
  const steps: { label: string; ok: boolean }[] = []
  const confirms: string[] = []
  const list = createCodeTools({
    root,
    readOnly: false,
    confirm: async (action) => {
      confirms.push(action)
      return true
    },
    tick: () => null,
    onStep: (label, ok) => steps.push({ label, ok }),
    ...over
  }) as unknown as ToolStub[]
  return {
    get: (name) => {
      const t = list.find((x) => x.name === name)
      if (!t) throw new Error(`${name} 없음`)
      return t
    },
    steps,
    confirms
  }
}
const call = async (t: ToolStub, args: Record<string, unknown>): Promise<string> =>
  (await t.handler(args)).content[0].text

describe('resolveCodePath — 폴더 밖·비밀 파일 막기', () => {
  it('폴더 안 상대·절대 경로는 받고, 밖으로 나가는 길은 막는다', () => {
    expect(resolveCodePath(root, 'src/app.ts', false)).toMatchObject({ rel: 'src/app.ts' })
    expect(resolveCodePath(root, join(root, 'src'), false)).toMatchObject({ rel: 'src' })
    expect(resolveCodePath(root, '', false)).toMatchObject({ rel: '.' })
    expect(resolveCodePath(root, '../outside/secret.txt', false)).toEqual({
      refused: 'refused: outside the work folder'
    })
    expect(resolveCodePath(root, join(outside, 'secret.txt'), false)).toHaveProperty('refused')
    expect(resolveCodePath(root, '\\\\server\\share\\x', false)).toHaveProperty('refused')
  })

  it('비밀 파일·자격 폴더는 읽기·쓰기 모두 막고, .env 예시 파일은 연다', () => {
    for (const p of [
      '.env',
      'config/.env.local',
      'keys/a.pem',
      '.ssh/config',
      '.codex/auth.json',
      'id_rsa'
    ])
      expect(resolveCodePath(root, p, false)).toEqual({
        refused: 'refused: secret or credential file'
      })
    expect(resolveCodePath(root, '.env.example', false)).toMatchObject({ rel: '.env.example' })
    expect(isSecretName('.claude', true)).toBe(true)
    expect(isSecretName('src', true)).toBe(false)
  })

  it('.git 은 읽을 수 있지만 그 안에 쓰지는 못한다(훅을 심으면 확인 없이 돈다)', () => {
    expect(resolveCodePath(root, '.git/config', false)).toMatchObject({ rel: '.git/config' })
    expect(resolveCodePath(root, '.git/hooks/pre-commit', true)).toEqual({
      refused: 'refused: writing inside .git is not allowed'
    })
  })

  it.skipIf(process.platform !== 'win32')('폴더 안의 정션이 밖을 가리키면 막는다', () => {
    symlinkSync(outside, join(root, 'escape'), 'junction')
    expect(resolveCodePath(root, 'escape/secret.txt', false)).toEqual({
      refused: 'refused: the path leads outside the work folder (link)'
    })
    expect(resolveCodePath(root, 'escape/new.txt', true)).toHaveProperty('refused')
  })
})

describe('코드 도구', () => {
  it('code_list: 큰 생성물 폴더는 펼치지 않고 비밀 파일은 보이지 않는다', async () => {
    const out = await call(tools().get('code_list'), {})
    expect(out).toContain('src/')
    expect(out).toContain('  app.ts')
    expect(out).toContain('node_modules/ (not expanded)')
    expect(out).not.toContain('.env')
  })

  it('code_read: 줄 번호와 범위, 폴더 밖·바이너리는 거절', async () => {
    const t = tools()
    expect(await call(t.get('code_read'), { path: 'src/app.ts', offset: 2, limit: 1 })).toBe(
      'src/app.ts (lines 2-2 of 4)\n2\texport const hello = "안녕"'
    )
    expect(await call(t.get('code_read'), { path: '../outside/secret.txt' })).toBe(
      'refused: outside the work folder'
    )
    writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 0, 2]))
    expect(await call(t.get('code_read'), { path: 'bin.dat' })).toBe('refused: binary file')
    expect(t.steps[0]).toEqual({ label: '코드 읽기: src/app.ts', ok: true })
    expect(t.steps[1].ok).toBe(false)
  })

  it('code_search: node_modules 는 건너뛰고 글롭으로 거른다', async () => {
    const t = tools()
    const out = await call(t.get('code_search'), { pattern: 'hello' })
    expect(out).toBe('src/app.ts:2: export const hello = "안녕"')
    expect(await call(t.get('code_search'), { pattern: 'hello', glob: '*.js' })).toMatch(
      /^no matches/
    )
    expect(await call(t.get('code_search'), { pattern: '(' })).toMatch(/^error: bad pattern/)
  })

  it('code_write: 새 폴더까지 만들어 쓰고, 읽기 전용이면 거절', async () => {
    const t = tools()
    expect(await call(t.get('code_write'), { path: 'lib/new.ts', content: 'x\ny\n' })).toBe(
      'created lib/new.ts (3 lines)'
    )
    expect(readFileSync(join(root, 'lib', 'new.ts'), 'utf8')).toBe('x\ny\n')
    const ro = tools({ readOnly: true })
    expect(await call(ro.get('code_write'), { path: 'a.ts', content: '' })).toMatch(/read-only/)
  })

  it('code_edit: 한 곳만 바꾸고, 없거나 여러 곳이면 알려 준다. CRLF·BOM 은 그대로 둔다', async () => {
    const t = tools()
    const edit = t.get('code_edit')
    expect(
      await call(edit, {
        path: 'src/app.ts',
        old_string: 'const a = 1',
        new_string: 'const a = 10'
      })
    ).toBe('edited src/app.ts (1 replacement)')
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toContain('const a = 10\n')
    expect(await call(edit, { path: 'src/app.ts', old_string: 'nope', new_string: 'x' })).toMatch(
      /not found/
    )
    expect(
      await call(edit, { path: 'src/app.ts', old_string: 'const', new_string: 'let' })
    ).toMatch(/appears 3 times/)
    // CRLF + BOM 파일에 LF 로 준 여러 줄 글
    writeFileSync(join(root, 'win.txt'), Buffer.from('\uFEFFline1\r\nline2\r\nline3\r\n', 'utf8'))
    expect(
      await call(edit, { path: 'win.txt', old_string: 'line1\nline2', new_string: 'one\ntwo' })
    ).toBe('edited win.txt (1 replacement)')
    const raw = readFileSync(join(root, 'win.txt'))
    expect(raw.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(raw.subarray(3).toString('utf8')).toBe('one\r\ntwo\r\nline3\r\n')
  })

  it('code_run: 확인을 거절하면 돌지 않고, 승인하면 작업 폴더에서 돈다', async () => {
    const ran: Parameters<CommandRunner>[0][] = []
    const run: CommandRunner = async (o) => {
      ran.push(o)
      return { code: 0, output: '테스트 통과\n', timedOut: false, aborted: false }
    }
    const declined = tools({ run, confirm: async () => false })
    expect(await call(declined.get('code_run'), { command: 'npm test' })).toBe(
      'declined: the user did not approve this command'
    )
    expect(ran).toHaveLength(0)

    const t = tools({ run })
    expect(await call(t.get('code_run'), { command: 'npm test', timeout_sec: 30 })).toBe(
      'exit 0\n테스트 통과'
    )
    expect(t.confirms).toEqual(['명령 실행 · proj\nnpm test'])
    expect(ran[0]).toMatchObject({ command: 'npm test', cwd: root, timeoutMs: 30_000 })
    expect(t.steps.at(-1)).toEqual({ label: '명령: npm test (exit 0)', ok: true })

    const ro = tools({ run, readOnly: true })
    expect(await call(ro.get('code_run'), { command: 'dir' })).toMatch(/read-only/)
    expect(ro.confirms).toHaveLength(0)
  })

  it('상한에 닿으면 도구가 돌지 않는다', async () => {
    const t = tools({ tick: () => 'limit reached' })
    expect(await call(t.get('code_read'), { path: 'src/app.ts' })).toBe('limit reached')
  })
})

describe('보조 함수', () => {
  it('글롭: 파일 이름·경로', () => {
    expect(globToRegExp('*.ts').test('app.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('app.tsx')).toBe(false)
    expect(globToRegExp('src/**/*.tsx').test('src/a/b/c.tsx')).toBe(true)
    expect(globToRegExp('src/**/*.tsx').test('src/c.tsx')).toBe(true)
  })

  it('명령 환경 변수에서 토큰·키·비밀번호로 보이는 값은 뺀다', () => {
    const env = commandEnv({
      PATH: 'C:\\bin',
      NODEN_CODEX_TOOLS_TOKEN: 't',
      OPENAI_API_KEY: 'k',
      DB_PASSWORD: 'p',
      ELECTRON_RUN_AS_NODE: '1',
      HOME: 'h'
    })
    expect(env).toEqual({ PATH: 'C:\\bin', HOME: 'h' })
  })
})

describe.skipIf(process.platform !== 'win32')('runPowerShell — 실제 PowerShell', () => {
  it('한글 출력과 끝 코드를 그대로 돌려준다', async () => {
    const r = await runPowerShell({
      command: "Write-Output '한글 출력 OK'; cmd /c exit 3",
      cwd: root,
      timeoutMs: 60_000
    })
    expect(r.output).toContain('한글 출력 OK')
    expect(r.code).toBe(3)
    expect(r.timedOut).toBe(false)
  }, 70_000)

  it('시간을 넘기면 프로세스 트리째 끈다', async () => {
    const started = Date.now()
    const r = await runPowerShell({
      command: 'Start-Sleep -Seconds 30',
      cwd: root,
      timeoutMs: 1500
    })
    expect(r.timedOut).toBe(true)
    expect(r.code).toBeNull()
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 30_000)
})
