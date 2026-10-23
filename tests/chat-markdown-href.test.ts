// AI 답 글(MarkdownText)의 링크 거르개 — http(s) 만 살린다
import { describe, it, expect } from 'vitest'
import { safeHref } from '../src/renderer/src/lib/safe-href'

describe('답 글 링크', () => {
  it('http(s) 만 살리고 javascript:·file:·상대 주소는 버린다', () => {
    expect(safeHref('https://www.coupang.com/a?b=1')).toBe('https://www.coupang.com/a?b=1')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('javascript:alert(1)')).toBe('')
    expect(safeHref('file:///C:/Windows')).toBe('')
    expect(safeHref('/settings')).toBe('')
  })
})
