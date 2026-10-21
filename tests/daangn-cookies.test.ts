// 당근 로그인 쿠키가 세션 쿠키(만료 없음)면 앱을 껐다 켤 때 사라져 QR 로그인을 다시 해야 한다 —
// 세션 쿠키를 1년짜리 영속 쿠키로 다시 심는 계산(순수 함수)
import { describe, expect, it } from 'vitest'
import { persistentCookieDetails } from '../src/main/daangn/cookies'

const NOW = 1_800_000_000 // epoch 초

describe('persistentCookieDetails', () => {
  it('세션 쿠키는 만료일을 붙인 설정값으로 바꾼다', () => {
    const d = persistentCookieDetails(
      { name: 'sid', value: 'v', domain: '.daangn.com', path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' },
      NOW
    )
    expect(d).not.toBeNull()
    expect(d?.url).toBe('https://daangn.com/')
    expect(d?.domain).toBe('.daangn.com')
    expect(d?.expirationDate).toBe(NOW + 365 * 24 * 3600)
    expect(d?.httpOnly).toBe(true)
    expect(d?.secure).toBe(true)
  })
  it('이미 만료일이 있는 쿠키·당근이 아닌 도메인은 건드리지 않는다', () => {
    const base = { name: 'a', value: 'v', path: '/', secure: true, httpOnly: false, sameSite: 'lax' as const }
    expect(persistentCookieDetails({ ...base, domain: '.daangn.com', session: false, expirationDate: NOW + 10 }, NOW)).toBeNull()
    expect(persistentCookieDetails({ ...base, domain: '.example.com', session: true }, NOW)).toBeNull()
  })
  it('호스트 쿠키(점 없는 도메인)의 주소는 그 호스트로 만든다', () => {
    const d = persistentCookieDetails(
      { name: 'x', value: 'v', domain: 'chat.daangn.com', path: '/a', secure: false, httpOnly: false, session: true, sameSite: 'unspecified' },
      NOW
    )
    expect(d?.url).toBe('http://chat.daangn.com/a')
    expect(d?.domain).toBeUndefined()
  })
})
