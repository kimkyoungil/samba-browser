// 2단계 로그인에서 앞 단계 아이디를 기억하는 판정(순수 함수)
import { describe, it, expect } from 'vitest'

import { CAPTURE_USERNAME_STEP_MS, pickStepUsername } from '../src/preload/page-core'

describe('pickStepUsername', () => {
  const at = 1_000_000

  it('기한 안이면 앞 단계 아이디를 준다', () => {
    expect(pickStepUsername('user@gmail.com', at, at + 60_000, CAPTURE_USERNAME_STEP_MS)).toBe('user@gmail.com')
  })

  it('기한이 지나면 빈 값을 준다', () => {
    expect(pickStepUsername('user@gmail.com', at, at + CAPTURE_USERNAME_STEP_MS, CAPTURE_USERNAME_STEP_MS)).toBe('')
  })

  it('기억한 값이 없으면 빈 값을 준다', () => {
    expect(pickStepUsername('', 0, at, CAPTURE_USERNAME_STEP_MS)).toBe('')
  })
})
