// 코드 작업 모드 — 대화에 작업 폴더가 있으면 코드 도구를 붙이고 비밀번호·결제·폰 도구는 뺀다.
// 폴더 고르기 거절 규칙, 도구 목록, Codex 셸 끄기, 실행기 연결(Claude·Codex)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { CodexEvent, CodexInput } from '../src/main/agent/provider-codex'
import type { ToolContext } from '../src/main/agent/tools'
import { CodeFolderStore, codeFolderRefusal } from '../src/main/agent/code-folders'
import { buildCodexArgs, CODEX_NO_LOCAL_ACCESS } from '../src/main/agent/provider-codex'
import { CodexThreadStore, developerNoteKey } from '../src/main/agent/codex-threads'
import {
  CODEX_PC_LOCK_NOTE,
  codexCodeDeveloperNote,
  codexThreadKey
} from '../src/main/agent/runner'
import { buildQueryOptions } from '../src/main/agent/provider'
import { CODE_MODE_MAX_TOOL_CALLS, MAX_TOOL_CALLS, toolCallCap } from '../src/shared/settings'

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

describe('Codex 스레드 장부 — 스레드를 연 개발자 지시 지문', () => {
  it('지문을 파일에 남기고, 옛 꼴(지문 없음) 파일도 읽는다', () => {
    const file = join(base, 'codex-threads.json')
    const a = new CodexThreadStore(file)
    a.set(64, '01a17c28-edbb-7492-9082-cd16c3cc2a3e', developerNoteKey('note A'))
    a.set(7, '01a17c28-edbb-7492-9082-cd16c3cc2a3f')
    const b = new CodexThreadStore(file)
    expect(b.get(64)).toBe('01a17c28-edbb-7492-9082-cd16c3cc2a3e')
    expect(b.noteOf(64)).toBe(developerNoteKey('note A'))
    expect(b.noteOf(7)).toBe('')
    b.clear(64)
    expect(new CodexThreadStore(file).noteOf(64)).toBe('')
    expect(developerNoteKey('')).toBe('')
  })
})

