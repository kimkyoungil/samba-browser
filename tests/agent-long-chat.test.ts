// 긴 대화 — Aside 에서 겪은 '대화가 쌓이면 압축이 안 돼 그 채팅이 더는 안 됨'이 노든 브라우저에서 안 나게
// ① 문맥이 창의 일정 비율을 넘으면 다음 지시는 새 세션 + 앞부분 요약으로 시작한다
// ② 그래도 문맥 초과로 실패하면 세션 연결을 지운다(같은 막힌 세션을 다시 이어받지 않게)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import {
  ChatSessionStore,
  DEFAULT_CONTEXT_WINDOW,
  RESUME_MAX_RUNS,
  ROTATE_CONTEXT_MAX,
  isContextOverflowError,
  shouldStartFresh
} from '../src/main/agent/chat-session'

// 호출마다 다른 스트림을 준다(첫 호출 = 넘침, 다음 호출 = 정상 등)
let scripts: unknown[][] = []
const queryInputs: ProviderInput[] = []

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      queryInputs.push(input)
      const messages = scripts.shift() ?? []
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const m of messages) yield m
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

function makeRunner(store: ChatSessionStore): {
  runner: InstanceType<typeof AgentRunner>
  events: AgentEvent[]
} {
  const events: AgentEvent[] = []
  const settings = {
    get: () => ({
      model: 'sonnet',
      language: 'ko',
      panelWidth: 380,
      lastUrl: '',
      dangerWords: [],
      maxToolCalls: 40
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  runner.setChatSessions(store, () => [
    { role: 'user', content: '앞에서 한 지시' },
    { role: 'assistant', content: '앞에서 한 보고' }
  ])
  return { runner, events }
}

const tmpStore = (): ChatSessionStore =>
  new ChatSessionStore(join(mkdtempSync(join(tmpdir(), 'samba-long-chat-')), 'cs.json'))
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))
const init = (id: string): unknown => ({ type: 'system', subtype: 'init', session_id: id })
const said = (text: string, used: number): unknown => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, cache_read_input_tokens: used - 10, cache_creation_input_tokens: 0 }
  }
})
const ok = (window = 200_000): unknown => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  modelUsage: { sonnet: { contextWindow: window } }
})
const tooLong = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: 'Prompt is too long'
}

beforeEach(() => {
  scripts = []
  queryInputs.length = 0
})

describe('shouldStartFresh — 다음 지시를 새 세션으로 시작할지', () => {
  it('세션이 없으면 새로 시작한다', () => {
    expect(shouldStartFresh(null)).toBe(true)
  })
  it('실행 횟수 상한을 넘으면 새로 시작한다(종전 규칙 그대로)', () => {
    expect(shouldStartFresh({ sessionId: 'a', runs: RESUME_MAX_RUNS })).toBe(true)
    expect(shouldStartFresh({ sessionId: 'a', runs: RESUME_MAX_RUNS - 1 })).toBe(false)
  })
  it('문맥이 창의 60% 를 넘으면 새로 시작한다', () => {
    expect(
      shouldStartFresh({ sessionId: 'a', runs: 3, contextTokens: 130_000, contextWindow: 200_000 })
    ).toBe(true)
    expect(
      shouldStartFresh({ sessionId: 'a', runs: 3, contextTokens: 100_000, contextWindow: 200_000 })
    ).toBe(false)
  })
  it('창 크기를 모르면 기본 창으로 잰다', () => {
    const edge = DEFAULT_CONTEXT_WINDOW * 0.6
    expect(shouldStartFresh({ sessionId: 'a', runs: 3, contextTokens: edge })).toBe(true)
    expect(shouldStartFresh({ sessionId: 'a', runs: 3, contextTokens: edge - 1 })).toBe(false)
  })
  it('창이 아주 커도(1M) 상한을 넘으면 새로 시작한다', () => {
    const big = { sessionId: 'a', runs: 3, contextWindow: 1_000_000 }
    expect(shouldStartFresh({ ...big, contextTokens: ROTATE_CONTEXT_MAX })).toBe(true)
    expect(shouldStartFresh({ ...big, contextTokens: ROTATE_CONTEXT_MAX - 1 })).toBe(false)
  })
})

