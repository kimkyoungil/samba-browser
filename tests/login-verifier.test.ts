// 앱 계정 로그인 확인값 — 키마스터와 분리된 비밀번호 판정
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  checkLoginVerifier,
  loginVerifierStore,
  makeLoginVerifier
} from '../src/main/sync/login-verifier'

describe('login verifier', () => {
  it('같은 비밀번호는 맞고 다른 비밀번호는 틀린다', () => {
    const v = makeLoginVerifier('secret-1')
    expect(checkLoginVerifier('secret-1', v)).toBe(true)
    expect(checkLoginVerifier('secret-2', v)).toBe(false)
  })

  it('소금이 매번 달라 같은 비밀번호도 저장값이 다르다', () => {
    const a = makeLoginVerifier('x')
    const b = makeLoginVerifier('x')
    expect(a.hash).not.toBe(b.hash)
  })

  it('파일이 없으면 undefined, 저장 뒤에는 판정한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samba-lv-'))
    const store = loginVerifierStore(join(dir, 'login-verifier.json'))
    expect(store.check('pw')).toBeUndefined()
    store.save('pw')
    expect(store.check('pw')).toBe(true)
    expect(store.check('nope')).toBe(false)
  })
})
