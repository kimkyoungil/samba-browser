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

/** 왼쪽 두 패널의 폭 범위(px) — def 가 처음 폭 */
export const PANEL_WIDTHS = {
  account: { min: 140, max: 320, def: 190 },
  list: { min: 240, max: 560, def: 320 }
} as const

/** 끌어서 바꾼 폭을 범위 안 정수로 맞춘다. 숫자가 아니면 기본 폭 */
export function clampPanelWidth(kind: keyof typeof PANEL_WIDTHS, w: number): number {
  const r = PANEL_WIDTHS[kind]
  if (!Number.isFinite(w)) return r.def
  return Math.min(r.max, Math.max(r.min, Math.round(w)))
}

/** 계정 별칭. 모르는 계정은 빈 글 */
export function accountLabelOf(accounts: readonly DaangnAccountDto[], id: number): string {
  return accounts.find((a) => a.id === id)?.label ?? ''
}
