// 구독 로그인 만료 — 자격 파일이 있어도 실행이 인증 실패로 막혔으면 카드가 '연결됨' 대신 '로그인 만료'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { AgentAuth } from '../src/main/ai/auth-route'
import {
  CLAUDE_CREDENTIAL_PATHS,
  LOGIN_FILE,
  RELOGIN_GRACE_MS,
  detectSubscription,
  loginExpired,
  type ProviderProbes
} from '../src/main/ai/providers'
import { parseSettings } from '../src/shared/settings'
import type { AiConnections } from '../src/shared/ai'

const EXPIRED_AT = 1_000_000

function probes(mtime: number | null): ProviderProbes {
  return {
    fileExists: (p) => CLAUDE_CREDENTIAL_PATHS.includes(p),
    runVersion: () => Promise.resolve(true),
    readAccount: () => 'other@example.com',
    fileMtime: (p) => (p === LOGIN_FILE.claude_subscription ? mtime : null)
  }
}

const expiredConnections: AiConnections = {
  claude: { connected: true, account: 'me@example.com', connectedAt: 1, expiredAt: EXPIRED_AT },
  codex: { connected: false }
}

describe('loginExpired — 실패 뒤 다시 로그인했는가', () => {
  const rec = { connected: true, expiredAt: EXPIRED_AT }
  it('실패 기록이 없으면 만료가 아니다', () => {
    expect(loginExpired('claude_subscription', { connected: true }, probes(null))).toBe(false)
  })
  it('로그인 파일이 그대로(또는 못 읽음)면 만료', () => {
    expect(loginExpired('claude_subscription', rec, probes(EXPIRED_AT - 60_000))).toBe(true)
    expect(loginExpired('claude_subscription', rec, probes(null))).toBe(true)
  })
  it('실패 직후 CLI 가 파일을 고쳐 쓴 몫은 다시 로그인으로 보지 않는다', () => {
    expect(loginExpired('claude_subscription', rec, probes(EXPIRED_AT + 3_000))).toBe(true)
  })
  it('그 뒤로 로그인 파일이 새로 써졌으면(다시 로그인) 만료가 풀린다', () => {
    expect(
      loginExpired('claude_subscription', rec, probes(EXPIRED_AT + RELOGIN_GRACE_MS + 1))
    ).toBe(false)
  })
  it('다시 로그인 흔적은 자주 바뀌는 ~/.claude.json 이 아니라 자격 파일로만 본다', () => {
    expect(LOGIN_FILE.claude_subscription).toBe(CLAUDE_CREDENTIAL_PATHS[0])
    expect(LOGIN_FILE.claude_subscription.endsWith('.credentials.json')).toBe(true)
  })
})

describe('detectSubscription — 만료 카드', () => {
  it('연결 기록이 있어도 실패 뒤 다시 로그인 안 했으면 expired + 저장된 계정', async () => {
    const s = await detectSubscription('claude_subscription', probes(1), expiredConnections)
    expect(s.state).toBe('expired')
    expect(s.connected).toBe(true)
    expect(s.account).toBe('me@example.com')
  })
  it('다시 로그인했으면 connected 로 돌아온다', async () => {
    const s = await detectSubscription(
      'claude_subscription',
      probes(EXPIRED_AT + 60_000),
      expiredConnections
    )
    expect(s.state).toBe('connected')
  })
  it('연결 안 한 구독은 실패 기록과 무관하게 available', async () => {
    const s = await detectSubscription('claude_subscription', probes(1), {
      claude: { connected: false, expiredAt: EXPIRED_AT },
      codex: { connected: false }
    })
    expect(s.state).toBe('available')
  })
})

describe('설정 저장 — 실패 시각은 남고, 깨진 값은 버린다', () => {
  it('expiredAt 을 읽어 들인다', () => {
    const s = parseSettings({ aiConnections: expiredConnections })
    expect(s.aiConnections.claude.expiredAt).toBe(EXPIRED_AT)
    const broken = parseSettings({
      aiConnections: { claude: { connected: true, expiredAt: 'x' }, codex: { connected: false } }
    })
    expect(broken.aiConnections.claude.expiredAt).toBeUndefined()
    expect(broken.aiConnections.claude.connected).toBe(true)
  })
})

