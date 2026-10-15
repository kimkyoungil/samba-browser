// 키패드 판정용 글자 — 앞쪽 긴 목록이 키패드 문구를 한도 밖으로 밀어내지 않는다
import { describe, it, expect } from 'vitest'

import { KEYPAD_TEXT_TAIL, keypadText } from '../src/preload/page-core'
import { isSecretKeypad } from '../src/main/agent/secret-page'

describe('keypadText', () => {
  it('짧은 글자는 그대로 둔다', () => {
    expect(keypadText('결제 비밀번호 6자리')).toBe('결제 비밀번호 6자리')
  })

  it('앞쪽 목록이 한도를 넘어도 끝의 키패드 문구가 남는다', () => {
    const list = '배송지 수정 삭제 '.repeat(2000)
    const text = `${list}L.PAY 비밀번호 입력 결제 비밀번호 6자리를 입력해 주세요`
    const out = keypadText(text)
    expect(out).toContain('결제 비밀번호 6자리')
    expect(out.length).toBeLessThanOrEqual(8000 + 1 + KEYPAD_TEXT_TAIL)
  })

  it('끝 문구가 합쳐져 숫자 버튼 10개와 함께 키패드로 판정된다', () => {
    const text = `${'배송지 '.repeat(5000)}결제 비밀번호 6자리를 입력해 주세요`
    expect(isSecretKeypad({ url: 'https://shop.example/', text: keypadText(text), digitButtons: 10, pinField: false })).toBe(true)
    expect(isSecretKeypad({ url: 'https://shop.example/', text: text.slice(0, 8000), digitButtons: 10, pinField: false })).toBe(false)
  })
})
