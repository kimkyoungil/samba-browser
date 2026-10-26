// 입력줄 사용량 링이 쓰는 계산 — 링에 그릴 한도 고르기와 초기화 시각 글자
import type { AiUsageLimit } from '@shared/ai'

/** 링에 그릴 한도 = 가장 많이 쓴 것(같으면 먼저 온 것). 한도가 없으면 null */
export function pickHeadlineLimit(limits: readonly AiUsageLimit[]): AiUsageLimit | null {
  let best: AiUsageLimit | null = null
  for (const l of limits) if (best === null || l.percent > best.percent) best = l
  return best
}

/**
 * 초기화 시각 글자. 오늘이면 시각만('오후 3:40'), 아니면 요일과 시각('(목) 오후 7:00').
 * 날짜를 못 읽으면 빈 글자
 */
export function usageResetText(iso: string, lang: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const day = d.toLocaleDateString(lang, { weekday: 'short' })
  return `(${day}) ${time}`
}
