// 당근 뷰 스케줄(상시·순환)·알림 판정 — 순수 함수. 앱을 켠 직후 알림이 쏟아지지 않아야 한다
import { describe, expect, it } from 'vitest'
import { NotifyThrottle, diffUnread, planScan } from '../src/main/daangn/schedule'
import type { DaangnChannelDto } from '../src/shared/daangn'

function ch(accountId: number, roomId: string, unread: number): DaangnChannelDto {
  return {
    accountId,
    roomId,
    peerName: '',
    region: '',
    lastMessage: '',
    lastAt: 0,
    lastAtText: '',
    unread,
    productTitle: '',
    productThumb: null
  }
}

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1)

describe('planScan', () => {
  const base = {
    unread: {} as Record<number, number>,
    lastReadAt: {} as Record<number, number>,
    warm: new Set<number>(),
    selectedId: null as number | null,
    now: 1_000_000,
    warmMax: 8,
    tempMax: 3,
    minGapMs: 120_000
  }

  it('계정이 0개면 아무것도 고르지 않는다', () => {
    expect(planScan({ ...base, accountIds: [] })).toEqual({ warm: [], temp: [] })
  })

  it('선택한 계정은 항상 상시, 안 읽음 많은 계정이 그다음', () => {
    const out = planScan({
      ...base,
      accountIds: ids(50),
      selectedId: 40,
      unread: { 7: 5, 9: 2, 12: 9 }
    })
    expect(out.warm[0]).toBe(40)
    expect(out.warm.slice(1, 4)).toEqual([12, 7, 9])
    expect(out.warm).toHaveLength(8)
  })

  it('안 읽음이 없어도 이미 상시였던 계정은 자리가 남으면 유지한다(자리 바꿈 최소)', () => {
    const out = planScan({ ...base, accountIds: ids(50), warm: new Set([3, 4, 5]), unread: { 20: 1 } })
    expect(out.warm).toContain(3)
    expect(out.warm).toContain(4)
    expect(out.warm).toContain(5)
    expect(out.warm).toContain(20)
  })

  it('임시 뷰는 상시와 겹치지 않고 가장 오래 안 읽은 순으로 최대 tempMax 개', () => {
    const lastReadAt: Record<number, number> = {}
    for (const id of ids(50)) lastReadAt[id] = 900_000 - id * 1000 // 번호가 클수록 오래됨
    const out = planScan({ ...base, accountIds: ids(50), lastReadAt })
    expect(out.temp).toHaveLength(3)
    expect(out.temp.some((id) => out.warm.includes(id))).toBe(false)
    // 상시 8개(오래된 순이 아니라 id 순 기본)를 뺀 나머지 중 가장 오래된 3개
    const rest = ids(50).filter((id) => !out.warm.includes(id))
    const oldest = [...rest].sort((a, b) => lastReadAt[a] - lastReadAt[b]).slice(0, 3)
    expect(out.temp).toEqual(oldest)
  })

  it('최근에 읽은 계정(minGap 안)은 임시 뷰에서 빠진다', () => {
    const lastReadAt: Record<number, number> = {}
    for (const id of ids(20)) lastReadAt[id] = 990_000 // 10초 전
    const out = planScan({ ...base, accountIds: ids(20), lastReadAt })
    expect(out.temp).toEqual([])
  })

  it('비상시 42개 계정을 10초 틱마다 돌리면 3분(180초) 안에 전부 한 번씩 읽힌다', () => {
    const accountIds = ids(50)
    const lastReadAt: Record<number, number> = {}
    for (const id of accountIds) lastReadAt[id] = 0
    let now = 1_000_000
    const seen = new Set<number>()
    let warm = new Set<number>()
    for (let tick = 0; tick < 18; tick++) {
      const plan = planScan({ ...base, accountIds, lastReadAt, warm, now })
      warm = new Set(plan.warm)
      for (const id of plan.temp) {
        seen.add(id)
        lastReadAt[id] = now
      }
      now += 10_000
    }
    const nonWarm = accountIds.filter((id) => !warm.has(id))
    expect(nonWarm.every((id) => seen.has(id))).toBe(true)
  })
})

describe('diffUnread', () => {
  it('앱 시작 직후 첫 읽기(prev=null)에서는 안 읽음이 50건이어도 알림이 없다', () => {
    const next = Array.from({ length: 50 }, (_, i) => ch(1, `r${i}`, 3))
    expect(diffUnread(null, next)).toEqual([])
  })

  it('늘어난 방과 새로 생긴 안 읽은 방만 알림 대상이다', () => {
    const prev = new Map<string, number>([
      ['1:a', 2],
      ['1:b', 2],
      ['1:c', 5]
    ])
    const out = diffUnread(prev, [
      ch(1, 'a', 2), // 그대로
      ch(1, 'b', 5), // 늘어남
      ch(1, 'c', 0), // 읽음
      ch(2, 'd', 1) // 새 방
    ])
    expect(out.map((c) => `${c.accountId}:${c.roomId}`)).toEqual(['1:b', '2:d'])
  })

  it('새 방이어도 안 읽음이 0 이면 알리지 않는다', () => {
    expect(diffUnread(new Map(), [ch(1, 'x', 0)])).toEqual([])
  })
})

describe('NotifyThrottle', () => {
  it('같은 키는 쿨다운 안에서 막고 지나면 다시 허용한다', () => {
    const t = new NotifyThrottle(120_000)
    expect(t.allow('1:a', 0)).toBe(true)
    expect(t.allow('1:a', 60_000)).toBe(false)
    expect(t.allow('1:a', 121_000)).toBe(true)
  })
  it('다른 키는 서로 영향이 없다', () => {
    const t = new NotifyThrottle(120_000)
    expect(t.allow('1:a', 0)).toBe(true)
    expect(t.allow('1:b', 1)).toBe(true)
  })
})
