// 창 여러 개 관리(window-manager) — 실제 BrowserWindow·TabManager 대신 가짜로 수명주기·탭 옮기기를 본다
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import type { ExportedTab, TabManager } from '../src/main/browser/tab-manager'
import { CASCADE_OFFSET, WindowManager } from '../src/main/browser/window-manager'

/** 가짜 창 — 이벤트·파괴·포커스·webContents.id 만 흉내 낸다 */
class FakeWindow extends EventEmitter {
  destroyed = false
  focused = false
  sent: Array<[string, unknown]> = []
  bounds = { x: 100, y: 50, width: 800, height: 600 }
  webContents: { id: number; isDestroyed: () => boolean; send: (c: string, p: unknown) => void }
  constructor(public readonly wcId: number) {
    super()
    this.webContents = {
      id: wcId,
      isDestroyed: () => this.destroyed,
      send: (c, p) => this.sent.push([c, p])
    }
  }
  isDestroyed = (): boolean => this.destroyed
  isFocused = (): boolean => this.focused
  getBounds = (): { x: number; y: number; width: number; height: number } => this.bounds
  /** 실제처럼 close → 'close' 이벤트 → 파괴 → 'closed' */
  close(): void {
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  }
  focus(): void {
    this.focused = true
    this.emit('focus')
  }
}

interface FakeTab {
  id: string
  user: boolean
}

/** 가짜 탭 관리자 — 탭 목록·사람 탭 표식·export/adopt·설정 호출 기록 */
class FakeTabs {
  tabs: FakeTab[] = []
  active: string | null = null
  calls: Array<[string, unknown[]]> = []
  private seq = 0
  constructor(public readonly name: string) {}
  list = (): Array<{ id: string }> => this.tabs.map((t) => ({ id: t.id }))
  listAll = (): Array<{ id: string }> => this.list()
  isUserTab = (id: string): boolean => this.tabs.find((t) => t.id === id)?.user === true
  get = (id: string): object | null => this.tabs.find((t) => t.id === id) ?? null
  create = (opts: { user?: boolean } = {}): { id: string } => {
    const id = `${this.name}-${++this.seq}`
    this.tabs.push({ id, user: opts.user === true })
    this.active = id
    return { id }
  }
  exportTab = (id: string): ExportedTab | null => {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return null
    const [tab] = this.tabs.splice(idx, 1)
    if (this.active === id) this.active = this.tabs[0]?.id ?? null
    return {
      tab: { id: tab.id } as unknown as ExportedTab['tab'],
      user: tab.user,
      lane: !tab.user,
      automationTarget: false,
      dialogMessage: null
    }
  }
  adoptTab = (exported: ExportedTab, opts: { index?: number; background?: boolean } = {}): object => {
    const tab = { id: exported.tab.id, user: exported.user }
    const index = opts.index ?? this.tabs.length
    this.tabs.splice(index, 0, tab)
    if (!opts.background) this.active = tab.id
    return { id: tab.id }
  }
  move = (id: string, toIndex: number): void => {
    const from = this.tabs.findIndex((t) => t.id === id)
    const [tab] = this.tabs.splice(from, 1)
    this.tabs.splice(toIndex, 0, tab)
  }
  findByWebContents = (): null => null
  // 모든 창에 똑같이 걸리는 설정·구독 — 호출만 기록한다
  setDefaultUrl = (...args: unknown[]): void => {
    this.calls.push(['setDefaultUrl', args])
  }
  setGateHidden = (...args: unknown[]): void => {
    this.calls.push(['setGateHidden', args])
  }
  onChange = (...args: unknown[]): void => {
    this.calls.push(['onChange', args])
  }
  profileOfSession = (): string => 'default'
}

function setup(): {
  wm: WindowManager
  windows: FakeWindow[]
  tabsOf: (i: number) => FakeTabs
  positions: Array<{ x: number; y: number } | undefined>
} {
  const windows: FakeWindow[] = []
  const managers = new Map<FakeWindow, FakeTabs>()
  const positions: Array<{ x: number; y: number } | undefined> = []
  const wm = new WindowManager({
    createWindow: (position) => {
      positions.push(position)
      const w = new FakeWindow(windows.length + 1)
      windows.push(w)
      return w as unknown as BrowserWindow
    },
    createTabs: (win) => {
      const t = new FakeTabs(`w${windows.length}`)
      managers.set(win as unknown as FakeWindow, t)
      return t as unknown as TabManager
    }
  })
  return { wm, windows, positions, tabsOf: (i) => managers.get(windows[i])! }
}

