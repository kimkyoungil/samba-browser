// 탭 바 끌어 옮기기 판정(렌더러 순수 함수) — 자리 바꾸기·다른 창 탭 받기·새 창으로 떼기
import { describe, expect, it } from 'vitest'
import { TAB_DRAG_MIME, isTabDrag, planDrop, shouldDetach } from '../src/renderer/src/lib/tab-drag'

describe('planDrop', () => {
  const ids = ['a', 'b', 'c']

  it('같은 창의 탭은 자리 바꾸기 — 뒤로 옮기면 빠진 자리만큼 당긴다', () => {
    expect(planDrop('a', ids, 3)).toEqual({ kind: 'move', tabId: 'a', toIndex: 2 })
    expect(planDrop('c', ids, 0)).toEqual({ kind: 'move', tabId: 'c', toIndex: 0 })
  })

  it('제자리(앞·뒤 바로 옆)에 놓으면 할 일이 없다', () => {
    expect(planDrop('b', ids, 1).kind).toBe('none')
    expect(planDrop('b', ids, 2).kind).toBe('none')
  })

  it('이 창에 없는 탭 id 는 다른 창에서 온 탭 — 그 자리로 받아 온다', () => {
    expect(planDrop('zzz', ids, 1)).toEqual({ kind: 'adopt', tabId: 'zzz', toIndex: 1 })
  })
})

describe('shouldDetach', () => {
  const bar = { left: 0, top: 0, right: 600, bottom: 36 }

  it('아무도 받지 않았고 탭 바 밖이면 뗀다(페이지 위·바탕화면)', () => {
    expect(shouldDetach('none', { x: 300, y: 400 }, bar)).toBe(true)
    expect(shouldDetach('none', { x: 0, y: 0 }, bar)).toBe(true) // 창 밖(좌표 없음)
    expect(shouldDetach('none', { x: 100, y: 100 }, null)).toBe(true)
  })

  it('다른 드롭 대상이 받았으면(move) 떼지 않는다 — 다른 창의 탭 바가 가져간 경우', () => {
    expect(shouldDetach('move', { x: 300, y: 400 }, bar)).toBe(false)
    expect(shouldDetach('copy', { x: 300, y: 400 }, bar)).toBe(false)
  })

  it('탭 바 안에서 끝났으면(Esc 취소·제자리) 떼지 않는다', () => {
    expect(shouldDetach('none', { x: 200, y: 20 }, bar)).toBe(false)
  })
})

describe('isTabDrag', () => {
  it('전용 형식이 실려 있어야 탭 끌기다', () => {
    expect(isTabDrag([TAB_DRAG_MIME, 'text/plain'])).toBe(true)
    expect(isTabDrag(['text/plain'])).toBe(false)
    expect(isTabDrag(undefined)).toBe(false)
  })
})