describe('isContextOverflowError — 문맥 초과 문구', () => {
  it.each([
    'Prompt is too long',
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210345 tokens > 200000 maximum"}}',
    'Conversation too long. Press esc twice to go up a few messages and try again.',
    'Error during compaction: Conversation too long',
    'input length and max_tokens exceed context limit: maximum context length is 200000',
    'request_too_large'
  ])('넘침으로 본다: %s', (t) => {
    expect(isContextOverflowError(t)).toBe(true)
  })
  it.each([
    'OAuth token has expired',
    'rate_limit_error',
    'Overloaded',
    '결제 화면을 읽었습니다',
    ''
  ])('넘침이 아니다: %s', (t) => {
    expect(isContextOverflowError(t)).toBe(false)
  })
})

describe('ChatSessionStore — 문맥 크기 기록', () => {
  it('문맥 크기·창을 남기고 다시 켜도 읽는다', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'samba-long-chat-')), 'cs.json')
    const store = new ChatSessionStore(file)
    store.note(5, 's1', { contextTokens: 90_000, contextWindow: 200_000 })
    expect(new ChatSessionStore(file).get(5)).toEqual({
      sessionId: 's1',
      runs: 1,
      contextTokens: 90_000,
      contextWindow: 200_000
    })
  })
})

describe('실행기 — 긴 대화', () => {
  it('이어받은 세션이 넘치면 세션을 지우고 요약으로 새 세션을 열어 같은 지시를 한 번 다시 돈다', async () => {
    const store = tmpStore()
    store.note(1, 'old-sess', { contextTokens: 50_000, contextWindow: 200_000 })
    const { runner, events } = makeRunner(store)
    scripts = [
      [init('old-sess'), tooLong],
      [init('new-sess'), said('다시 했습니다', 20_000), ok()]
    ]
    await runner.run('주문 처리해', 1)
    await tick(60)
    expect(queryInputs).toHaveLength(2)
    expect(queryInputs[0].resume).toBe('old-sess')
    // 두 번째는 이어받지 않고, 앞부분 요약을 지시문 앞에 붙인다
    expect(queryInputs[1].resume).toBeUndefined()
    expect(queryInputs[1].prompt).toContain('앞부분 요약')
    expect(queryInputs[1].prompt).toContain('주문 처리해')
    expect(store.get(1)).toEqual({
      sessionId: 'new-sess',
      runs: 1,
      contextTokens: 20_000,
      contextWindow: 200_000
    })
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)
    expect(texts.some((t) => t.includes('새 세션을 열어 다시 시작'))).toBe(true)
    // 넘친 첫 실행은 실패로 끝내지 않는다(다시 돌아 끝났다)
    const statuses = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { state: string }).state)
    expect(statuses).not.toContain('failed')
    expect(statuses[statuses.length - 1]).toBe('done')
  })

  it('새 세션에서 넘쳤으면 다시 돌지는 않지만 연결을 남기지 않아 다음 말은 새로 시작한다', async () => {
    const store = tmpStore()
    const { runner, events } = makeRunner(store)
    scripts = [[init('fresh'), tooLong]]
    await runner.run('아주 긴 작업', 2)
    await tick(40)
    expect(queryInputs).toHaveLength(1)
    expect(store.get(2)).toBeNull()
    const statuses = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { state: string }).state)
    expect(statuses).toContain('failed')
  })

  it('문맥이 창의 60% 를 넘긴 채 끝났으면 다음 지시는 이어받지 않고 요약으로 시작한다', async () => {
    const store = tmpStore()
    const { runner, events } = makeRunner(store)
    scripts = [
      [init('s1'), said('첫 보고', 150_000), ok()],
      [init('s2'), said('둘째 보고', 15_000), ok()]
    ]
    await runner.run('첫 지시', 3)
    await tick(40)
    expect(store.get(3)?.contextTokens).toBe(150_000)
    await runner.run('둘째 지시', 3)
    await tick(40)
    expect(queryInputs[1].resume).toBeUndefined()
    // 기록 저장소가 없으면 자동 압축을 못 해 예전처럼 최근 턴만 넘긴다
    expect(queryInputs[1].prompt).toContain('앞부분 요약')
    expect(queryInputs[1].prompt).toContain('앞에서 한 보고')
    void events
  })

  it('새 세션으로 넘어갈 때 AI 가 앞 대화를 요약해(/compact 처럼) 기록에 남기고, 새 세션은 그 요약부터 싣는다', async () => {
    const store = tmpStore()
    const { runner, events } = makeRunner(store)
    // 기록: 앞 대화 + 저장되는 줄(자동 압축 요약이 여기로 들어온다)
    const rows: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: '쿠팡 11계정은 셀릭스야, 기억해' },
      { role: 'assistant', content: '네, 11계정 = 셀릭스로 기억할게요' }
    ]
    const saved: { prompt: string; text: string }[] = []
    runner.setChatSessions(store, () => rows)
    runner.setTranscript((_chatId, entry) => {
      saved.push({ prompt: entry.prompt, text: entry.text })
      if (entry.prompt !== '') rows.push({ role: 'user', content: entry.prompt })
      rows.push({ role: 'assistant', content: entry.text })
      return null
    })
    scripts = [
      [init('s1'), said('첫 보고', 150_000), ok()],
      // 자동 압축 요청의 답
      [said('- 목표·지시: 11계정 = 셀릭스', 2_000), ok()],
      [init('s2'), said('둘째 보고', 15_000), ok()]
    ]
    await runner.run('첫 지시', 5)
    await tick(40)
    await runner.run('둘째 지시', 5)
    await tick(60)
    // 1) 요약 요청은 도구 없이, 기록 원문으로
    expect(queryInputs[1].allowedTools).toEqual([])
    expect(queryInputs[1].prompt).toContain('쿠팡 11계정은 셀릭스야')
    expect(queryInputs[1].prompt).toContain('continues in a fresh session')
    // 2) 기록에 압축 요약 한 줄(사용자 말 없이)
    expect(saved.some((r) => r.prompt === '' && r.text.includes('11계정 = 셀릭스'))).toBe(true)
    // 3) 새 세션은 이어받지 않고 그 요약을 앞부분으로 싣는다
    expect(queryInputs[2].resume).toBeUndefined()
    expect(queryInputs[2].prompt).toContain('[앞 대화 압축 요약]')
    expect(queryInputs[2].prompt).toContain('- 목표·지시: 11계정 = 셀릭스')
    expect(events).toContainEqual({
      type: 'step',
      label: '대화가 길어져 앞 대화 요약(새 세션으로)',
      ok: true
    })
  })

  it('문맥이 작으면 종전처럼 같은 세션을 이어받는다', async () => {
    const store = tmpStore()
    const { runner } = makeRunner(store)
    scripts = [
      [init('s1'), said('첫 보고', 40_000), ok()],
      [init('s1'), said('둘째 보고', 45_000), ok()]
    ]
    await runner.run('첫 지시', 4)
    await tick(40)
    await runner.run('둘째 지시', 4)
    await tick(40)
    expect(queryInputs[1].resume).toBe('s1')
    expect(store.get(4)).toEqual({
      sessionId: 's1',
      runs: 2,
      contextTokens: 45_000,
      contextWindow: 200_000
    })
  })

  it('SDK 가 스스로 압축했으면 압축 뒤 크기로 센다', async () => {
    const store = tmpStore()
    const { runner } = makeRunner(store)
    scripts = [
      [
        init('s1'),
        said('길게 일함', 170_000),
        {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: { trigger: 'auto', pre_tokens: 170_000, post_tokens: 30_000 }
        },
        ok()
      ]
    ]
    await runner.run('지시', 5)
    await tick(40)
    expect(store.get(5)?.contextTokens).toBe(30_000)
  })
})
