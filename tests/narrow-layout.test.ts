// 좁은 창 배치 — 폰으로 볼 때 노든 창은 300px 남짓이라 한 번에 한 칸만 꽉 채운다
import { describe, it, expect } from 'vitest'
import { isNarrowWidth, narrowPane, NARROW_MAX } from '../src/renderer/src/lib/narrow-layout'

describe('좁은 창 배치', () => {
  it('PC 창(최소 1000)은 넓은 배치, 폰 가상 모니터 폭은 좁은 배치', () => {
    expect(isNarrowWidth(1000)).toBe(false)
    expect(isNarrowWidth(NARROW_MAX)).toBe(false)
    expect(isNarrowWidth(357)).toBe(true)
    expect(isNarrowWidth(286)).toBe(true)
  })

  it('펼친 사이드바가 먼저, 그다음 열린 AI 창, 아니면 브라우저', () => {
    expect(narrowPane(false, false)).toBe('sidebar')
    expect(narrowPane(false, true)).toBe('sidebar')
    expect(narrowPane(true, false)).toBe('panel')
    expect(narrowPane(true, true)).toBe('main')
  })
})
