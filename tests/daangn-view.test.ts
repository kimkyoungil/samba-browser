// 당근 채팅함 화면의 순수 계산 — 통합 목록에 무엇이 어떤 순서로 보이는가
import { describe, expect, it } from 'vitest'
import {
  PANEL_WIDTHS,
  accountLabelOf,
  clampPanelWidth,
  visibleChannels
} from '../src/renderer/src/components/daangn/daangn-view'
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

describe('clampPanelWidth', () => {
  it('범위 안이면 정수로 돌려주고, 밖이면 범위로 맞춘다', () => {
    expect(clampPanelWidth('account', 200.4)).toBe(200)
    expect(clampPanelWidth('account', 10)).toBe(PANEL_WIDTHS.account.min)
    expect(clampPanelWidth('account', 9999)).toBe(PANEL_WIDTHS.account.max)
    expect(clampPanelWidth('list', 10)).toBe(PANEL_WIDTHS.list.min)
    expect(clampPanelWidth('list', 9999)).toBe(PANEL_WIDTHS.list.max)
  })
  it('숫자가 아니면 기본 폭', () => {
    expect(clampPanelWidth('list', Number.NaN)).toBe(PANEL_WIDTHS.list.def)
    expect(clampPanelWidth('account', Number('x'))).toBe(PANEL_WIDTHS.account.def)
  })
})
