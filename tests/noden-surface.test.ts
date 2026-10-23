// 겉이름 noden — 홈 주소·내부 스킴. 옛 samba:// 로 저장된 값도 계속 쓰이게 한다
import { describe, it, expect } from 'vitest'
import {
  INTERNAL_SCHEMES,
  NEW_TAB_URL,
  LEGACY_NEW_TAB_URL,
  isInternalUrl,
  isAllowedUrl,
  upgradeInternalUrl
} from '../src/shared/url'
import { DEFAULT_SETTINGS, parseSettings } from '../src/shared/settings'
import { INTERNAL_PROTOCOLS } from '../src/preload/page-constants'

describe('내부 스킴 noden', () => {
  it('새 탭 주소는 noden://newtab', () => {
    expect(NEW_TAB_URL).toBe('noden://newtab')
    expect(DEFAULT_SETTINGS.homeUrl).toBe('noden://newtab')
  })
  it('옛 samba://newtab 도 내부 페이지로 열린다(저장된 탭)', () => {
    expect(isInternalUrl(LEGACY_NEW_TAB_URL)).toBe(true)
    expect(isInternalUrl('noden://newtab/')).toBe(true)
    expect(isAllowedUrl('samba://newtab')).toBe(true)
    expect(isInternalUrl('noden://settings')).toBe(false)
  })
  it('preload 의 스킴 목록이 공용 목록과 같다', () => {
    expect([...INTERNAL_PROTOCOLS]).toEqual(INTERNAL_SCHEMES.map((s) => `${s}:`))
  })
  it('옛 새 탭 주소만 새 주소로 바꾼다', () => {
    expect(upgradeInternalUrl('samba://newtab')).toBe(NEW_TAB_URL)
    expect(upgradeInternalUrl('SAMBA://newtab/')).toBe(NEW_TAB_URL)
    expect(upgradeInternalUrl('https://www.naver.com')).toBe('https://www.naver.com')
  })
  it('저장된 홈 주소·마지막 주소가 옛 값이면 새 주소로 읽힌다', () => {
    const s = parseSettings({ homeUrl: 'samba://newtab', lastUrl: 'samba://newtab' })
    expect(s.homeUrl).toBe(NEW_TAB_URL)
    expect(s.lastUrl).toBe(NEW_TAB_URL)
    expect(parseSettings({ homeUrl: 'https://example.com' }).homeUrl).toBe('https://example.com')
  })
})