// ── 실행기: 끝난 실행이 로그인이 살아 있는지 알린다 ─────────────────────────────

let script: unknown[] = []
let fallbackIndex = 0
// 예비 계정이 있는 PC 인가(있으면 넘길 때 순번이 오른다)
let hasFallback = false

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    subscriptionFallbackIndex: () => fallbackIndex,
    advanceSubscriptionFallback: () => {
      if (!hasFallback) return false
      fallbackIndex += 1
      return true
    },
    runQuery: () =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const m of script) yield m
      })()
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

function makeRunner(auth: AgentAuth): {
  runner: InstanceType<typeof AgentRunner>
  events: AgentEvent[]
  health: Array<[string, boolean]>
} {
  const events: AgentEvent[] = []
  const health: Array<[string, boolean]> = []
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
  runner.setEngineRouting(() => ({ engine: 'claude', auth, model: 'claude-sonnet-5-5' }))
  runner.setAuthHealth((a, ok) => health.push([a.mode, ok]))
  return { runner, events, health }
}

// 실기와 같은 모양: 인증 실패를 어시스턴트 메시지의 error 칸으로 알리고, 결과에는 글로 싣는다
const EXPIRED_TEXT = 'Failed to authenticate: OAuth session expired and could not be refreshed'
const expiredRun = [
  { type: 'system', subtype: 'init', session_id: 's1' },
  {
    type: 'assistant',
    parent_tool_use_id: null,
    error: 'authentication_failed',
    message: { content: [{ type: 'text', text: EXPIRED_TEXT }], usage: {} }
  },
  { type: 'result', subtype: 'success', is_error: true, result: EXPIRED_TEXT, modelUsage: {} }
]
const okRun = [
  { type: 'system', subtype: 'init', session_id: 's2' },
  { type: 'result', subtype: 'success', is_error: false, result: '4', modelUsage: {} }
]

beforeEach(() => {
  fallbackIndex = 0
  hasFallback = false
})

describe('실행기 — 로그인 만료 알림', () => {
  it('어시스턴트 메시지의 인증 실패는 연결 필요(auth:missing)로 끝나고 만료를 알린다', async () => {
    script = expiredRun
    const { runner, events, health } = makeRunner({ mode: 'claude_subscription' })
    await runner.run('2+2', 1)
    await new Promise((r) => setTimeout(r, 20))
    const last = events.filter((e) => e.type === 'status').pop() as { message?: string }
    expect(last.message).toBe('auth:missing')
    expect(health).toEqual([['claude_subscription', false]])
  })

  it('성공하면 살아 있다고 알린다(만료 해제)', async () => {
    script = okRun
    const { runner, health } = makeRunner({ mode: 'claude_subscription' })
    await runner.run('2+2', 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(health).toEqual([['claude_subscription', true]])
  })

  it('예비 계정으로 넘어간 뒤의 결과는 PC 로그인 것이 아니라 알리지 않는다', async () => {
    script = okRun
    fallbackIndex = 1
    const { runner, health } = makeRunner({ mode: 'claude_subscription' })
    await runner.run('2+2', 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(health).toEqual([])
  })

  it('PC 로그인이 막혀 예비 계정으로 넘어가면 넘기면서 한 번만 만료를 알린다', async () => {
    script = expiredRun
    hasFallback = true
    const { runner, health } = makeRunner({ mode: 'claude_subscription' })
    await runner.run('2+2', 1)
    await new Promise((r) => setTimeout(r, 50))
    // 예비 계정으로 다시 도는 실행의 결과는 알리지 않는다(순번이 0 이 아니다)
    expect(health).toEqual([['claude_subscription', false]])
  })

  it('내 API 키 경로는 구독 로그인과 무관해 알리지 않는다', async () => {
    script = expiredRun
    const { runner, health } = makeRunner({ mode: 'api_key' })
    await runner.run('2+2', 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(health).toEqual([])
  })
})
