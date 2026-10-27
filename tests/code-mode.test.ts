// 코드 작업 모드 — 대화에 작업 폴더가 있으면 코드 도구를 붙이고 비밀번호·결제·폰 도구는 뺀다.
// 폴더 고르기 거절 규칙, 도구 목록, Codex 셸 끄기, 실행기 연결(Claude·Codex)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { CodexEvent, CodexInput } from '../src/main/agent/provider-codex'
import type { ToolContext } from '../src/main/agent/tools'
import { CodeFolderStore, codeFolderRefusal } from '../src/main/agent/code-folders'
import { buildCodexArgs } from '../src/main/agent/provider-codex'

let codexRuns: CodexEvent[][] = []
const claudeInputs: ProviderInput[] = []
const codexInputs: CodexInput[] = []
let toolCtx: ToolContext | null = null
// 실행마다 도구를 몇 번 부른 셈 칠지(자동 이어가기 판정용)
let ticksPerRun = 0

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      claudeInputs.push(input)
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (let i = 0; i < ticksPerRun; i++) toolCtx?.tick()
        yield { type: 'result', subtype: 'success', is_error: false, result: '끝' }
      })()
    },
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      const events = codexRuns.shift() ?? [{ type: 'done', ok: true }]
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const e of events) yield e
      })()
    }
  }
})
vi.mock('../src/main/agent/tools', async () => {
  const actual =
    await vi.importActual<typeof import('../src/main/agent/tools')>('../src/main/agent/tools')
  return {
    ...actual,
    createSambaTools: (ctx: ToolContext) => {
      toolCtx = ctx
      return { name: 'samba-stub' }
    }
  }
})
vi.mock('../src/main/agent/codex-tools', () => ({
  CODEX_TOOL_TOKEN_ENV: 'NODEN_CODEX_TOOLS_TOKEN',
  openCodexToolServer: async () => ({
    url: 'http://127.0.0.1:1/mcp',
    token: 't',
    close: async () => {}
  })
}))

const { AgentRunner } = await import('../src/main/agent/runner')

let base: string
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'noden-codemode-')))
  codexRuns = []
  claudeInputs.length = 0
  codexInputs.length = 0
  toolCtx = null
  ticksPerRun = 0
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('codeFolderRefusal — 작업 폴더로 고를 수 없는 곳', () => {
  it('드라이브 맨 위·사용자 폴더 전체와 그 위·노든 데이터 폴더·윈도우 폴더는 막고, 프로젝트 폴더는 받는다', () => {
    const home = join(base, 'home')
    const userData = join(home, 'AppData', 'Roaming', 'noden')
    const project = join(home, 'workspace', 'shop')
    const win = join(base, 'Windows')
    for (const d of [userData, project, win]) mkdirSync(d, { recursive: true })
    const o = { home, userData, windowsDir: win }
    expect(codeFolderRefusal(parse(base).root, o)).toBe('드라이브 맨 위는 고를 수 없어요')
    expect(codeFolderRefusal(home, o)).toMatch(/사용자 폴더 전체/)
    expect(codeFolderRefusal(base, o)).toMatch(/사용자 폴더 전체/)
    expect(codeFolderRefusal(userData, o)).toBe('노든 데이터 폴더는 고를 수 없어요')
    expect(codeFolderRefusal(join(home, 'AppData'), o)).toBe('노든 데이터 폴더는 고를 수 없어요')
    expect(codeFolderRefusal(win, o)).toMatch(/윈도우/)
    expect(codeFolderRefusal(join(base, 'nope'), o)).toBe('폴더를 찾지 못했어요')
    expect(codeFolderRefusal(project, o)).toBeNull()
  })

  it('대화별 폴더 장부는 파일에 남고 지우면 사라진다', () => {
    const file = join(base, 'chat-code-folders.json')
    const store = new CodeFolderStore(file)
    store.set(7, 'C:\\work\\shop')
    expect(new CodeFolderStore(file).get(7)).toBe('C:\\work\\shop')
    store.clear(7)
    expect(new CodeFolderStore(file).get(7)).toBeNull()
  })
})

describe('도구 목록', () => {
  it('코드 모드면 code_* 를 붙이고 계정·비밀번호 도구는 내보내지 않는다', async () => {
    const actual =
      await vi.importActual<typeof import('../src/main/agent/tools')>('../src/main/agent/tools')
    const base_ = {
      tabs: { active: () => null, list: () => [] } as unknown as TabManager,
      dangerWords: [],
      mode: 'guard' as const,
      finalConfirm: false,
      confirm: async () => true,
      tick: () => null,
      onStep: () => {}
    }
    const names = (ctx: ToolContext): string[] =>
      (actual.createSambaTools(ctx) as unknown as { tools: { name: string }[] }).tools.map(
        (t) => t.name
      )
    const normal = names(base_)
    expect(normal).toEqual(expect.arrayContaining(['login', 'fill_secret', 'list_accounts']))
    expect(normal).not.toContain('code_run')
    const code = names({
      ...base_,
      code: {
        root: base,
        readOnly: false,
        confirm: async () => true,
        tick: () => null,
        onStep: () => {}
      }
    })
    expect(code).toEqual(
      expect.arrayContaining([
        'code_list',
        'code_read',
        'code_search',
        'code_write',
        'code_edit',
        'code_run',
        'get_page'
      ])
    )
    for (const n of ['login', 'fill_secret', 'list_accounts']) expect(code).not.toContain(n)
    expect(actual.SAMBA_TOOL_NAMES).toContain('mcp__samba__code_run')
  })
})

