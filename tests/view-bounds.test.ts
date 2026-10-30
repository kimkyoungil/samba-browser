import { describe, it, expect } from 'vitest'
import {
  COLLAPSED_MIN_HEIGHT,
  COLLAPSED_MIN_WIDTH,
  computeBehindBounds,
  computeViewBounds,
  needsCollapsedSize
} from '../src/main/browser/tab-manager'
import type { Layout } from '../src/shared/ipc'

// 렌더러가 1440x900 뷰포트에서 잰 실측값(계산 로직 자체는 여백 수치에 의존하지 않으므로
// 임의의 여백 값으로도 알고리즘 검증이 가능하다 — edge-to-edge 레이아웃 이후에도 그대로 유효)
const reported: Layout = {
  x: 233,
  y: 101,
  width: 816,
  height: 788,
  viewportWidth: 1440,
  viewportHeight: 900
}

describe('computeViewBounds', () => {
  it('보고 시점과 창 크기가 같으면 좌표를 그대로 쓴다', () => {
    const b = computeViewBounds(reported, 1440, 900)
    expect(b.x).toBe(233)
    expect(b.y).toBe(101)
    expect(b.width).toBe(816)
    expect(b.height).toBe(788)
  })

  it('창이 줄어든 뒤 보고가 누락돼도 아래·오른쪽 여백을 유지한다', () => {
    // 1440x900 -> 1427x889 로 줄었는데 렌더러가 다시 보고하지 않은 상황
    const b = computeViewBounds(reported, 1427, 889)
    // 아래 여백 11px(패딩 10 + 테두리 1), 오른쪽 여백 391px 이 그대로 유지돼야 한다
    expect(b.y + b.height).toBe(889 - 11)
    expect(b.x + b.width).toBe(1427 - 391)
  })

  it('창이 커져도 여백을 유지한다(최대화)', () => {
    const b = computeViewBounds(reported, 1920, 1032)
    expect(b.y + b.height).toBe(1032 - 11)
    expect(b.x + b.width).toBe(1920 - 391)
  })

  it('접힌 레이아웃(browser 뷰가 아닐 때)은 0 으로 유지된다', () => {
    const b = computeViewBounds(
      { x: 0, y: 0, width: 0, height: 0, viewportWidth: 1440, viewportHeight: 900 },
      1920,
      1032
    )
    expect(b).toEqual({ x: 0, y: 0, width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 })
  })

  it('창이 여백보다 작아지면 음수 대신 0 크기를 돌려준다', () => {
    const b = computeViewBounds(reported, 300, 80)
    expect(b.width).toBe(0)
    expect(b.height).toBe(0)
  })

  it('모바일: 넓은 레이아웃에서는 412px 카드가 가운데 정렬된다', () => {
    // 1440x900 에서 잰 reported(가용 폭 816px)를 그대로 재투영한 경우
    const b = computeViewBounds(reported, 1440, 900, true)
    expect(b.width).toBe(412)
    // 가용 폭(816) 안에서 좌우 여백이 같아야 한다
    const available = 1440 - reported.x - (1440 - (reported.x + reported.width))
    expect(b.x).toBe(reported.x + Math.floor((available - 412) / 2))
    expect(available - b.width - (b.x - reported.x)).toBe(Math.ceil((available - 412) / 2))
    // 높이는 전체 그대로 유지한다(세로는 중앙 정렬하지 않기로 결정)
    expect(b.height).toBe(788)
    expect(b.y).toBe(101)
  })

  it('모바일: 가용 폭이 412px 보다 좁으면 폭 전체를 그대로 쓰고 좁히지 않는다', () => {
    const narrow: Layout = {
      x: 10,
      y: 20,
      width: 300,
      height: 500,
      viewportWidth: 320,
      viewportHeight: 600
    }
    const b = computeViewBounds(narrow, 320, 600, true)
    expect(b.width).toBe(300)
    expect(b.x).toBe(10)
    expect(b.height).toBe(500)
  })
})

// 실기 10/30: 폰으로 대화만 보던 중(브라우저 영역 접힘) 재시작 뒤 만든 11번가 탭이 0×0 으로 배치돼
// AI 의 진짜 클릭이 엉뚱한 메뉴에 떨어졌다 — 접혀도 창 밖에 PC 화면 크기로 둔다
describe('computeBehindBounds — 접힌 브라우저 영역', () => {
  const collapsed: Layout = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    viewportWidth: 390,
    viewportHeight: 844
  }

  it('PC 창이면 창 크기 그대로 창 밖(왼쪽)에 둔다', () => {
    const b = computeBehindBounds(collapsed, 1440, 900, false, false)
    expect(b).toMatchObject({ x: -1440, y: 0, width: 1440, height: 900 })
  })

  it('폰 폭 창이어도 PC 최소 크기로 둔다', () => {
    const b = computeBehindBounds(collapsed, 390, 844, false, false)
    expect(b).toMatchObject({
      x: -COLLAPSED_MIN_WIDTH,
      width: COLLAPSED_MIN_WIDTH,
      height: Math.max(844, COLLAPSED_MIN_HEIGHT)
    })
  })

  it('보이는 영역이 있으면 그 자리를 그대로 쓴다', () => {
    expect(computeBehindBounds(reported, 1440, 900, false, false)).toEqual(
      computeViewBounds(reported, 1440, 900)
    )
  })

  it('로그인 게이트 중에는 0 크기', () => {
    expect(computeBehindBounds(collapsed, 1440, 900, false, true).width).toBe(0)
  })
})

describe('needsCollapsedSize — 숨은 탭에 PC 화면 크기 흉내를 거는가', () => {
  it('접힌 동안 만들어 실제 크기를 한 번도 못 받은 탭은 건다', () => {
    expect(needsCollapsedSize(false, false, undefined)).toBe(true)
  })
  it('마지막으로 폰 폭 창에서 보였던 탭은 건다', () => {
    expect(needsCollapsedSize(false, false, 390)).toBe(true)
  })
  it('PC 창에서 보였던 탭은 그 크기를 그대로 들고 있어 걸지 않는다(PC 화면 배치가 안 바뀐다)', () => {
    expect(needsCollapsedSize(false, false, 1440)).toBe(false)
  })
  it('보이는 탭·모바일 탭은 걸지 않는다', () => {
    expect(needsCollapsedSize(true, false, undefined)).toBe(false)
    expect(needsCollapsedSize(false, true, undefined)).toBe(false)
  })
})
