// 당근 숨은 뷰의 영역 보정 — 화면 밖에서도 뷰포트가 있어야 하고, 오른쪽 영역은 당근이 1단으로 바뀌지 않는 폭 이상이어야 한다
import { describe, expect, it } from 'vitest'
import { MIN_ROOM_WIDTH, clampBounds, hiddenBounds } from '../src/main/daangn/bounds'

describe('hiddenBounds', () => {
  // 실측(2026-10-21): 창 밖 좌표(-10000)에 두면 뷰포트가 0 이 된다 — 숨김 창 안의 실제 영역이어야 한다
  it('숨김 창 안의 실제 영역(원점, 충분한 크기)이다', () => {
    const b = hiddenBounds()
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.width).toBeGreaterThanOrEqual(MIN_ROOM_WIDTH)
    expect(b.height).toBeGreaterThan(0)
  })
})

describe('clampBounds', () => {
  it('음수 높이는 1 이상으로 보정한다', () => {
    const b = clampBounds({ x: 10, y: 20, width: 800, height: -5 })
    expect(b?.height).toBeGreaterThanOrEqual(1)
    expect(b?.x).toBe(10)
    expect(b?.y).toBe(20)
  })
  it('최소 폭보다 좁으면 넓히지 않고 null(접기) — 옆 패널을 덮지 않는다', () => {
    expect(clampBounds({ x: 10, y: 20, width: MIN_ROOM_WIDTH - 1, height: 500 })).toBeNull()
  })
  it('정상 값은 정수로 반올림해 그대로 둔다', () => {
    expect(clampBounds({ x: 100.4, y: 50.6, width: 900.2, height: 700.7 })).toEqual({
      x: 100,
      y: 51,
      width: 900,
      height: 701
    })
  })
  it('NaN·Infinity 가 섞이면 숨김 영역 기본값으로 돌린다', () => {
    expect(clampBounds({ x: NaN, y: 0, width: 800, height: 600 })).toEqual(hiddenBounds())
    expect(clampBounds({ x: 0, y: 0, width: Infinity, height: 600 })).toEqual(hiddenBounds())
  })
})
