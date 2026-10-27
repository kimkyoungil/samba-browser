// AI 답의 진행 단계를 한 줄로 접을 때 쓰는 요약 — 몇 단계였고, 어떤 일을 많이 했고, 몇 개가 실패했는지.
// 종류는 라벨의 ':' 앞(예: '코드 읽기: src/a.ts' → '코드 읽기'), ':' 가 없으면 라벨 그대로다

export interface StepSummary {
  total: number
  failed: number
  /** 많이 한 순(같으면 먼저 나온 순) */
  kinds: { name: string; count: number }[]
}

const KIND_MAX = 24

/** 단계 라벨 → 종류 이름 */
export function stepKind(label: string): string {
  const at = label.indexOf(':')
  const kind = (at > 0 ? label.slice(0, at) : label).trim()
  return kind.length > KIND_MAX ? `${kind.slice(0, KIND_MAX)}…` : kind
}

export function summarizeSteps(steps: { label: string; ok: boolean }[]): StepSummary {
  const counts = new Map<string, number>()
  let failed = 0
  for (const s of steps) {
    if (!s.ok) failed++
    const k = stepKind(s.label)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  // Map 은 넣은 순서를 지킨다 — sort 가 안정 정렬이라 같은 횟수면 먼저 나온 종류가 앞이다
  const kinds = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  return { total: steps.length, failed, kinds }
}
