// 코드 작업 모드 도구 — 대화마다 고른 작업 폴더 안에서만 파일을 보고·찾고·고치고, 명령은 확인 카드를 거쳐 돌린다.
//
// 왜 SDK 내장 도구(Read·Edit·Bash)가 아니라 노든 도구인가
// - Claude 와 Codex 가 같은 규칙으로 돈다(Codex 는 같은 도구 서버를 HTTP 로 받는다)
// - 폴더 밖·비밀 파일 막기와 명령 확인을 노든이 직접 쥔다(내장 셸은 어디든 쓰고 확인 없이 돈다)
//
// 막는 것
// - 작업 폴더 밖: '..'·다른 드라이브·네트워크 경로·정션/심볼릭 링크로 밖을 가리키는 길
// - 비밀 파일: .env·키 파일·.ssh/.claude/.codex 같은 자격 폴더(읽기·쓰기 모두)
// - .git 안 쓰기: 훅을 심으면 다음 git 명령이 확인 없이 돈다
// - 권한 모드 '읽기 전용'이면 쓰기·고치기·명령

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/** 코드 도구가 쓰는 문맥 — 채팅 실행이 작업 폴더가 있는 대화에서만 만든다 */
export interface CodeToolContext {
  /** 작업 폴더(실제 경로) */
  root: string
  /** 권한 모드가 읽기 전용이면 쓰기·고치기·명령을 거절한다 */
  readOnly: boolean
  /** 명령 실행 확인 카드. 승인이면 true */
  confirm: (action: string) => Promise<boolean>
  tick: () => string | null
  onStep: (label: string, ok: boolean) => void
  /** 실행 중단 — 돌던 명령을 트리째 끈다 */
  signal?: AbortSignal
  /** 명령 실행기(테스트에서 갈아 끼운다) */
  run?: CommandRunner
}

export type CommandRunner = (o: {
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<CommandResult>

export interface CommandResult {
  /** 끝 코드. 시간 초과·중단으로 끈 경우 null */
  code: number | null
  output: string
  timedOut: boolean
  aborted: boolean
}

export const CODE_TOOL_NAMES = [
  'code_list',
  'code_read',
  'code_search',
  'code_write',
  'code_edit',
  'code_run'
]

// 큰 생성물·의존성 폴더는 목록·찾기에서 건너뛴다(읽기는 경로를 직접 주면 된다)
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv'
])
// 자격 정보가 든 폴더 — 경로 어느 마디에 있어도 막는다
const SECRET_DIR_RE = /^(\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.docker|\.claude|\.codex.*)$/i
// 자격 정보 파일. .env 는 예시 파일(.env.example 등)만 연다
const SECRET_FILE_RES = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|pfx|p12|jks|keystore|ppk)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^\.(npmrc|pypirc|netrc|git-credentials)$/i,
  /^\.?credentials(\.json)?$/i
]
const ENV_EXAMPLE_RE = /^\.env\.(example|sample|template|dist)$/i
const UNC_RE = /^[\\/]{2}/

const READ_MAX_BYTES = 2 * 1024 * 1024
const READ_DEFAULT_LINES = 400
const READ_MAX_LINES = 2000
const LINE_MAX_CHARS = 2000
const RESULT_MAX_CHARS = 60_000
const LIST_MAX_LINES = 400
const SEARCH_MAX_MATCHES = 200
const SEARCH_MAX_FILES = 5000
const SEARCH_FILE_MAX_BYTES = 1024 * 1024
const WRITE_MAX_BYTES = 2 * 1024 * 1024
export const RUN_DEFAULT_SEC = 120
export const RUN_MAX_SEC = 600
const OUTPUT_KEEP_CHARS = 12_000

/** 이름 하나가 비밀 파일·폴더인가 */
export function isSecretName(name: string, isDir: boolean): boolean {
  if (isDir) return SECRET_DIR_RE.test(name)
  if (ENV_EXAMPLE_RE.test(name)) return false
  return SECRET_FILE_RES.some((re) => re.test(name))
}

const isOutside = (rel: string): boolean =>
  rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)

