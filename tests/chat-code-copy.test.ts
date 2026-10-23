// 코드 칸마다 복사 버튼 — 코드 글자만 모아 복사한다
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hastText } from '../src/renderer/src/lib/hast-text'
import { MarkdownText } from '../src/renderer/src/components/chat/MarkdownText'

describe('코드 칸 복사', () => {
  it('HTML 나무에서 글자만 모은다', () => {
    const tree = {
      type: 'element',
      children: [
        { type: 'element', children: [{ type: 'text', value: 'pnpm ' }] },
        { type: 'text', value: 'install' }
      ]
    }
    expect(hastText(tree)).toBe('pnpm install')
    expect(hastText(null)).toBe('')
  })

  it('코드 칸에만 복사 버튼이 붙는다', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, { text: '설치는\n\n```\npnpm install\n```\n\n끝' })
    )
    expect(html).toContain('<pre><code>pnpm install')
    expect(html.match(/aria-label="chat.copy"/g)?.length).toBe(1)
    const plain = renderToStaticMarkup(createElement(MarkdownText, { text: '그냥 글' }))
    expect(plain).not.toContain('chat.copy')
  })
})
