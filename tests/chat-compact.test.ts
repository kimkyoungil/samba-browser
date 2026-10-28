// /compact — 지금까지의 대화를 요약해 '압축 요약'으로 남기고, 다음 말은 그 요약으로 새로 시작한다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, AgentRunAck, IpcResult } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { CodexEvent, CodexInput } from '../src/main/agent/provider-codex'
import type { ChatSessionStore, HistoryMessage } from '../src/main/agent/chat-session'
import type { CodexThreadStore } from '../src/main/agent/codex-threads'
import { COMPACT_MARK, parseCompactCommand } from '../src/shared/chat'
import { buildHistoryNote, compactSourceText } from '../src/main/agent/chat-session'

// 호출마다 흉내 낼 SDK 메시지·Codex 사건(앞에서부터 한 호출씩 꺼낸다)
let claudeRuns: unknown[][] = []
let codexRuns: CodexEvent[][] = []
const claudeInputs: ProviderInput[] = []
const codexInputs: CodexInput[] = []

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      claudeInputs.push(input)
      const msgs = claudeRuns.shift() ?? []
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const m of msgs) yield m
      })()
    },
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      const events = codexRuns.shift() ?? []
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const e of events) yield e
      })()
    }
  }
})
vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({ name: 'samba-stub' }),
  SAMBA_TOOL_NAMES: ['mcp__samba__get_page']
}))

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
const inject = vi.fn(async () => ({ ok: true, data: { injected: true, id: 'J' } }))
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run, inject, stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), create: vi.fn() }
    }
  }
})

const { AgentRunner } = await import('../src/main/agent/runner')
const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

const SUMMARY = '- 목표·지시: 무신사 주문 3건 확인\n- 남은 일: 3번째 주문 송장'
const assistant = (text: string): unknown => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] }
})
const ok = { type: 'result', subtype: 'success', is_error: false, result: '' }
const fail = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['x'] }

const HISTORY: HistoryMessage[] = [
  { role: 'user', content: '무신사 주문 3건 확인해' },
  { role: 'assistant', content: '2건 확인했고 3번째는 송장 대기' }
]

