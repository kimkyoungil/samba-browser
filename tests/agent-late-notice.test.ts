// 이어 돌기 안내 글은 끝 상태보다 먼저 — 화면은 끝 상태를 받자마자 대기열의 다음 말(다른 대화일 수도)을
// 시작하므로, 뒤에 오면 그 새 답 말풍선에 붙었다(실기 2026-10-24)
import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ToolContext } from '../src/main/agent/tools'

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: () =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '다 했어요' }] } }
        yield { type: 'result', subtype: 'success', is_error: false, result: '다 했어요' }
      })()
  }
})
// 도구를 세 번 쓴 것처럼 센다(done 은 부르지 않았다) — '답 없이 멈춤' 자동 이어가기가 걸린다
vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: (ctx: ToolContext) => {
    ctx.tick()
    ctx.tick()
    ctx.tick()
    return {}
  },
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

describe('이어 돌기 안내 글', () => {
  it('끝 상태보다 먼저 보낸다', async () => {
    const events: AgentEvent[] = []
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
    runner.setEngineRouting(() => ({
      engine: 'claude',
      auth: { mode: 'claude_subscription' },
      model: 'claude-sonnet-5-5'
    }))
    await runner.run('일해', 1)
    // 이어 돌기 실행이 시작되기 전에 멈춘다
    runner.stop()
    const order = events.flatMap((e) =>
      e.type === 'text' ? [`text:${e.text}`] : e.type === 'status' ? [`status:${e.state}`] : []
    )
    const notice = order.indexOf('text:(답 없이 멈춰 자동으로 이어갑니다)')
    const done = order.indexOf('status:done')
    expect(notice).toBeGreaterThanOrEqual(0)
    expect(done).toBeGreaterThan(notice)
  })
})
