// 마크다운이 만든 HTML 나무(hast)에서 글자만 모은다 — 코드 칸 [복사] 가 쓴다

interface HastLike {
  type?: string
  value?: unknown
  children?: unknown
}

export function hastText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as HastLike
  if (n.type === 'text' && typeof n.value === 'string') return n.value
  if (!Array.isArray(n.children)) return ''
  return n.children.map(hastText).join('')
}