function makeRunner(
  engine: 'claude' | 'codex',
  opts: { session?: string | null; thread?: string | null; history?: HistoryMessage[] } = {}
): {
  runner: InstanceType<typeof AgentRunner>
  events: AgentEvent[]
  saved: { prompt: string; text: string }[]
  sessions: { clear: ReturnType<typeof vi.fn> }
  threads: { clear: ReturnType<typeof vi.fn> }
} {
  const events: AgentEvent[] = []
  const saved: { prompt: string; text: string }[] = []
  const settings = {
    get: () => ({
      model: 'sonnet',
      language: 'ko',
      panelWidth: 380,
      lastUrl: '',
      dangerWords: [],
      maxToolCalls: 40,
      agentEffort: 'medium'
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  runner.setEngineRouting(() =>
    engine === 'codex'
      ? { engine, auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
      : { engine, auth: { mode: 'claude_subscription' }, model: 'claude-sonnet-5-5' }
  )
  const session = opts.session ?? null
  const sessions = {
    clear: vi.fn(),
    note: vi.fn(),
    get: () => (session ? { sessionId: session, runs: 1, updatedAt: 1 } : null)
  }
  const history = opts.history ?? HISTORY
  runner.setChatSessions(sessions as unknown as ChatSessionStore, () => history)
  const thread = opts.thread ?? null
  const threads = { clear: vi.fn(), set: vi.fn(), get: () => thread }
  runner.setCodexThreads(threads as unknown as CodexThreadStore)
  runner.setTranscript((_chatId, entry) => {
    saved.push({ prompt: entry.prompt, text: entry.text })
    return null
  })
  return { runner, events, saved, sessions, threads }
}
const ends = (events: AgentEvent[]): AgentEvent[] =>
  events.filter((e) => e.type === 'status' && e.state !== 'running')

beforeEach(() => {
  claudeRuns = []
  codexRuns = []
  claudeInputs.length = 0
  codexInputs.length = 0
})

describe('명령·앞부분 요약', () => {
  it('/compact 만 명령으로 읽고, 뒤의 글은 남길 내용이다', () => {
    expect(parseCompactCommand('/compact')).toBe('')
    expect(parseCompactCommand('  /compact 결제 위주로  ')).toBe('결제 위주로')
    expect(parseCompactCommand('/compactx')).toBeNull()
    expect(parseCompactCommand('compact')).toBeNull()
    expect(parseCompactCommand('이거 /compact 해줘')).toBeNull()
  })

  it('압축한 뒤의 앞부분 요약은 압축 요약부터 — 그 앞 대화는 싣지 않는다', () => {
    const messages: HistoryMessage[] = [
      { role: 'user', content: '아주 옛날 말' },
      { role: 'assistant', content: '옛 답' },
      { role: 'user', content: '/compact' },
      { role: 'assistant', content: `${COMPACT_MARK}\n${SUMMARY}` },
      { role: 'user', content: '이어서 송장 봐줘' }
    ]
    const note = buildHistoryNote(messages)
    expect(note).toContain(SUMMARY)
    expect(note).toContain('이어서 송장 봐줘')
    expect(note).not.toContain('아주 옛날 말')
    const source = compactSourceText(messages)
    expect(source).toContain(SUMMARY)
    expect(source).not.toContain('옛 답')
    expect(compactSourceText([])).toBe('')
  })
})

describe('러너 — /compact', () => {
  it('Claude: 이어받던 세션으로 요약하고(도구 정의 유지), 압축 요약으로 남긴 뒤 세션을 버린다', async () => {
    const { runner, events, saved, sessions, threads } = makeRunner('claude', { session: 'S-1' })
    claudeRuns = [[assistant(SUMMARY), ok]]
    await runner.run('/compact 송장 위주로', 5)
    expect(claudeInputs).toHaveLength(1)
    expect(claudeInputs[0].resume).toBe('S-1')
    expect(claudeInputs[0].prompt).toContain('The user ran /compact')
    expect(claudeInputs[0].prompt).toContain('Keep especially: 송장 위주로')
    expect(Object.keys(claudeInputs[0].mcpServers ?? {})).toEqual(['samba'])
    expect(events).toContainEqual({ type: 'text', text: `${COMPACT_MARK}\n${SUMMARY}` })
    expect(ends(events)).toEqual([{ type: 'status', state: 'done', toolCalls: 0 }])
    expect(sessions.clear).toHaveBeenCalledWith(5)
    expect(threads.clear).toHaveBeenCalledWith(5)
    expect(saved).toEqual([{ prompt: '/compact 송장 위주로', text: `${COMPACT_MARK}\n${SUMMARY}` }])
  })

  it('이어받기 요약이 실패하면 기록으로 다시 요약한다', async () => {
    const { runner, events } = makeRunner('claude', { session: 'S-1' })
    claudeRuns = [[fail], [assistant(SUMMARY), ok]]
    await runner.run('/compact', 5)
    expect(claudeInputs.map((i) => i.resume)).toEqual(['S-1', undefined])
    expect(claudeInputs[1].prompt).toContain('[지금까지의 대화 기록]')
    expect(claudeInputs[1].prompt).toContain('2건 확인했고')
    expect(claudeInputs[1].mcpServers).toEqual({})
    expect(events).toContainEqual({ type: 'text', text: `${COMPACT_MARK}\n${SUMMARY}` })
  })

  it('세션이 없으면 처음부터 기록으로 요약한다', async () => {
    const { runner } = makeRunner('claude')
    claudeRuns = [[assistant(SUMMARY), ok]]
    await runner.run('/compact', 5)
    expect(claudeInputs).toHaveLength(1)
    expect(claudeInputs[0].resume).toBeUndefined()
    expect(claudeInputs[0].prompt).toContain('무신사 주문 3건 확인해')
  })

  it('요약할 대화가 없으면 그렇다고만 알린다', async () => {
    const { runner, events, sessions } = makeRunner('claude', { history: [] })
    await runner.run('/compact', 5)
    expect(claudeInputs).toHaveLength(0)
    expect(events).toContainEqual({ type: 'text', text: '(압축할 대화가 아직 없어요)' })
    expect(sessions.clear).not.toHaveBeenCalled()
  })

  it('요약을 끝내 못 받으면 실패로 알리고 세션은 그대로 둔다', async () => {
    const { runner, events, sessions } = makeRunner('claude', { session: 'S-1' })
    claudeRuns = [[fail], [fail]]
    await runner.run('/compact', 5)
    expect(ends(events)[0]).toMatchObject({ type: 'status', state: 'failed' })
    expect(sessions.clear).not.toHaveBeenCalled()
  })

  it('Codex: 이어받던 스레드로 요약하고 스레드를 버린다', async () => {
    const { runner, events, threads } = makeRunner('codex', { thread: 'T-1' })
    codexRuns = [
      [
        { type: 'thread', id: 'T-1' },
        { type: 'text', text: SUMMARY },
        { type: 'done', ok: true }
      ]
    ]
    await runner.run('/compact', 5)
    expect(codexInputs[0].resume).toBe('T-1')
    expect(codexInputs[0].prompt).toContain('The user ran /compact')
    expect(threads.clear).toHaveBeenCalledWith(5)
    expect(events).toContainEqual({ type: 'text', text: `${COMPACT_MARK}\n${SUMMARY}` })
  })

  it('Codex: 모델이 붐벼(429·용량 부족) 요약을 못 받으면 한도가 아니라 붐빔으로 알리고, 길마다 한 번씩만 해 본다', async () => {
    const { runner, events, threads } = makeRunner('codex', { thread: 'T-1' })
    const busy: CodexEvent[] = [
      { type: 'error', message: 'exceeded retry limit, last status: 429 Too Many Requests' },
      { type: 'done', ok: false }
    ]
    const capacity: CodexEvent[] = [
      {
        type: 'done',
        ok: false,
        message: 'Selected model is at capacity. Please try a different model.'
      }
    ]
    codexRuns = [busy, capacity]
    await runner.run('/compact', 5)
    // 이어받기 한 번 + 기록 원문 한 번
    expect(codexInputs).toHaveLength(2)
    expect(ends(events)[0]).toMatchObject({ type: 'status', state: 'failed', message: 'auth:busy' })
    expect(threads.clear).not.toHaveBeenCalled()
  })

  it('Codex: 진짜 사용 한도면 한도로 알린다', async () => {
    const { runner, events } = makeRunner('codex')
    codexRuns = [[{ type: 'done', ok: false, message: "You've hit your usage limit." }]]
    await runner.run('/compact', 5)
    expect(codexInputs).toHaveLength(1)
    expect(ends(events)[0]).toMatchObject({
      type: 'status',
      state: 'failed',
      message: 'auth:limit'
    })
  })
})

describe('화면 — /compact', () => {
  it('일하는 중에 보낸 /compact 는 끼워 넣지 않고 끝난 뒤에 돈다', async () => {
    useChatStore.setState({ status: 'running', activeChatId: 5, queue: [] })
    await useChatStore.getState().sendWhileRunning('/compact')
    expect(inject).not.toHaveBeenCalled()
    expect(useChatStore.getState().queue).toEqual([{ text: '/compact', chatId: 5 }])
  })
})