describe('buildCodexArgs — 코드 모드는 Codex 셸을 끈다', () => {
  it('새 스레드·이어받기 모두 shell_tool·unified_exec 를 끈다', () => {
    const fresh = buildCodexArgs({ model: 'gpt-6.1-sol', noLocalAccess: true }).join(' ')
    expect(fresh).toContain('-c features.shell_tool=false -c features.unified_exec=false')
    const resumed = buildCodexArgs({
      model: 'gpt-6.1-sol',
      noLocalAccess: true,
      resume: 'T-1'
    }).join(' ')
    expect(resumed).toContain('features.shell_tool=false')
    expect(buildCodexArgs({ model: 'gpt-6.1-sol' }).join(' ')).not.toContain('shell_tool')
    // 개발자 지시는 TOML 문자열로 — 윈도우 경로의 역슬래시·따옴표가 이스케이프된다
    const sep = String.fromCharCode(92)
    const note = `Work folder: C:${sep}work${sep}shop. Say "yes".`
    const dev = buildCodexArgs({ model: 'gpt-6.1-sol', resume: 'T-1', developerInstructions: note })
    const arg = dev.find((a) => a.startsWith('developer_instructions='))
    expect(arg).toBe(`developer_instructions=${JSON.stringify(note)}`)
    expect(arg).toContain(`C:${sep}${sep}work`)
    expect(arg).toContain(`${sep}"yes${sep}"`)
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

  it("'자동' 권한이면 명령도 위험한 것만 묻고, '확인'이면 다 묻는다", async () => {
    const auto = makeRunner('claude', base, 'full')
    await auto.runner.run('테스트 돌려', 5)
    expect(toolCtx?.code?.autoRun).toBe(true)
    const guard = makeRunner('claude', base, 'guard')
    await guard.runner.run('테스트 돌려', 5)
    expect(toolCtx?.code?.autoRun).toBe(false)
  })

  it('코드 작업 모드 대화는 도구 호출 상한이 1000회, 브라우저 작업은 설정값 그대로', async () => {
    const code = makeRunner('claude', base)
    await code.runner.run('조사 정리해', 5)
    const codeTick = toolCtx?.tick
    for (let i = 0; i < 1000; i++) expect(codeTick?.()).toBeNull()
    expect(codeTick?.()).toContain('tool call limit (1000)')
    // SDK 턴 상한도 1000회보다 넉넉해야 도구 상한보다 먼저 죽지 않는다
    expect(claudeInputs[0].maxToolCalls).toBe(1000)
    expect(buildQueryOptions(claudeInputs[0], undefined).maxTurns).toBe(1050)

    const browser = makeRunner('claude', null)
    await browser.runner.run('주문서 열어', 5)
    const browserTick = toolCtx?.tick
    for (let i = 0; i < 40; i++) expect(browserTick?.()).toBeNull()
    expect(browserTick?.()).toContain('tool call limit (40)')
    expect(claudeInputs[1].maxToolCalls).toBe(40)
    expect(buildQueryOptions(claudeInputs[1], undefined).maxTurns).toBe(MAX_TOOL_CALLS + 50)
  })

  it('PC 잠금 대화는 코드 폴더가 있어도 설정값 상한', async () => {
    const { runner } = makeRunner('claude', base)
    runner.setPcLocks((chatId) => chatId === 5)
    await runner.run('요약해', 5)
    expect(claudeInputs[0].maxToolCalls).toBe(40)
  })

  it('toolCallCap — 설정이 1000보다 크면 코드 모드도 설정값', () => {
    expect(toolCallCap(200, true)).toBe(CODE_MODE_MAX_TOOL_CALLS)
    expect(toolCallCap(200, false)).toBe(200)
    expect(toolCallCap(1200, true)).toBe(1200)
  })

  it('클로드 앱 기억 읽기는 보통·코드 대화에 붙고, PC 잠금 대화에만 빠진다', async () => {
    const plain = makeRunner('claude', null)
    await plain.runner.run('노든 설정 어디야', 5)
    expect(toolCtx?.memory).toBeDefined()
    const code = makeRunner('claude', base)
    await code.runner.run('코드 고쳐', 5)
    expect(toolCtx?.memory).toBeDefined()
    const locked = makeRunner('claude', base)
    locked.runner.setPcLocks(() => true)
    await locked.runner.run('요약해', 5)
    expect(toolCtx?.memory).toBeUndefined()
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

  it('Codex: 개발자 지시 없이 열린 옛 스레드는 코드 모드에서 이어받지 않고 새로 연다(지시는 첫 말에만 실린다)', async () => {
    const saved: unknown[][] = []
    const threads = (note: string): Record<string, (...a: unknown[]) => unknown> => ({
      get: () => 'T-OLD-THREAD',
      noteOf: () => note,
      set: (...a: unknown[]) => saved.push(a),
      clear: () => {}
    })
    codexRuns = [
      [
        { type: 'thread', id: 'T-NEW-THREAD' },
        { type: 'done', ok: true }
      ]
    ]
    const old = makeRunner('codex', base)
    old.runner.setCodexThreads(threads('') as unknown as CodexThreadStore)
    await old.runner.run('지금은 고칠 수 있어?', 5)
    expect(codexInputs[0].resume).toBeUndefined()
    expect(saved[0]).toEqual([5, 'T-NEW-THREAD', codexThreadKey(codexCodeDeveloperNote(base))])

    // 같은 지시로 연 스레드는 그대로 이어받는다
    codexInputs.length = 0
    const same = makeRunner('codex', base)
    same.runner.setCodexThreads(
      threads(codexThreadKey(codexCodeDeveloperNote(base))) as unknown as CodexThreadStore
    )
    await same.runner.run('계속해', 5)
    expect(codexInputs[0].resume).toBe('T-OLD-THREAD')

    // 폴더 없는 보통 대화도 지금 판 지시문으로 연 스레드는 그대로 이어받는다
    codexInputs.length = 0
    const plain = makeRunner('codex', null)
    plain.runner.setCodexThreads(threads(codexThreadKey('')) as unknown as CodexThreadStore)
    await plain.runner.run('안녕', 5)
    expect(codexInputs[0].resume).toBe('T-OLD-THREAD')

    // 옛 판 지시문으로 연 스레드(지문 없음)는 한 번 새로 연다 — 새 안내(노든 설정 위치 등)가 닿게
    codexInputs.length = 0
    const stale = makeRunner('codex', null)
    stale.runner.setCodexThreads(threads('') as unknown as CodexThreadStore)
    await stale.runner.run('안녕', 5)
    expect(codexInputs[0].resume).toBeUndefined()
  })

  it('Codex: 너무 길어진 스레드(문맥 60% 넘음)는 이어받지 않고 앞부분 요약 + 새 스레드로 연다', async () => {
    // 가짜 Codex 홈에 39만 토큰짜리 스레드 기록을 둔다(실기 10/28 워크룸)
    const home = join(base, 'codex-home')
    const dir = join(home, 'sessions', '2026', '10', '27')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'rollout-2026-10-27T21-49-19-T-LONG-THREAD.jsonl'),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { total_tokens: 389_719 }, model_context_window: 475_000 }
        }
      })
    )
    const before = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    try {
      const saved: unknown[][] = []
      codexRuns = [
        [
          { type: 'thread', id: 'T-FRESH' },
          { type: 'done', ok: true }
        ]
      ]
      const { runner, events } = makeRunner('codex', null)
      runner.setCodexThreads({
        get: () => 'T-LONG-THREAD',
        noteOf: () => '',
        set: (...a: unknown[]) => saved.push(a),
        clear: () => {}
      } as unknown as CodexThreadStore)
      await runner.run('계속해', 5)
      expect(codexInputs[0].resume).toBeUndefined()
      expect(events).toContainEqual({
        type: 'text',
        text: '(대화가 길어져 앞부분을 요약해 새 세션으로 이어갑니다)'
      })
      expect(saved[0]?.[1]).toBe('T-FRESH')
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = before
    }
  })

  it('PC 잠금: 폴더가 붙어 있어도 코드 도구 없이 돌고, 파일 도구를 빼며, 지시문에 PC LOCK 을 알린다', async () => {
    const { runner } = makeRunner('claude', base)
    runner.setPcLocks(() => true)
    await runner.run('이 사이트 정리해줘', 5)
    expect(toolCtx?.code).toBeUndefined()
    expect(toolCtx?.pcLocked).toBe(true)
    expect(claudeInputs[0].systemPrompt).toContain('PC LOCK')
    expect(claudeInputs[0].systemPrompt).not.toContain('CODE MODE')
  })

  it('PC 잠금: Codex 는 PC 를 보는 도구를 끄고 잠금 지시를 개발자 지시로 싣는다', async () => {
    const { runner } = makeRunner('codex', null)
    runner.setPcLocks(() => true)
    await runner.run('안녕', 5)
    expect(codexInputs[0].noLocalAccess).toBe(true)
    expect(codexInputs[0].developerInstructions).toBe(CODEX_PC_LOCK_NOTE)
    expect(codexInputs[0].prompt).not.toContain('Code mode')
  })

  it('Codex: 셸을 끄고, 지시문·말 앞에 코드 모드를 알린다', async () => {
    const { runner } = makeRunner('codex', base)
    await runner.run('빌드 돌려 봐', 5)
    expect(codexInputs[0].noLocalAccess).toBe(true)
    // 쓰기 가능하다는 것은 개발자 지시로도 싣는다(이어받는 말에도)
    expect(codexInputs[0].developerInstructions).toContain(`Work folder: ${base}.`)
    expect(codexInputs[0].developerInstructions).toContain(
      'Never tell the user that this session is read-only'
    )
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
    expect(codexInputs[0].noLocalAccess).toBeUndefined()
    expect(codexInputs[0].developerInstructions).toBeUndefined()
    expect(codexInputs[0].prompt).not.toContain('Code mode')
  })
})

