// 앱 계정 로그인 전용 확인값. 키마스터와 분리해서, 서버가 막혀도 이 PC 에서 계정 비밀번호만으로 들어갈 수 있게 한다.
// 키마스터(금고)는 사이트 비밀번호 저장소일 뿐이라 로그인 판정에 쓰지 않는다. 비밀번호 자체는 저장하지 않는다.
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'

interface StoredVerifier {
  salt: string
  hash: string
}

const KEY_LEN = 32
const SCRYPT = { N: 16384, r: 8, p: 1 }

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, SCRYPT)
}

/** 계정 비밀번호로 확인값(소금+해시)을 만든다 */
export function makeLoginVerifier(password: string): StoredVerifier {
  const salt = randomBytes(16)
  return { salt: salt.toString('base64'), hash: derive(password, salt).toString('base64') }
}

/** 저장된 확인값과 비밀번호가 맞는지 본다 */
export function checkLoginVerifier(password: string, stored: StoredVerifier): boolean {
  const salt = Buffer.from(stored.salt, 'base64')
  const expected = Buffer.from(stored.hash, 'base64')
  const actual = derive(password, salt)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 확인값 파일을 읽고 쓴다. 파일이 없으면 undefined(예전 설치는 한 번 온라인 로그인 뒤 생성된다) */
export function loginVerifierStore(file: string): {
  save: (password: string) => void
  check: (password: string) => boolean | undefined
} {
  return {
    save: (password) => {
      writeFileSync(file, JSON.stringify(makeLoginVerifier(password)), { encoding: 'utf8', mode: 0o600 })
    },
    check: (password) => {
      if (!existsSync(file)) return undefined
      try {
        const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredVerifier
        return checkLoginVerifier(password, stored)
      } catch {
        return undefined
      }
    }
  }
}
