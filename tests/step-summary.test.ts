// AI 답의 진행 단계 한 줄 요약 — 몇 단계, 많이 한 일, 실패 수
import { describe, it, expect } from 'vitest'
import { stepKind, summarizeSteps } from '../src/renderer/src/lib/step-summary'

describe('단계 요약', () => {
  it("종류는 라벨의 ':' 앞, 없으면 라벨 그대로", () => {
    expect(stepKind('코드 읽기: 자사몰/README.md')).toBe('코드 읽기')
    expect(stepKind('페이지 읽기')).toBe('페이지 읽기')
    expect(stepKind('명령: npm test (exit 0)')).toBe('명령')
  })

  it('많이 한 순으로 세고(같으면 먼저 나온 순), 실패 수를 센다', () => {
    const s = summarizeSteps([
      { label: '코드 읽기: a.md', ok: true },
      { label: '페이지 읽기', ok: true },
      { label: '코드 읽기: b.md', ok: true },
      { label: '코드 찾기: 진행 현황', ok: false },
      { label: '코드 읽기: c.md', ok: true },
      { label: '코드 실행: await page.click(26)', ok: true }
    ])
    expect(s.total).toBe(6)
    expect(s.failed).toBe(1)
    expect(s.kinds).toEqual([
      { name: '코드 읽기', count: 3 },
      { name: '페이지 읽기', count: 1 },
      { name: '코드 찾기', count: 1 },
      { name: '코드 실행', count: 1 }
    ])
  })
})