describe('PC 잠금 — 이 대화에서 AI 가 이 PC 의 파일을 하나도 못 본다', () => {
  it('장부: 잠금을 남기고, 대화를 지우면 폴더·잠금을 함께 지운다', () => {
    const file = join(base, 'chat-code-folders.json')
    const store = new CodeFolderStore(file)
    store.setLocked(9, true)
    store.set(10, 'D:/work')
    expect(new CodeFolderStore(file).isLocked(9)).toBe(true)
    expect(new CodeFolderStore(file).isLocked(10)).toBe(false)
    store.forget(9)
    store.forget(10)
    const again = new CodeFolderStore(file)
    expect(again.isLocked(9)).toBe(false)
    expect(again.get(10)).toBeNull()
  })

  it('도구: 잠금이면 PC 파일을 올리거나 목록을 보는 도구를 내보내지 않는다', async () => {
    const actual =
      await vi.importActual<typeof import('../src/main/agent/tools')>('../src/main/agent/tools')
    const ctx = {
      tabs: { active: () => null, list: () => [] } as unknown as TabManager,
      dangerWords: [],
      mode: 'guard' as const,
      finalConfirm: false,
      confirm: async () => true,
      tick: () => null,
      onStep: () => {}
    }
    const names = (c: ToolContext): string[] =>
      (actual.createSambaTools(c) as unknown as { tools: { name: string }[] }).tools.map(
        (t) => t.name
      )
    const FILE_TOOLS = ['upload_file', 'list_downloads', 'set_download_dir']
    expect(names(ctx)).toEqual(expect.arrayContaining(FILE_TOOLS))
    const locked = names({ ...ctx, pcLocked: true })
    for (const n of FILE_TOOLS) expect(locked).not.toContain(n)
    expect(locked).toEqual(expect.arrayContaining(['get_page', 'navigate', 'login']))
  })

  it('Codex 인자: 셸·그림 보기·앱·컴퓨터/브라우저 조작을 모두 끈다', () => {
    const args = buildCodexArgs({ model: 'gpt-6.1-sol', noLocalAccess: true }).join(' ')
    for (const f of CODEX_NO_LOCAL_ACCESS) expect(args).toContain(`-c features.${f}=false`)
    expect(CODEX_NO_LOCAL_ACCESS).toEqual(
      expect.arrayContaining(['shell_tool', 'unified_exec', 'view_image', 'apps'])
    )
    // 코드 실행 호스트는 끄지 않는다 — 끄면 노든 도구까지 못 부른다
    expect(CODEX_NO_LOCAL_ACCESS).not.toContain('code_mode_host')
  })
})