// 있는 데까지 실제 경로를 따라간다(정션·심볼릭 링크 풀기) — 없는 꼬리(새로 만들 파일)는 그대로 붙인다
function realOf(path: string): string {
  const tail: string[] = []
  let cur = path
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...tail.reverse())
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return path
      tail.push(basename(cur))
      cur = parent
    }
  }
}

/**
 * 모델이 준 경로를 작업 폴더 안의 실제 경로로 푼다. 밖이거나 비밀 파일이면 거절 문구.
 * 상대 경로는 작업 폴더 기준, 절대 경로도 작업 폴더 안이면 받는다
 */
export function resolveCodePath(
  root: string,
  input: string,
  write: boolean
): { abs: string; rel: string } | { refused: string } {
  const raw = input.trim() === '' ? '.' : input.trim()
  if (UNC_RE.test(raw)) return { refused: 'refused: network paths are not allowed' }
  const abs = resolve(root, raw)
  const rel = relative(root, abs)
  if (isOutside(rel)) return { refused: 'refused: outside the work folder' }
  if (isOutside(relative(realOf(root), realOf(abs))))
    return { refused: 'refused: the path leads outside the work folder (link)' }
  const parts = rel === '' ? [] : rel.split(/[\\/]/)
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1
    if (isSecretName(parts[i], true) || (last && isSecretName(parts[i], false)))
      return { refused: 'refused: secret or credential file' }
  }
  if (write && parts.slice(0, -1).some((p) => p.toLowerCase() === '.git'))
    return { refused: 'refused: writing inside .git is not allowed' }
  if (write && parts.length === 0) return { refused: 'refused: give a file path' }
  return { abs, rel: rel === '' ? '.' : rel.split(sep).join('/') }
}

const text = (t: string): { content: [{ type: 'text'; text: string }] } => ({
  content: [{ type: 'text' as const, text: t }]
})

