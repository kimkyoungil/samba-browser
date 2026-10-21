// 당근 로그인 쿠키 유지 — 만료가 없는 세션 쿠키는 앱을 끌 때 사라져 QR 로그인을 계정 수만큼 다시 해야 한다.
// 그래서 당근 도메인의 세션 쿠키를 만료 1년짜리 영속 쿠키로 다시 심는다(순수 계산은 여기, 실제 심기는 account-view)

/** Electron Cookie 의 필요한 부분 */
export interface CookieLike {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** Electron cookies.set 에 넘길 값 */
export interface CookieSetDetails {
  url: string
  name: string
  value: string
  /** 점으로 시작하는 도메인 쿠키만. 호스트 쿠키는 url 로만 정한다 */
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

const YEAR_SEC = 365 * 24 * 3600

function isDaangnHost(host: string): boolean {
  const h = host.replace(/^\./, '').toLowerCase()
  return h === 'daangn.com' || h.endsWith('.daangn.com')
}

/**
 * 세션 쿠키면 영속으로 바꿀 설정값, 이미 만료일이 있거나 당근이 아니면 null.
 * nowSec 는 epoch 초
 */
export function persistentCookieDetails(c: CookieLike, nowSec: number): CookieSetDetails | null {
  if (!c.session || c.expirationDate !== undefined) return null
  const domain = c.domain ?? ''
  if (!domain || !isDaangnHost(domain)) return null
  const path = c.path || '/'
  const secure = c.secure === true
  const host = domain.replace(/^\./, '')
  return {
    url: `${secure ? 'https' : 'http'}://${host}${path}`,
    name: c.name,
    value: c.value,
    domain: domain.startsWith('.') ? domain : undefined,
    path,
    secure,
    httpOnly: c.httpOnly === true,
    expirationDate: nowSec + YEAR_SEC,
    sameSite: c.sameSite
  }
}
