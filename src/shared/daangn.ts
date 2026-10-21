// 당근 통합 채팅함 공용 타입·상수·순수 함수. 메인·렌더러·preload 가 모두 이 파일 하나만 본다.
// 계정 세션·채팅 본문은 이 PC 의 숨은 뷰 안에만 있고, 여기에는 목록 표시에 필요한 값만 오간다

export const DAANGN_ACCOUNT_STATES = ['loading', 'logged_in', 'expired', 'read_failed'] as const
export type DaangnAccountState = (typeof DAANGN_ACCOUNT_STATES)[number]

export interface DaangnAccountDto {
  id: number
  label: string
  displayName: string
  profileImage: string | null
  state: DaangnAccountState
  /** 이 계정의 안 읽은 메시지 합계(목록에서 센다) */
  unread: number
}

export interface DaangnChannelDto {
  accountId: number
  roomId: string
  peerName: string
  region: string
  lastMessage: string
  /** 마지막 메시지 시각(epoch ms). 화면의 "오후 03:26" 같은 글에서 읽는다 — 못 읽으면 0 */
  lastAt: number
  lastAtText: string
  unread: number
  productTitle: string
  productThumb: string | null
}

export interface DaangnTemplateDto {
  id: number
  text: string
  sortOrder: number
}

/** 창 안 오른쪽 영역(렌더러 CSS 픽셀 = 네이티브 뷰 DIP) */
export interface DaangnBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 서비스가 렌더러에 보내는 통합 상태 */
export interface DaangnStateDto {
  accounts: DaangnAccountDto[]
  channels: DaangnChannelDto[]
}

/** 답변 템플릿 한 개의 글자 수 상한 */
export const DAANGN_TEMPLATE_MAX = 500

/**
 * 안 읽은 수 표기를 숫자로 읽는다. "3"→3, "99+"→99, 글자만 있는 배지("N")→1.
 * 못 읽겠다고 0 으로 두면 안 읽은 채팅이 목록에서 빠지므로, 배지 글자가 있으면 최소 1 로 본다
 */
export function parseUnread(text: string): number {
  const t = text.trim()
  if (t === '') return 0
  const m = /\d+/.exec(t)
  if (m) return Number(m[0])
  return 1
}

/**
 * 채팅 목록의 시각 글("오후 03:26"·"어제"·"10월 20일"·"2025년 3월 2일"·"방금")을 epoch ms 로 바꾼다.
 * 계정이 여러 개라 시각순 정렬이 필요하다. 모르는 글은 0(맨 뒤)
 */
export function parseKoreanTime(text: string, now: Date): number {
  const t = text.trim()
  const day = (y: number, m: number, d: number, h = 0, mi = 0): number =>
    new Date(y, m, d, h, mi, 0, 0).getTime()
  const ampm = /^(오전|오후)\s*(\d{1,2}):(\d{2})$/.exec(t)
  if (ampm) {
    let h = Number(ampm[2]) % 12
    if (ampm[1] === '오후') h += 12
    return day(now.getFullYear(), now.getMonth(), now.getDate(), h, Number(ampm[3]))
  }
  if (t === '방금' || t === '방금 전') return now.getTime()
  if (t === '어제') return day(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0)
  const full = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(t)
  if (full) return day(Number(full[1]), Number(full[2]) - 1, Number(full[3]))
  const md = /^(\d{1,2})월\s*(\d{1,2})일$/.exec(t)
  if (md) return day(now.getFullYear(), Number(md[1]) - 1, Number(md[2]))
  return 0
}

/**
 * 통합 목록에 보일 채널. unreadOnly 면 안 읽은 것만, accountId 가 있으면 그 계정만.
 * 최근 시각이 먼저이고 같으면 roomId 사전순(깜빡이지 않는 안정 정렬). 원본은 바꾸지 않는다
 */
export function filterChannels(
  list: readonly DaangnChannelDto[],
  opts: { accountId: number | null; unreadOnly: boolean }
): DaangnChannelDto[] {
  const out = list.filter(
    (c) => (opts.accountId === null || c.accountId === opts.accountId) && (!opts.unreadOnly || c.unread > 0)
  )
  return out.sort((a, b) => b.lastAt - a.lastAt || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0))
}

/** 계정별 안 읽은 합계. 채널이 하나도 없는 계정은 키가 없다 */
export function unreadByAccount(list: readonly DaangnChannelDto[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const c of list) out[c.accountId] = (out[c.accountId] ?? 0) + c.unread
  return out
}
