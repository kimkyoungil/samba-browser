// 당근 뷰 스케줄(어느 계정을 상시로 두고 어느 계정을 돌려 읽을지)과 알림 판정. 전부 순수 함수다 —
// 전역 시각·타이머를 쓰지 않고 now 를 받아 결과만 돌려준다(시험·재현이 쉽다)

import type { DaangnChannelDto } from '../../shared/daangn'

export interface PlanScanInput {
  accountIds: readonly number[]
  /** 계정별 안 읽은 수 */
  unread: Readonly<Record<number, number>>
  /** 계정별 마지막으로 목록을 읽은 시각(ms). 없으면 한 번도 안 읽은 것(0) */
  lastReadAt: Readonly<Record<number, number>>
  /** 지금 상시 뷰인 계정 */
  warm: ReadonlySet<number>
  /** 사용자가 오른쪽에서 보고 있는 계정 */
  selectedId: number | null
  now: number
  warmMax: number
  tempMax: number
  /** 상시가 아닌 계정을 다시 읽기까지 최소 간격 */
  minGapMs: number
}

/**
 * 이번 틱에 상시로 둘 계정(warm)과 잠깐 띄워 읽을 계정(temp)을 고른다.
 * - warm: 선택한 계정(항상) → 안 읽음 많은 순 → 이미 상시였던 계정(자리 바꿈 최소) → 번호순, warmMax 까지
 * - temp: warm 이 아닌 계정 중 minGap 이 지난 것을 가장 오래 안 읽은 순으로 tempMax 까지
 */
export function planScan(input: PlanScanInput): { warm: number[]; temp: number[] } {
  const all = [...input.accountIds]
  const warm: number[] = []
  const take = (id: number): void => {
    if (warm.length < input.warmMax && all.includes(id) && !warm.includes(id)) warm.push(id)
  }
  if (input.selectedId !== null) take(input.selectedId)
  const withUnread = all
    .filter((id) => (input.unread[id] ?? 0) > 0)
    .sort((a, b) => (input.unread[b] ?? 0) - (input.unread[a] ?? 0) || a - b)
  for (const id of withUnread) take(id)
  const wasWarm = all.filter((id) => input.warm.has(id)).sort((a, b) => a - b)
  for (const id of wasWarm) take(id)
  const byNumber = [...all].sort((a, b) => a - b)
  for (const id of byNumber) take(id)

  const lastRead = (id: number): number => input.lastReadAt[id] ?? 0
  const temp = all
    .filter((id) => !warm.includes(id) && input.now - lastRead(id) >= input.minGapMs)
    .sort((a, b) => lastRead(a) - lastRead(b) || a - b)
    .slice(0, input.tempMax)
  return { warm, temp }
}

/**
 * 알림을 울릴 채널. prev(방별 지난번 안 읽은 수, 키 `${accountId}:${roomId}`)가 null 이면
 * 앱을 켠 직후 첫 읽기라 이미 쌓여 있던 안 읽음을 알리지 않는다. 그 뒤로는 늘어난 방과 새로 생긴 안 읽은 방만
 */
export function diffUnread(
  prev: ReadonlyMap<string, number> | null,
  next: readonly DaangnChannelDto[]
): DaangnChannelDto[] {
  if (prev === null) return []
  return next.filter((c) => c.unread > 0 && c.unread > (prev.get(`${c.accountId}:${c.roomId}`) ?? 0))
}

/** 같은 키(방)는 쿨다운 안에 다시 알리지 않는다 */
export class NotifyThrottle {
  private readonly last = new Map<string, number>()

  constructor(private readonly cooldownMs: number) {}

  allow(key: string, now: number): boolean {
    const prev = this.last.get(key)
    if (prev !== undefined && now - prev < this.cooldownMs) return false
    this.last.set(key, now)
    return true
  }
}
