// AI 답 글(MarkdownText)의 링크·그림 주소 거르개.
import { defaultUrlTransform } from 'react-markdown'

/** http(s) 주소만 남긴다. 그 밖(javascript:·file:·상대 주소 등)은 빈 문자열 */
export function safeHref(url: string): string {
  const u = defaultUrlTransform(url)
  return /^https?:\/\//i.test(u) ? u : ''
}
