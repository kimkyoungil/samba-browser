import { describe, expect, it } from 'vitest'
import type { PhoneDto } from '../src/shared/phone'
import { orderPhones } from '../src/renderer/src/pages/PhonesPage'

// 폰 카드 순서 — 사용자가 정한 시리얼 순서를 앞에, 모르는 폰은 원래 순서로 뒤에
function phone(serial: string): PhoneDto {
  return {
    id: serial.length,
    serial,
    label: serial,
    country: 'KR',
    transport: 'wifi',
    wifiAddress: null,
    model: '',
    state: 'online',
    smsQueryOk: null,
    lastSeenAt: 0,
    screenMode: null
  }
}

describe('orderPhones', () => {
  const list = [phone('a'), phone('bb'), phone('ccc'), phone('dddd')]
  it('순서가 비어 있으면 원래 순서 그대로', () => {
    expect(orderPhones(list, []).map((p) => p.serial)).toEqual(['a', 'bb', 'ccc', 'dddd'])
  })
  it('정한 순서를 앞에 두고 나머지는 원래 순서로 뒤에 붙인다', () => {
    expect(orderPhones(list, ['ccc', 'a']).map((p) => p.serial)).toEqual(['ccc', 'a', 'bb', 'dddd'])
  })
  it('목록에 없는 시리얼은 무시한다', () => {
    expect(orderPhones(list, ['zzz', 'bb']).map((p) => p.serial)).toEqual(['bb', 'a', 'ccc', 'dddd'])
  })
})
