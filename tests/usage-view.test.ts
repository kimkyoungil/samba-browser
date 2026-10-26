// 입력줄 사용량 링 — 링에 그릴 한도와 초기화 시각 글자
import { describe, it, expect } from 'vitest'
import { pickHeadlineLimit, usageResetText } from '../src/renderer/src/lib/usage-view'

describe('사용량 링', () => {
  it('가장 많이 쓴 한도를 고르고, 없으면 null', () => {
    expect(
      pickHeadlineLimit([
        { kind: 'session', percent: 12, resetsAt: null },
        { kind: 'weekly_all', percent: 70, resetsAt: null },
        { kind: 'weekly_scoped', percent: 70, resetsAt: null, model: 'Sonnet' }
      ])?.kind
    ).toBe('weekly_all')
    expect(pickHeadlineLimit([])).toBeNull()
  })

  it('초기화 시각: 오늘이면 시각만, 아니면 요일과 시각', () => {
    // 시험 환경의 Node 는 한국어 날짜 자료가 없을 수 있다(오후 → PM) — 글자 대신 꼴을 본다
    const now = new Date(2026, 9, 26, 14, 0)
    const today = new Date(2026, 9, 26, 19, 0)
    const thursday = new Date(2026, 9, 29, 19, 0)
    const time = (d: Date): string =>
      d.toLocaleTimeString('ko', { hour: 'numeric', minute: '2-digit' })
    const day = thursday.toLocaleDateString('ko', { weekday: 'short' })
    expect(usageResetText(today.toISOString(), 'ko', now)).toBe(time(today))
    expect(usageResetText(thursday.toISOString(), 'ko', now)).toBe(`(${day}) ${time(thursday)}`)
    expect(usageResetText('엉뚱한 값', 'ko', now)).toBe('')
  })
})
