// 윈도우 알림 — 앱 창을 보고 있지 않을 때만 작업 끝·확인 필요를 띄운다
import { describe, it, expect, vi } from 'vitest'
import { createAgentNotifier } from '../src/main/notify'
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../src/shared/settings'

function harness(
  focused: boolean,
  patch: Partial<Settings> = {}
): { shown: Array<[string, string]>; notifier: ReturnType<typeof createAgentNotifier> } {
  const shown: Array<[string, string]> = []
  const notifier = createAgentNotifier({
    settings: () => parseSettings({ ...DEFAULT_SETTINGS, ...patch }),
    fetchImpl: vi.fn(),
    desktop: { appFocused: () => focused, show: (t, b) => shown.push([t, b]) }
  })
  return { shown, notifier }
}

describe('윈도우 알림', () => {
  it('창을 보고 있지 않으면 작업 끝을 띄운다(제목에 꼬리표 없음)', () => {
    const { shown, notifier } = harness(false)
    notifier.setPrompt('쿠팡 주문 확인해줘')
    notifier.observe({ type: 'text', text: '오늘 주문 3건입니다' })
    notifier.observe({ type: 'status', state: 'done', toolCalls: 2 })
    expect(shown).toHaveLength(1)
    expect(shown[0][0]).toBe('작업 완료')
    expect(shown[0][1]).toContain('쿠팡 주문 확인해줘')
    expect(shown[0][1]).toContain('오늘 주문 3건입니다')
  })

  it('확인 카드도 띄우고, 창을 보고 있거나 꺼 두면 띄우지 않는다', () => {
    const away = harness(false)
    away.notifier.observe({ type: 'confirm', requestId: 'r1', action: '결제하기 클릭' })
    expect(away.shown[0][0]).toBe('확인 필요')
    const looking = harness(true)
    looking.notifier.observe({ type: 'status', state: 'done', toolCalls: 1 })
    expect(looking.shown).toEqual([])
    const off = harness(false, { notifyDesktopEnabled: false })
    off.notifier.observe({ type: 'status', state: 'done', toolCalls: 1 })
    expect(off.shown).toEqual([])
  })

  it('사용자가 멈춘 작업은 알리지 않는다', () => {
    const { shown, notifier } = harness(false)
    notifier.observe({ type: 'status', state: 'stopped', toolCalls: 1 })
    expect(shown).toEqual([])
  })
})