const clip = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max)}\n…(truncated, ${s.length - max} more chars)` : s

/** 명령 출력이 길면 앞뒤만 남긴다(끝의 오류 문구가 가장 중요하다) */
export function clipOutput(s: string): string {
  if (s.length <= OUTPUT_KEEP_CHARS * 2) return s
  return `${s.slice(0, OUTPUT_KEEP_CHARS)}\n…(${s.length - OUTPUT_KEEP_CHARS * 2} chars omitted)…\n${s.slice(-OUTPUT_KEEP_CHARS)}`
}

const looksBinary = (buf: Buffer): boolean => buf.subarray(0, 8192).includes(0)

const decode = (buf: Buffer): string => {
  const s = buf.toString('utf8')
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

// 찾기의 파일 거르개 — '*.ts'·'src/**/*.tsx' 같은 간단한 글롭. '/' 가 없으면 파일 이름만 본다
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

// 작업 폴더 안 파일을 차례로 내어 준다(건너뛸 폴더·비밀 파일 빼고)
async function* walkFiles(
  rootAbs: string,
  startAbs: string
): AsyncGenerator<{ abs: string; rel: string }> {
  const stack = [startAbs]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => b.name.localeCompare(a.name))
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !isSecretName(e.name, true)) stack.push(abs)
      } else if (e.isFile() && !isSecretName(e.name, false))
        yield { abs, rel: relative(rootAbs, abs).split(sep).join('/') }
    }
  }
}

/** PowerShell 로 명령 한 줄을 돌린다. 출력은 UTF-8, 시간 초과·중단이면 프로세스 트리째 끈다 */
export const runPowerShell: CommandRunner = ({ command, cwd, timeoutMs, signal }) =>
  new Promise((done) => {
    // 실행한 명령이 실패 끝 코드를 남기면 그 코드로 끝낸다(PowerShell 은 기본으로 0 을 돌려준다)
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      '& {',
      command,
      '}',
      'if ($LASTEXITCODE) { exit $LASTEXITCODE }'
    ].join('\n')
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { cwd, env: commandEnv(process.env), windowsHide: true }
    )
    const chunks: Buffer[] = []
    let size = 0
    const take = (b: Buffer): void => {
      // 너무 많이 쏟아내는 명령도 메모리를 다 먹지 않게 앞쪽 8MB 까지만 모은다
      if (size > 8 * 1024 * 1024) return
      chunks.push(b)
      size += b.length
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    let timedOut = false
    let aborted = false
    const killTree = (): void => {
      if (child.pid === undefined || child.exitCode !== null) return
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on(
        'error',
        () => undefined
      )
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, timeoutMs)
    const onAbort = (): void => {
      aborted = true
      killTree()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (code: number | null, extra = ''): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      done({
        code: timedOut || aborted ? null : code,
        output: Buffer.concat(chunks).toString('utf8') + extra,
        timedOut,
        aborted
      })
    }
    child.on('error', (e) => finish(null, `\n${e.message}`))
    child.on('close', (code) => finish(code))
  })

// 명령에 넘기는 환경 변수 — 토큰·키·비밀번호로 보이는 값은 뺀다(노든 도구 통로 토큰 포함)
const SECRET_ENV_RE = /(TOKEN|SECRET|PASSW|API_?KEY|CREDENTIAL|COOKIE|PRIVATE_KEY|AUTH)/i
export function commandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env))
    if (!SECRET_ENV_RE.test(k) && k !== 'ELECTRON_RUN_AS_NODE') out[k] = v
  return out
}

// 스키마가 서로 다른 도구를 한 배열에 담는 공통 타입(폰 도구와 같은 취지)
type CodeTool = SdkMcpToolDefinition

export function createCodeTools(ctx: CodeToolContext): CodeTool[] {
  const run = ctx.run ?? runPowerShell
  // 상한 세기·진행 줄·예외 막기를 한 곳에서. label 은 결과를 보고서야 정해지는 경우가 있어 함수도 받는다
  const guard = async (
    label: string,
    fn: () => Promise<{ ok: boolean; result: string; label?: string }>
  ): Promise<ReturnType<typeof text>> => {
    const over = ctx.tick()
    if (over) return text(over)
    try {
      const r = await fn()
      ctx.onStep(r.label ?? label, r.ok)
      return text(r.result)
    } catch (e) {
      ctx.onStep(label, false)
      return text(`error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const refuse = (result: string): { ok: boolean; result: string } => ({ ok: false, result })
  const READ_ONLY = 'refused: the permission mode is read-only — ask the user to change it'

  const codeList = tool(
    'code_list',
    'List files and folders in the work folder (code mode). path is relative to the work folder (default: the folder itself). Big generated folders such as node_modules, .git and dist are shown but not expanded.',
    {
      path: z.string().optional().describe('folder, relative to the work folder'),
      depth: z.number().int().min(1).max(5).optional().describe('how deep to go (default 2)')
    },
    ({ path, depth }) =>
      guard(`코드 목록: ${path || '.'}`, async () => {
        const p = resolveCodePath(ctx.root, path ?? '.', false)
        if ('refused' in p) return refuse(p.refused)
        const lines: string[] = []
        const walk = async (dir: string, level: number, indent: string): Promise<void> => {
          let entries: import('node:fs').Dirent[]
          try {
            entries = await readdir(dir, { withFileTypes: true })
          } catch (e) {
            if (level === 1) throw e
            return
          }
          entries.sort(
            (a, b) =>
              Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
          )
          for (const e of entries) {
            if (lines.length >= LIST_MAX_LINES) return
            if (isSecretName(e.name, e.isDirectory())) continue
            if (e.isDirectory()) {
              const skipped = SKIP_DIRS.has(e.name)
              lines.push(`${indent}${e.name}/${skipped ? ' (not expanded)' : ''}`)
              if (!skipped && level < (depth ?? 2))
                await walk(join(dir, e.name), level + 1, `${indent}  `)
            } else lines.push(`${indent}${e.name}`)
          }
        }
        await walk(p.abs, 1, '')
        const more = lines.length >= LIST_MAX_LINES ? `\n…(stopped at ${LIST_MAX_LINES} lines)` : ''
        return { ok: true, result: `${p.rel}/\n${lines.join('\n') || '(empty)'}${more}` }
      })
  )

  const codeRead = tool(
    'code_read',
    'Read a text file in the work folder with line numbers. offset is the first line (1-based), limit the number of lines (default 400, max 2000).',
    {
      path: z.string().describe('file, relative to the work folder'),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(READ_MAX_LINES).optional()
    },
    ({ path, offset, limit }) =>
      guard(`코드 읽기: ${path}`, async () => {
        const p = resolveCodePath(ctx.root, path, false)
        if ('refused' in p) return refuse(p.refused)
        const info = await stat(p.abs)
        if (!info.isFile()) return refuse('refused: not a file')
        if (info.size > READ_MAX_BYTES) return refuse('refused: file is larger than 2MB')
        const buf = await readFile(p.abs)
        if (looksBinary(buf)) return refuse('refused: binary file')
        const all = decode(buf).split(/\r?\n/)
        const from = (offset ?? 1) - 1
        const shown = all.slice(from, from + (limit ?? READ_DEFAULT_LINES))
        const body = shown
          .map(
            (l, i) =>
              `${from + i + 1}\t${l.length > LINE_MAX_CHARS ? `${l.slice(0, LINE_MAX_CHARS)}…` : l}`
          )
          .join('\n')
        const head = `${p.rel} (lines ${from + 1}-${from + shown.length} of ${all.length})`
        return { ok: true, result: clip(`${head}\n${body}`, RESULT_MAX_CHARS) }
      })
  )

  const codeSearch = tool(
    'code_search',
    'Search file contents in the work folder with a regular expression (JavaScript syntax). Returns "path:line: text". glob filters files, e.g. "*.ts" or "src/**/*.tsx". node_modules, .git, dist and similar folders are skipped.',
    {
      pattern: z.string().min(1).describe('regular expression'),
      path: z.string().optional().describe('folder or file to search, relative to the work folder'),
      glob: z.string().optional(),
      ignore_case: z.boolean().optional()
    },
    ({ pattern, path, glob, ignore_case }) =>
      guard(`코드 찾기: ${pattern}`, async () => {
        let re: RegExp
        try {
          re = new RegExp(pattern, ignore_case ? 'i' : '')
        } catch (e) {
          return refuse(`error: bad pattern — ${e instanceof Error ? e.message : String(e)}`)
        }
        const p = resolveCodePath(ctx.root, path ?? '.', false)
        if ('refused' in p) return refuse(p.refused)
        const filter = glob ? globToRegExp(glob.replace(/\\/g, '/')) : null
        const byName = glob !== undefined && !glob.includes('/')
        const info = await stat(p.abs)
        const files = info.isFile()
          ? (async function* () {
              yield { abs: p.abs, rel: p.rel }
            })()
          : walkFiles(ctx.root, p.abs)
        const hits: string[] = []
        let scanned = 0
        for await (const f of files) {
          if (hits.length >= SEARCH_MAX_MATCHES || scanned >= SEARCH_MAX_FILES) break
          if (filter && !filter.test(byName ? basename(f.rel) : f.rel)) continue
          scanned++
          const st = await stat(f.abs).catch(() => null)
          if (!st || st.size > SEARCH_FILE_MAX_BYTES) continue
          const buf = await readFile(f.abs).catch(() => null)
          if (!buf || looksBinary(buf)) continue
          const lines = decode(buf).split(/\r?\n/)
          for (let i = 0; i < lines.length && hits.length < SEARCH_MAX_MATCHES; i++)
            if (re.test(lines[i])) hits.push(`${f.rel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`)
        }
        const tail =
          hits.length >= SEARCH_MAX_MATCHES
            ? `\n…(stopped at ${SEARCH_MAX_MATCHES} matches)`
            : scanned >= SEARCH_MAX_FILES
              ? `\n…(stopped after ${SEARCH_MAX_FILES} files)`
              : ''
        return {
          ok: true,
          result: hits.length === 0 ? `no matches (${scanned} files)` : `${hits.join('\n')}${tail}`
        }
      })
  )

  const codeWrite = tool(
    'code_write',
    'Create or overwrite a text file in the work folder with the given content (UTF-8). Parent folders are created. Prefer code_edit for changing part of an existing file.',
    {
      path: z.string().describe('file, relative to the work folder'),
      content: z.string()
    },
    ({ path, content }) =>
      guard(`코드 쓰기: ${path}`, async () => {
        if (ctx.readOnly) return refuse(READ_ONLY)
        const p = resolveCodePath(ctx.root, path, true)
        if ('refused' in p) return refuse(p.refused)
        if (Buffer.byteLength(content) > WRITE_MAX_BYTES)
          return refuse('refused: content is larger than 2MB')
        const existed = await stat(p.abs).then(
          (s) => s.isFile(),
          () => false
        )
        await mkdir(dirname(p.abs), { recursive: true })
        await writeFile(p.abs, content, 'utf8')
        const lines = content === '' ? 0 : content.split('\n').length
        return {
          ok: true,
          result: `${existed ? 'overwrote' : 'created'} ${p.rel} (${lines} lines)`,
          label: `코드 쓰기: ${p.rel}`
        }
      })
  )

  const codeEdit = tool(
    'code_edit',
    'Replace exact text in a file in the work folder. old_string must match the file exactly (including indentation) and be unique unless replace_all is true. Read the file first.',
    {
      path: z.string().describe('file, relative to the work folder'),
      old_string: z.string().min(1),
      new_string: z.string(),
      replace_all: z.boolean().optional()
    },
    ({ path, old_string, new_string, replace_all }) =>
      guard(`코드 고침: ${path}`, async () => {
        if (ctx.readOnly) return refuse(READ_ONLY)
        const p = resolveCodePath(ctx.root, path, true)
        if ('refused' in p) return refuse(p.refused)
        const buf = await readFile(p.abs)
        if (looksBinary(buf)) return refuse('refused: binary file')
        const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
        const body = decode(buf)
        // 줄바꿈이 CRLF 인 파일은 모델이 준 LF 글을 CRLF 로 맞춰 다시 찾는다
        let oldText = old_string
        let newText = new_string
        if (!body.includes(oldText) && body.includes('\r\n')) {
          oldText = old_string.replace(/\r?\n/g, '\r\n')
          newText = new_string.replace(/\r?\n/g, '\r\n')
        }
        const count = body.split(oldText).length - 1
        if (count === 0)
          return refuse(
            'error: old_string not found — read the file again and copy the text exactly'
          )
        if (count > 1 && !replace_all)
          return refuse(
            `error: old_string appears ${count} times — add surrounding lines to make it unique, or set replace_all`
          )
        const next = replace_all
          ? body.split(oldText).join(newText)
          : body.replace(oldText, () => newText)
        await writeFile(p.abs, bom ? `${String.fromCharCode(0xfeff)}${next}` : next, 'utf8')
        return {
          ok: true,
          result: `edited ${p.rel} (${replace_all ? count : 1} replacement${(replace_all ? count : 1) > 1 ? 's' : ''})`,
          label: `코드 고침: ${p.rel}`
        }
      })
  )

  const codeRun = tool(
    'code_run',
    'Run one PowerShell command line in the work folder (Windows). The user must approve every command on a confirmation card first, so say briefly why you run it. timeout_sec defaults to 120 (max 600). Output (stdout and stderr) and the exit code come back.',
    {
      command: z.string().min(1),
      timeout_sec: z.number().int().min(1).max(RUN_MAX_SEC).optional()
    },
    ({ command, timeout_sec }) =>
      guard(`명령: ${command.slice(0, 80)}`, async () => {
        if (ctx.readOnly) return refuse(READ_ONLY)
        const ok = await ctx.confirm(`명령 실행 · ${basename(ctx.root)}\n${command}`)
        if (!ok) return refuse('declined: the user did not approve this command')
        const r = await run({
          command,
          cwd: ctx.root,
          timeoutMs: (timeout_sec ?? RUN_DEFAULT_SEC) * 1000,
          signal: ctx.signal
        })
        const status = r.aborted
          ? 'stopped by the user'
          : r.timedOut
            ? `timed out after ${timeout_sec ?? RUN_DEFAULT_SEC}s (killed)`
            : `exit ${r.code}`
        return {
          ok: r.code === 0,
          result: `${status}\n${clipOutput(r.output.trim()) || '(no output)'}`,
          label: `명령: ${command.slice(0, 80)} (${r.timedOut ? '시간 초과' : r.aborted ? '중단' : `exit ${r.code}`})`
        }
      })
  )

  return [codeList, codeRead, codeSearch, codeWrite, codeEdit, codeRun] as unknown as CodeTool[]
}
