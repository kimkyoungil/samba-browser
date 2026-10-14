// 서버 없이 저장된 세션에서 사용자만 읽기 — 토큰은 보지 않는다
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({}))

import { storageKeyFor, userFromStoredSession } from '../src/main/sync/supabase-backend'

describe('storageKeyFor', () => {
  it('프로젝트 ref 로 supabase-js 저장 키를 만든다', () => {
    expect(storageKeyFor('https://abcdefgh.supabase.co')).toBe('sb-abcdefgh-auth-token')
  })
})

describe('userFromStoredSession', () => {
  it('세션 JSON 의 user 에서 id·이메일만 꺼낸다', () => {
    const raw = JSON.stringify({ access_token: 'x', refresh_token: 'y', user: { id: 'u-1', email: 'a@b.c' } })
    expect(userFromStoredSession(raw)).toEqual({ userId: 'u-1', email: 'a@b.c' })
  })

  it('없거나 깨졌거나 user 가 없으면 null', () => {
    expect(userFromStoredSession(null)).toBeNull()
    expect(userFromStoredSession('{not json')).toBeNull()
    expect(userFromStoredSession(JSON.stringify({ access_token: 'x' }))).toBeNull()
  })
})