describe('WindowManager — 창 수명주기', () => {
  it('첫 창이 기본 창이고, 닫히면 다음 창이 기본 창이 된다', () => {
    const { wm, windows } = setup()
    const a = wm.create({ openTab: true })
    const b = wm.create({ openTab: true })
    expect(wm.primary()).toBe(a)
    expect(wm.all()).toEqual([a, b])
    windows[0].close()
    expect(wm.primary()).toBe(b)
    expect(wm.all()).toEqual([b])
  })

  it('마지막 창이 닫힐 때만 onLastClosed 가 불린다', () => {
    const { wm, windows } = setup()
    const closed = vi.fn()
    const last = vi.fn()
    wm.onClosed(closed)
    wm.onLastClosed(last)
    wm.create()
    wm.create()
    windows[0].close()
    expect(closed).toHaveBeenCalledTimes(1)
    expect(last).not.toHaveBeenCalled()
    windows[1].close()
    expect(closed).toHaveBeenCalledTimes(2)
    expect(last).toHaveBeenCalledTimes(1)
  })

  it('openTab 이면 배선이 끝난 뒤 사람 탭 하나를 연다', () => {
    const { wm, tabsOf } = setup()
    const order: string[] = []
    wm.eachWindow(() => order.push('configure'))
    const entry = wm.create({ openTab: true })
    expect(tabsOf(0).tabs).toEqual([{ id: 'w1-1', user: true }])
    expect(order).toEqual(['configure'])
    expect(entry.tabs.list()).toHaveLength(1)
  })

  it('두 번째 창은 사람이 쓰던 창에서 비켜 띄운다', () => {
    const { wm, windows, positions } = setup()
    wm.create()
    windows[0].focus()
    wm.create()
    expect(positions[0]).toBeUndefined()
    expect(positions[1]).toEqual({ x: 100 + CASCADE_OFFSET, y: 50 + CASCADE_OFFSET })
    // 자리를 직접 주면 그대로
    wm.create({ position: { x: 7, y: 9 } })
    expect(positions[2]).toEqual({ x: 7, y: 9 })
  })
})

describe('WindowManager — 발신자·포커스', () => {
  it('렌더러 webContents id 로 창을 찾고, 탭 페이지 id 는 모른다', () => {
    const { wm } = setup()
    const a = wm.create()
    const b = wm.create()
    expect(wm.forSender({ id: 1 })).toBe(a)
    expect(wm.forSender({ id: 2 })).toBe(b)
    expect(wm.forSender({ id: 99 })).toBeNull()
    expect(wm.forSender(null)).toBeNull()
    expect(wm.windows()).toHaveLength(2)
  })

  it('포커스된 창 → 마지막으로 포커스됐던 창 → 기본 창 순으로 고른다', () => {
    const { wm, windows } = setup()
    const a = wm.create()
    const b = wm.create()
    expect(wm.focused()).toBe(a)
    windows[1].focus()
    expect(wm.focused()).toBe(b)
    // 포커스가 다이얼로그로 빠져도 마지막 창을 기억한다
    windows[1].focused = false
    expect(wm.focused()).toBe(b)
    windows[1].close()
    expect(wm.focused()).toBe(a)
  })

  it('방송은 살아 있는 모든 창에, sendTo 는 그 창에만 간다', () => {
    const { wm, windows } = setup()
    const a = wm.create()
    wm.create()
    wm.broadcast('x', 1)
    wm.sendTo(a, 'y', 2)
    expect(windows[0].sent).toEqual([
      ['x', 1],
      ['y', 2]
    ])
    expect(windows[1].sent).toEqual([['x', 1]])
  })
})

