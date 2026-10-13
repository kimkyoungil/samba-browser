// 구글 로그아웃 뒤 로그인 쿠키 정리 — 로그아웃 주소 판정과 지울 쿠키 고르기
import { describe, it, expect } from 'vitest'

import {
  clearGoogleLoginCookies,
  isGoogleLoginCookie,
  isGoogleLogoutUrl,
  type CookieStoreLike
} from '../src/main/browser/session-cookies'

function fakeStore(list: Array<{ name: string; domain: string; path?: string; secure?: boolean; hostOnly?: boolean }>) {
  const removed: Array<[string, string]> = []
  const store: CookieStoreLike = {
    get: async () => list as never,
    set: async () => undefined,
    remove: async (url, name) => {
      removed.push([url, name])
    }
  }
  return { store, removed }
}

describe('isGoogleLogoutUrl', () => {
  it('구글 로그아웃과 유튜브 ClearSID 응답만 대상이다', () => {
    expect(isGoogleLogoutUrl('https://accounts.google.com/Logout?hl=ko&continue=x')).toBe(true)
    expect(isGoogleLogoutUrl('https://accounts.youtube.com/accounts/ClearSID?zx=1')).toBe(true)
    expect(isGoogleLogoutUrl('https://accounts.google.com/SignOutOptions?hl=ko')).toBe(false)
    expect(isGoogleLogoutUrl('https://accounts.google.com/ServiceLogin')).toBe(false)
  })
})

describe('isGoogleLoginCookie', () => {
  it('구글·유튜브 도메인의 로그인 쿠키 이름만 고른다', () => {
    expect(isGoogleLoginCookie({ name: 'SID', domain: '.youtube.com' })).toBe(true)
    expect(isGoogleLoginCookie({ name: '__Secure-3PSID', domain: '.google.com' })).toBe(true)
    expect(isGoogleLoginCookie({ name: 'NID', domain: '.google.com' })).toBe(false)
    expect(isGoogleLoginCookie({ name: 'SID', domain: '.naver.com' })).toBe(false)
  })
})

describe('clearGoogleLoginCookies', () => {
  it('로그인 쿠키만 지우고 나머지(NID, 다른 사이트)는 둔다', async () => {
    const { store, removed } = fakeStore([
      { name: 'SID', domain: '.youtube.com', path: '/', secure: true },
      { name: 'HSID', domain: '.google.com', path: '/', secure: true },
      { name: 'NID', domain: '.google.com', path: '/' },
      { name: 'app_atk', domain: '.musinsa.com', path: '/' }
    ])
    const n = await clearGoogleLoginCookies(store)
    expect(n).toBe(2)
    expect(removed).toEqual([
      ['https://youtube.com/', 'SID'],
      ['https://google.com/', 'HSID']
    ])
  })
})
