// 긴 값 붙여넣기 — 경계 길이 판정과 사용자 클립보드 보관·복원
import { describe, it, expect, vi, beforeEach } from 'vitest'

const board = vi.hoisted(() => ({
  state: { text: '', html: '', rtf: '', image: null as null | { empty: boolean } },
  writes: [] as unknown[]
}))

vi.mock('electron', () => ({
  clipboard: {
    readText: () => board.state.text,
    readHTML: () => board.state.html,
    readRTF: () => board.state.rtf,
    readImage: () => ({ isEmpty: () => !board.state.image, __v: board.state.image }),
    writeText: (t: string) => {
      board.state.text = t
    },
    clear: () => {
      board.state = { text: '', html: '', rtf: '', image: null }
    },
    write: (d: { text?: string; html?: string; rtf?: string; image?: unknown }) => {
      board.writes.push(d)
      board.state.text = d.text ?? ''
      board.state.html = d.html ?? ''
      board.state.rtf = d.rtf ?? ''
    }
  },
  webContents: undefined
}))

import {
  LONG_PASTE_CHARS,
  needsClipboardPaste,
  snapshotClipboard,
  restoreClipboard
} from '../src/main/browser/page-bridge'

beforeEach(() => {
  board.state = { text: '', html: '', rtf: '', image: null }
  board.writes = []
})

describe('needsClipboardPaste', () => {
  it('300자까지는 키 입력, 301자부터 붙여넣기', () => {
    expect(LONG_PASTE_CHARS).toBe(300)
    expect(needsClipboardPaste('a'.repeat(300))).toBe(false)
    expect(needsClipboardPaste('a'.repeat(301))).toBe(true)
  })
})

describe('클립보드 보관·복원', () => {
  it('넣기 전 내용을 보관하고 되돌린다', () => {
    board.state.text = '사용자가 복사한 글'
    board.state.html = '<b>x</b>'
    const saved = snapshotClipboard()
    board.state.text = '긴 프롬프트 값'
    restoreClipboard(saved)
    expect(board.state.text).toBe('사용자가 복사한 글')
    expect(board.state.html).toBe('<b>x</b>')
  })

  it('이미지가 없으면 image 는 쓰지 않는다', () => {
    board.state.text = 'abc'
    restoreClipboard(snapshotClipboard())
    expect(board.writes[0]).not.toHaveProperty('image')
  })
})