describe('WindowManager — 탭 떼기·옮기기', () => {
  it('사람 탭을 떼면 새 창이 그 탭을 받는다', () => {
    const { wm, tabsOf } = setup()
    const a = wm.create({ openTab: true })
    a.tabs.create({ user: true })
    const moved = tabsOf(0).tabs[1].id
    const b = wm.detach(moved, { x: 1, y: 2 })
    expect(b).not.toBeNull()
    expect(wm.all()).toEqual([a, b])
    expect(tabsOf(0).tabs.map((t) => t.id)).toEqual(['w1-1'])
    expect(tabsOf(1).tabs).toEqual([{ id: moved, user: true }])
    expect(tabsOf(1).active).toBe(moved)
  })

  it('자동화 탭·창의 마지막 탭·모르는 탭은 떼지 않는다', () => {
    const { wm, tabsOf } = setup()
    const a = wm.create({ openTab: true })
    expect(wm.detach('w1-1')).toBeNull() // 마지막 탭
    a.tabs.create({ user: true })
    const auto = a.tabs.create({}).id // 자동화 탭
    expect(wm.detach(auto)).toBeNull()
    expect(wm.detach('nope')).toBeNull()
    expect(tabsOf(0).tabs).toHaveLength(3)
    expect(wm.all()).toHaveLength(1)
  })

  it('다른 창의 탭 바 자리로 옮기고, 비게 된 창은 닫는다', () => {
    const { wm, windows, tabsOf } = setup()
    const a = wm.create({ openTab: true })
    const b = wm.create({ openTab: true })
    b.tabs.create({ user: true })
    expect(wm.moveTab('w1-1', b, 1)).toBe(true)
    expect(tabsOf(1).tabs.map((t) => t.id)).toEqual(['w2-1', 'w1-1', 'w2-2'])
    expect(windows[0].destroyed).toBe(true)
    expect(wm.all()).toEqual([b])
    expect(wm.primary()).toBe(b)
  })

  it('같은 창 안이면 자리만 바꾸고, 자동화 탭은 옮기지 않는다', () => {
    const { wm, tabsOf } = setup()
    const a = wm.create({ openTab: true })
    a.tabs.create({ user: true })
    const b = wm.create({ openTab: true })
    expect(wm.moveTab('w1-2', a, 0)).toBe(true)
    expect(tabsOf(0).tabs.map((t) => t.id)).toEqual(['w1-2', 'w1-1'])
    const auto = a.tabs.create({}).id
    expect(wm.moveTab(auto, b)).toBe(false)
    expect(tabsOf(1).tabs).toHaveLength(1)
  })

  it('창이 닫힐 때 자동화 탭은 남은 창으로 뒤에서 옮겨 가고 사람 탭은 함께 닫힌다', () => {
    const { wm, windows, tabsOf } = setup()
    const a = wm.create({ openTab: true })
    const lane = a.tabs.create({}).id
    wm.create({ openTab: true })
    windows[0].close()
    expect(tabsOf(1).tabs.map((t) => t.id)).toEqual(['w2-1', lane])
    // 뒤에서 붙었으므로 보이는 탭은 그대로
    expect(tabsOf(1).active).toBe('w2-1')
    expect(wm.ownerOfTab(lane)?.id).toBe(2)
  })

  it('마지막 창이 닫힐 때는 옮길 곳이 없어 그대로 둔다', () => {
    const { wm, windows, tabsOf } = setup()
    const a = wm.create({ openTab: true })
    a.tabs.create({})
    windows[0].close()
    expect(tabsOf(0).tabs).toHaveLength(2)
    expect(wm.all()).toHaveLength(0)
  })
})

describe('WindowManager — 탭 관리자 겉모양(facade)', () => {
  it('설정·구독은 모든 창에 걸리고, 나중에 생긴 창에도 다시 걸린다', () => {
    const { wm, tabsOf } = setup()
    wm.create()
    const tabs = wm.primaryTabs()
    tabs.setDefaultUrl('https://a')
    tabs.setDefaultUrl('https://b')
    tabs.setGateHidden(true)
    const cb = (): void => undefined
    tabs.onChange(cb)
    wm.create()
    expect(tabsOf(0).calls).toEqual([
      ['setDefaultUrl', ['https://a']],
      ['setDefaultUrl', ['https://b']],
      ['setGateHidden', [true]],
      ['onChange', [cb]]
    ])
    // 새 창: 구독은 순서대로, 설정은 마지막 값만
    expect(tabsOf(1).calls).toEqual([
      ['onChange', [cb]],
      ['setDefaultUrl', ['https://b']],
      ['setGateHidden', [true]]
    ])
  })

  it('읽기·조작은 기본 창(또는 사람이 쓰는 창)의 관리자에 간다', () => {
    const { wm, windows, tabsOf } = setup()
    wm.create({ openTab: true })
    wm.create({ openTab: true })
    const primary = wm.primaryTabs()
    const focused = wm.focusedTabs()
    expect(primary.list().map((t) => t.id)).toEqual(['w1-1'])
    windows[1].focus()
    expect(focused.list().map((t) => t.id)).toEqual(['w2-1'])
    focused.create({ user: true })
    expect(tabsOf(1).tabs).toHaveLength(2)
    expect(tabsOf(0).tabs).toHaveLength(1)
    // 기본 창이 닫히면 겉모양은 다음 창을 따라간다
    windows[0].close()
    expect(primary.list().map((t) => t.id)).toEqual(['w2-1', 'w2-2'])
  })
})
