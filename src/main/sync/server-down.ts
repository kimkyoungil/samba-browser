// 서버(Supabase)가 정지·불통이라 호출 자체가 안 되는 오류 문구 — 비밀번호·권한 문제가 아니다.
// 로그인(account.ts)과 세션 복원(auth.ts)이 같은 기준으로 "서버 탓"을 가린다
const SERVER_DOWN_PATTERNS = [
  'service for this project is restricted',
  'exceed_egress_quota',
  'fetch failed',
  'failed to fetch',
  'network',
  'econnrefused',
  'enotfound',
  'etimedout',
  'timeout'
]

export function isServerDownError(message: string): boolean {
  const m = message.toLowerCase()
  return SERVER_DOWN_PATTERNS.some((p) => m.includes(p))
}
