// Supabase 접속 정보 읽기 검증. 네트워크는 쓰지 않는다.
// 우선순위: 앱 설정(설정 → 계정) → .env → 없음
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readSupabaseEnv,
  hasSupabaseEnv,
  setSupabaseEnvFromSettings,
  readDirectoryEnv,
  hasDirectoryEnv
} from '../src/main/sync/env'
import { DEFAULT_DIRECTORY_URL } from '../src/main/sync/directory-default'

const URL_KEY = 'SAMBA_SUPABASE_URL'
const ANON_KEY = 'SAMBA_SUPABASE_ANON_KEY'

describe('sync/env', () => {
  // 테스트 사이에 환경 변수·설정값이 새지 않도록 원래 값을 복원한다
  let savedUrl: string | undefined
  let savedAnon: string | undefined

  beforeEach(() => {
    savedUrl = process.env[URL_KEY]
    savedAnon = process.env[ANON_KEY]
    delete process.env[URL_KEY]
    delete process.env[ANON_KEY]
    setSupabaseEnvFromSettings('', '')
  })

  afterEach(() => {
    if (savedUrl === undefined) delete process.env[URL_KEY]
    else process.env[URL_KEY] = savedUrl
    if (savedAnon === undefined) delete process.env[ANON_KEY]
    else process.env[ANON_KEY] = savedAnon
    setSupabaseEnvFromSettings('', '')
  })

  it('process.env 에 값이 있으면 그대로 읽는다', () => {
    process.env[URL_KEY] = 'https://abcdefghijkl.supabase.co'
    process.env[ANON_KEY] = 'eyJ.dummy-anon-key'
    expect(readSupabaseEnv()).toEqual({
      url: 'https://abcdefghijkl.supabase.co',
      anonKey: 'eyJ.dummy-anon-key'
    })
  })

  it('앞뒤 공백은 잘라낸다', () => {
    process.env[URL_KEY] = '  https://abcdefghijkl.supabase.co \n'
    process.env[ANON_KEY] = ' eyJ.dummy-anon-key '
    const env = readSupabaseEnv()
    expect(env.url).toBe('https://abcdefghijkl.supabase.co')
    expect(env.anonKey).toBe('eyJ.dummy-anon-key')
  })

  it('설정값이 .env 보다 우선한다', () => {
    process.env[URL_KEY] = 'https://fromenv.supabase.co'
    process.env[ANON_KEY] = 'eyJ.dummy-from-env'
    setSupabaseEnvFromSettings(
      '  https://fromsettings.supabase.co ',
      ' sb_publishable_abcdefghijkl '
    )
    expect(readSupabaseEnv()).toEqual({
      url: 'https://fromsettings.supabase.co',
      anonKey: 'sb_publishable_abcdefghijkl'
    })
  })

  it('설정값이 한쪽만 있으면 나머지 한쪽은 .env 에서 읽는다', () => {
    process.env[ANON_KEY] = 'eyJ.dummy-from-env'
    setSupabaseEnvFromSettings('https://fromsettings.supabase.co', '')
    expect(readSupabaseEnv()).toEqual({
      url: 'https://fromsettings.supabase.co',
      anonKey: 'eyJ.dummy-from-env'
    })
  })

  it('값이 없으면 빈 문자열이고 hasSupabaseEnv 는 false 다(로컬 전용)', () => {
    expect(readSupabaseEnv()).toEqual({ url: '', anonKey: '' })
    expect(hasSupabaseEnv()).toBe(false)
  })

  it('두 값이 모두 있으면 hasSupabaseEnv 는 true 다', () => {
    process.env[URL_KEY] = 'https://abcdefghijkl.supabase.co'
    process.env[ANON_KEY] = 'eyJ.dummy-anon-key'
    expect(hasSupabaseEnv()).toBe(true)
  })

  it('설정값만으로도 hasSupabaseEnv 는 true 다', () => {
    setSupabaseEnvFromSettings('https://abcdefghijkl.supabase.co', 'sb_publishable_abcdefghijkl')
    expect(hasSupabaseEnv()).toBe(true)
  })

  it('url 이 https 가 아니면 hasSupabaseEnv 는 false 다', () => {
    process.env[URL_KEY] = 'http://abcdefghijkl.supabase.co'
    process.env[ANON_KEY] = 'eyJ.dummy-anon-key'
    expect(hasSupabaseEnv()).toBe(false)
  })

  it('anon 키만 비어도 hasSupabaseEnv 는 false 다', () => {
    process.env[URL_KEY] = 'https://abcdefghijkl.supabase.co'
    expect(hasSupabaseEnv()).toBe(false)
  })
})

describe('sync/env — 계정 디렉터리(중앙 로그인)', () => {
  const DIR_KEY = 'SAMBA_DIRECTORY_URL'
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env[DIR_KEY]
    delete process.env[DIR_KEY]
  })

  afterEach(() => {
    if (saved === undefined) delete process.env[DIR_KEY]
    else process.env[DIR_KEY] = saved
  })

  it('값이 없으면 앱에 내장된 기본 중앙 프로젝트를 쓴다', () => {
    expect(readDirectoryEnv().url).toBe(DEFAULT_DIRECTORY_URL)
    expect(hasDirectoryEnv()).toBe(true)
  })

  it('off 면 중앙 로그인을 끈다(로그인 화면 없이 이 PC 전용)', () => {
    process.env[DIR_KEY] = ' OFF '
    expect(readDirectoryEnv()).toEqual({ url: '', anonKey: '' })
    expect(hasDirectoryEnv()).toBe(false)
  })

  it('다른 주소를 주면 그 주소를 쓴다', () => {
    process.env[DIR_KEY] = 'https://other.supabase.co'
    expect(readDirectoryEnv().url).toBe('https://other.supabase.co')
  })
})
