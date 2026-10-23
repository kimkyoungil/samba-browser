// AI 창 입력칸에 쓰다 만 글 — 껐다 켜도 남는다
import { describe, it, expect } from 'vitest'
import {
  DRAFT_MAX_CHARS,
  draftOnQuit,
  loadDraft,
  saveDraft
} from '../src/renderer/src/lib/input-draft'

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  map: Map<string, string>
} {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  }
}

describe('쓰다 만 글', () => {
  it('저장한 글을 다시 읽고, 빈 글·너무 긴 글은 지운다', () => {
    const s = memory()
    saveDraft('쿠팡 주문 확인해', s)
    expect(loadDraft(s)).toBe('쿠팡 주문 확인해')
    saveDraft('   ', s)
    expect(loadDraft(s)).toBe('')
    saveDraft('x'.repeat(DRAFT_MAX_CHARS + 1), s)
    expect(s.map.size).toBe(0)
  })

  it('저장소가 막혀 있어도 화면을 깨뜨리지 않는다', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadDraft(broken)).toBe('')
    expect(() => saveDraft('글', broken)).not.toThrow()
    expect(loadDraft(null)).toBe('')
  })

  it('끌 때는 못 보낸 대기열 글을 보낼 순서대로 앞에 붙인다', () => {
    expect(draftOnQuit('쓰던 글', ['첫째 대기', '둘째 대기'])).toBe('첫째 대기\n둘째 대기\n쓰던 글')
    expect(draftOnQuit('', ['대기만'])).toBe('대기만')
  })
})
