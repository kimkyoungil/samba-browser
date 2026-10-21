// 당근 채팅함 화면의 순수 계산(React 를 쓰지 않아 그대로 시험한다)

import {
  filterChannels,
  type DaangnAccountDto,
  type DaangnChannelDto
} from '@shared/daangn'

/** 통합 목록에 보일 채널 — 안읽음만/전체, 계정 필터, 최근순 */
export function visibleChannels(state: {
  channels: readonly DaangnChannelDto[]
  selectedAccountId: number | null
  unreadOnly: boolean
}): DaangnChannelDto[] {
  return filterChannels(state.channels, {
    accountId: state.selectedAccountId,
    unreadOnly: state.unreadOnly
  })
}

/** 계정 별칭. 모르는 계정은 빈 글 */
export function accountLabelOf(accounts: readonly DaangnAccountDto[], id: number): string {
  return accounts.find((a) => a.id === id)?.label ?? ''
}
