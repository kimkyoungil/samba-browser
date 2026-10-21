// 당근 채팅함 화면의 순수 계산 — 통합 목록에 무엇이 어떤 순서로 보이는가
import { describe, expect, it } from 'vitest'
import { accountLabelOf, visibleChannels } from '../src/renderer/src/components/daangn/daangn-view'
import type { DaangnAccountDto, DaangnChannelDto } from '../src/shared/daangn'

function ch(accountId: number, roomId: string, lastAt: number, unread: number): DaangnChannelDto {
  return {
    accountId,
    roomId,
    peerName: '',
    region: '',
    lastMessage: '',
    lastAt,
    lastAtText: '',
    unread,
    productTitle: '',
    productThumb: null
  }
}

describe('visibleChannels', () => {
  const channels = [
    ch(1, 'a', 300, 1),
    ch(2, 'b', 500, 0),
    ch(2, 'c', 400, 2),
    ch(1, 'd', 400, 3)
  ]
  it('기본(안읽음만·전체 계정)은 모든 계정의 안 읽은 방이 최근순이다', () => {
    const out = visibleChannels({ channels, selectedAccountId: null, unreadOnly: true })
    expect(out.map((c) => c.roomId)).toEqual(['c', 'd', 'a'])
  })
  it('계정을 고르면 그 계정만', () => {
    const out = visibleChannels({ channels, selectedAccountId: 1, unreadOnly: true })
    expect(out.map((c) => c.roomId)).toEqual(['d', 'a'])
  })
  it('전체 보기면 읽은 방도 보인다', () => {
    const out = visibleChannels({ channels, selectedAccountId: null, unreadOnly: false })
    expect(out.map((c) => c.roomId)).toEqual(['b', 'c', 'd', 'a'])
  })
})

describe('accountLabelOf', () => {
  const accounts: DaangnAccountDto[] = [
    { id: 1, label: '황놀', displayName: '황놀', profileImage: null, state: 'logged_in', unread: 0 }
  ]
  it('별칭을 돌려주고 없는 계정은 빈 글', () => {
    expect(accountLabelOf(accounts, 1)).toBe('황놀')
    expect(accountLabelOf(accounts, 9)).toBe('')
  })
})
