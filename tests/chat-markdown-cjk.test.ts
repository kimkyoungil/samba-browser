// AI 답 글 서식 — 한글에 바로 붙은 굵게·한 줄 바꿈·표
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import { MARKDOWN_PLUGINS } from '../src/renderer/src/lib/markdown-plugins'

const html = (md: string): string =>
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: MARKDOWN_PLUGINS }, md))

describe('답 글 서식', () => {
  it('문장부호로 끝난 굵게 뒤에 한글이 붙어도 굵게로 보인다', () => {
    expect(html('상태 글은 **"상태: 삭제됨"**입니다')).toContain(
      '<strong>&quot;상태: 삭제됨&quot;</strong>입니다'
    )
    expect(html('**(주의)**는 꼭 보세요')).toContain('<strong>(주의)</strong>는')
    expect(html('합계 **15,500원**입니다')).toContain('<strong>15,500원</strong>입니다')
  })

  it('한 줄 바꿈은 줄바꿈으로, 표는 표로 그린다', () => {
    expect(html('첫 줄\n둘째 줄')).toContain('<br/>')
    expect(html('| 상품 | 금액 |\n|---|---|\n| 양말 | 3,000원 |')).toContain('<td>양말</td>')
  })

  it('원시 HTML 은 그리지 않는다', () => {
    expect(html('<script>alert(1)</script> 안녕')).not.toContain('<script>')
  })
})