describe('buildCodexArgs — 코드 모드는 Codex 셸을 끈다', () => {
  it('새 스레드·이어받기 모두 shell_tool·unified_exec 를 끈다', () => {
    const fresh = buildCodexArgs({ model: 'gpt-6.1-sol', noShell: true }).join(' ')
    expect(fresh).toContain('-c features.shell_tool=false -c features.unified_exec=false')
    const resumed = buildCodexArgs({ model: 'gpt-6.1-sol', noShell: true, resume: 'T-1' }).join(' ')
    expect(resumed).toContain('features.shell_tool=false')
    expect(buildCodexArgs({ model: 'gpt-6.1-sol' }).join(' ')).not.toContain('shell_tool')
  })
})

describe('실행기 — 대화에 작업 폴더가 있으면 코드 모드', () => {
  function makeRunner(
    engine: 'claude' | 'codex',
    folder: string | null,
    permissionMode: 'read_only' | 'guard' | 'full' = 'guard'
  ): { runner: InstanceType<typeof AgentRunner>; events: AgentEvent[] } {
    const events: AgentEvent[] = []
    const settings = {
      get: () => ({
        model: 'sonnet',
        language: 'ko',
        panelWidth: 380,
        lastUrl: '',
        dangerWords: [],
        maxToolCalls: 40,
        agentEffort: 'medium',
        permissionMode
      })
    }
    const runner = new AgentRunner(
      { clearAgentTarget: () => {} } as unknown as TabManager,
      settings as unknown as SettingsStore,
      (e) => events.push(e)
    )
    runner.setEngineRouting(() =>
      engine === 'codex'
        ? { engine, auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
        : { engine, auth: { mode: 'claude_subscription' }, model: 'claude-sonnet-5-5' }
    )
    runner.setCodeFolders((chatId) => (chatId === 5 ? folder : null))
    return { runner, events }
  }

  it('Claude: 코드 도구 문맥을 넣고 금고·폰·결제는 빼며, 지시문에 코드 모드를 알린다', async () => {
    const { runner } = makeRunner('claude', base)
    await runner.run('테스트 고쳐줘', 5)
    expect(toolCtx?.code).toMatchObject({ root: base, readOnly: false })
    expect(toolCtx?.vault).toBeUndefined()
    expect(toolCtx?.phone).toBeUndefined()
    expect(toolCtx?.pay).toBeUndefined()
    expect(claudeInputs[0].systemPrompt).toContain(
      `CODE MODE (this chat has a work folder: ${base})`
    )
  })

  it('폴더 없는 대화는 지금과 같다(코드 도구 없음)', async () => {
    const { runner } = makeRunner('claude', null)
    await runner.run('안녕', 5)
    expect(toolCtx?.code).toBeUndefined()
    expect(claudeInputs[0].systemPrompt).not.toContain('CODE MODE')
  })

  it('읽기 전용 권한이면 코드 도구도 읽기만', async () => {
    const { runner } = makeRunner('claude', base, 'read_only')
    await runner.run('보기만 해', 5)
    expect(toolCtx?.code?.readOnly).toBe(true)
  })

  it('골라 둔 폴더가 없어졌으면 코드 도구 없이 돌고 그렇다고 알린다', async () => {
    const gone = join(base, 'gone')
    const { runner, events } = makeRunner('claude', gone)
    await runner.run('고쳐줘', 5)
    expect(toolCtx?.code).toBeUndefined()
    expect(events).toContainEqual({
      type: 'text',
      text: `(작업 폴더를 찾지 못해 이번에는 코드 도구 없이 돕니다: ${gone})`
    })
  })

  it('코드 모드는 done 없이 답하고 끝내도 자동으로 이어 돌리지 않는다(브라우저 대화는 이어 돈다)', async () => {
    ticksPerRun = 3
    const code = makeRunner('claude', base)
    await code.runner.run('고치고 테스트해', 5)
    await new Promise((r) => setTimeout(r, 50))
    expect(claudeInputs).toHaveLength(1)
    expect(
      code.events.some((e) => e.type === 'text' && e.text.includes('자동으로 이어갑니다'))
    ).toBe(false)

    claudeInputs.length = 0
    const web = makeRunner('claude', null)
    await web.runner.run('주문 확인해', 5)
    expect(web.events).toContainEqual({ type: 'text', text: '(답 없이 멈춰 자동으로 이어갑니다)' })
  })

  it('Codex: 셸을 끄고, 지시문·말 앞에 코드 모드를 알린다', async () => {
    const { runner } = makeRunner('codex', base)
    await runner.run('빌드 돌려 봐', 5)
    expect(codexInputs[0].noShell).toBe(true)
    expect(codexInputs[0].prompt).toContain(`[Code mode is on: work folder ${base}.`)
    expect(codexInputs[0].systemPrompt).toContain('Your own shell is turned off in code mode')
    // Codex 가 자기 샌드박스(읽기 전용) 안내만 보고 '못 고친다'고 하지 않게 — 코드 도구로는 쓰고 지울 수 있다고 알린다
    expect(codexInputs[0].prompt).toContain(
      "Codex's read-only sandbox does not apply to these tools"
    )
    expect(codexInputs[0].systemPrompt).toContain('never tell the user this session is read-only')
    expect(codexInputs[0].systemPrompt).toContain('To delete, move or rename files, use code_run')
    expect(codexInputs[0].systemPrompt).toContain('CODE MODE')
  })

  it('Codex: 폴더 없는 대화는 셸을 끄지 않는다', async () => {
    const { runner } = makeRunner('codex', null)
    await runner.run('안녕', 5)
    expect(codexInputs[0].noShell).toBeUndefined()
    expect(codexInputs[0].prompt).not.toContain('Code mode')
  })
})
