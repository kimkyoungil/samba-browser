// 대화방별 실행기 묶음 — 두 대화가 동시에 돌고, 브라우저 도구만 차례를 기다린다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatAgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { ToolContext } from '../src/main/agent/tools'

// 실행마다 끝을 손으로 풀어 준다(그동안 실행이 살아 있다)
let releases: Array<() => void> = []
let ctxs: ToolContext[] = []

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      void input
      return (async function* () {
        await new Promise<void>((r) => releases.push(r))
        yield { type: 'result', subtype: 'success', is_error: false, result: '끝' }
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
      ctxs.push(ctx)
      return { name: 'samba-stub' }
    }
  }
})

const { AgentRunnerPool } = await import('../src/main/agent/runner-pool')
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !ok(); i++) await tick()
  expect(ok()).toBe(true)
}

function makePool(): {
  pool: InstanceType<typeof AgentRunnerPool>
  events: ChatAgentEvent[]
  clearAgentTarget: ReturnType<typeof vi.fn>
} {
  const events: ChatAgentEvent[] = []
  const clearAgentTarget = vi.fn()
  const settings = {
    get: () => ({
      model: 'sonnet',
      language: 'ko',
      panelWidth: 380,
      lastUrl: '',
      dangerWords: [],
      maxToolCalls: 40,
      agentEffort: 'medium',
      permissionMode: 'guard'
    })
  }
  const pool = new AgentRunnerPool(
    { clearAgentTarget } as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  pool.setEngineRouting(() => ({
    engine: 'claude',
    auth: { mode: 'claude_subscription' },
    model: 'claude-sonnet-5-5'
  }))
  pool.setChatTitles((id) => `대화${id}`)
  return { pool, events, clearAgentTarget }
}

const statusOf = (events: ChatAgentEvent[], state: string): Array<number | undefined> =>
  events.filter((e) => e.type === 'status' && e.state === state).map((e) => e.chatId)

beforeEach(() => {
  releases = []
  ctxs = []
})

describe('대화방별 실행기 묶음', () => {
  it('두 대화가 동시에 돈다 — 이벤트에는 그 대화 번호가 붙는다', async () => {
    const { pool, events } = makePool()
    const one = pool.run('첫째 일', 1)
    const two = pool.run('둘째 일', 2)
    await until(() => releases.length === 2)
    expect(statusOf(events, 'running')).toEqual([1, 2])
    expect(pool.hasActiveRun()).toBe(true)
    for (const r of releases) r()
    await Promise.all([one, two])
    expect(statusOf(events, 'done').sort()).toEqual([1, 2])
    expect(pool.hasActiveRun()).toBe(false)
  })

  it('브라우저 도구는 차례를 기다린다 — 쓰는 대화 이름을 알리고, 앞 일이 끝나면 넘겨받는다', async () => {
    const { pool, events, clearAgentTarget } = makePool()
    const one = pool.run('첫째 일', 1)
    const two = pool.run('둘째 일', 2)
    await until(() => releases.length === 2)
    const [ctx1, ctx2] = ctxs
    // 첫째가 먼저 잡는다(새 지시라 작업 탭 표식을 지운다)
    await ctx1.browserTurn?.()
    expect(clearAgentTarget).toHaveBeenCalledTimes(1)
    let secondGot = false
    void ctx2.browserTurn?.().then(() => (secondGot = true))
    await tick()
    expect(secondGot).toBe(false)
    const waitStep = events.find((e) => e.type === 'step' && e.chatId === 2)
    expect(waitStep).toMatchObject({
      type: 'step',
      label: "브라우저 차례 기다리는 중 — '대화1' 대화가 쓰는 중"
    })
    // 첫째 일이 끝나면 둘째가 받는다
    releases[0]()
    await one
    await until(() => secondGot)
    expect(clearAgentTarget).toHaveBeenCalledTimes(2)
    releases[1]()
    await two
  })

  it('중단은 그 대화만 멈추고, 쥔 브라우저 차례도 곧바로 넘긴다', async () => {
    const { pool, events } = makePool()
    const one = pool.run('첫째 일', 1)
    const two = pool.run('둘째 일', 2)
    await until(() => releases.length === 2)
    await ctxs[0].browserTurn?.()
    let secondGot = false
    void ctxs[1].browserTurn?.().then(() => (secondGot = true))
    pool.stop(1)
    expect(statusOf(events, 'stopped')).toEqual([1])
    await until(() => secondGot)
    expect(pool.hasActiveRun()).toBe(true)
    for (const r of releases) r()
    await Promise.all([one, two])
  })

  it('같은 대화는 하나만 돈다(이미 일하는 대화에 또 보내면 거절)', async () => {
    const { pool } = makePool()
    const one = pool.run('첫째 일', 1)
    await until(() => releases.length === 1)
    await expect(pool.run('또', 1)).rejects.toThrow('이미 실행 중')
    releases[0]()
    await one
  })
})
