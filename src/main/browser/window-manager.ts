// 창 여러 개 — BrowserWindow ↔ TabManager 쌍을 묶어 관리한다(크롬처럼 새 창·탭 분리).
//
// 왜: 창 하나에 TabManager 하나가 묶여 있어 바탕화면 아이콘 재실행·Ctrl+N 이 새 탭밖에 못 열었다.
// ipcMain 핸들러는 한 번만 등록하고, 발신자(e.sender)의 창을 여기서 찾아 그 창의 탭 관리자에 보낸다.
//
// '기본(primary) 창' = 가장 오래 살아 있는 창. 하네스 브릿지·AI 러너·확장처럼 창을 모르는 쪽은 이 창의 탭을 쓴다.
// 기본 창이 닫히면 다음 창이 기본 창이 되고, 자동화 탭(레인·AI 대상)은 닫히기 전에 그 창으로 옮겨 둔다 —
// 결제 중인 하네스 탭이 창과 함께 사라지지 않게(돈 사고 방지).
import type { BrowserWindow, Session, WebContents } from 'electron'
import type { TabInfo } from '../../shared/ipc'
import type { Tab, TabManager } from './tab-manager'
import type { ExtensionTabsProvider } from '../extensions/tabs-bridge'
import type { RendererWindowLike } from '../ipc/sender'

export interface WindowEntry {
  /** 앱 안에서만 쓰는 창 번호(1부터) */
  id: number
  win: BrowserWindow
  tabs: TabManager
}

export interface WindowPosition {
  x: number
  y: number
}

export interface WindowManagerDeps {
  /** 렌더러 UI 를 실은 BrowserWindow 를 만든다(window.ts). 위치를 주면 그 자리에 띄운다 */
  createWindow: (position?: WindowPosition) => BrowserWindow
  /** 그 창의 탭 관리자 */
  createTabs: (win: BrowserWindow) => TabManager
}

/** 새 창을 띄울 때 앞 창에서 비켜 놓는 거리(px) */
export const CASCADE_OFFSET = 32

/**
 * 모든 창에 똑같이 걸어야 하는 TabManager 설정 — 마지막 값만 기억해 새 창에도 그대로 건다
 * (설정·작업공간·게이트는 창마다 같은 값이어야 한다)
 */
const FANOUT_SETTERS = new Set<string>([
  'setDefaultUrl',
  'setSearchEngine',
  'setPartitionPrefix',
  'setSessionHook',
  'setContextMenuHook',
  'setInputHandler',
  'setGestureConfig',
  'setAgentRunningProvider',
  'setDialogPolicy',
  'setGateHidden'
])

/** 모든 창에 똑같이 걸어야 하는 TabManager 구독 — 건 순서대로 새 창에도 다시 건다 */
const FANOUT_LISTENERS = new Set<string>(['onChange', 'onActivated', 'onVisit', 'onTabClosed'])

type AnyFn = (...args: unknown[]) => unknown

function callMethod(target: object, key: string, args: unknown[]): unknown {
  const fn = (target as unknown as Record<string, unknown>)[key]
  if (typeof fn !== 'function') throw new Error(`TabManager.${key} is not a function`)
  return (fn as AnyFn).apply(target, args)
}

export class WindowManager {
  private entries: WindowEntry[] = []
  private nextId = 1
  /** 마지막으로 포커스를 받았던 창 — 포커스가 다이얼로그 등으로 잠시 빠져도 '사람이 쓰던 창'을 안다 */
  private lastFocusedId: number | null = null
  private configurers: Array<(entry: WindowEntry) => void> = []
  private closedListeners: Array<(entry: WindowEntry, remaining: WindowEntry[]) => void> = []
  private lastClosedListeners: Array<() => void> = []
  /** 창마다 똑같이 걸 설정(마지막 값)·구독(순서대로) */
  private fanoutLatest = new Map<string, unknown[]>()
  private fanoutListeners: Array<{ key: string; args: unknown[] }> = []
  private primaryFacade: TabManager | null = null
  private focusedFacade: TabManager | null = null

  constructor(private readonly deps: WindowManagerDeps) {}

  /** 지금 살아 있는 창(만든 순서) */
  all(): WindowEntry[] {
    return this.entries.filter((e) => !e.win.isDestroyed())
  }

  /** 가장 오래된 창 — 브릿지·AI·확장이 쓰는 기본 창. 창이 하나도 없으면 던진다(종료 중) */
  primary(): WindowEntry {
    const first = this.all()[0]
    if (!first) throw new Error('no window')
    return first
  }

  /** 사람이 쓰는 창 — 포커스된 창, 없으면 마지막으로 포커스됐던 창, 없으면 기본 창 */
  focused(): WindowEntry {
    const alive = this.all()
    return (
      alive.find((e) => e.win.isFocused()) ??
      alive.find((e) => e.id === this.lastFocusedId) ??
      this.primary()
    )
  }

  /** 렌더러 발신자(webContents) 가 속한 창 */
  forSender(sender: { id: number } | null | undefined): WindowEntry | null {
    if (!sender) return null
    return (
      this.all().find((e) => !e.win.webContents.isDestroyed() && e.win.webContents.id === sender.id) ??
      null
    )
  }

  /** 발신자 검증(sender.ts)에 주는 창 목록 */
  windows(): RendererWindowLike[] {
    return this.all().map((e) => e.win)
  }

  /** 이 webContents 를 가진 탭과 그 창 — 어느 창에 있든 찾는다 */
  findTab(wc: WebContents): { entry: WindowEntry; tab: Tab } | null {
    for (const entry of this.all()) {
      const tab = entry.tabs.findByWebContents(wc)
      if (tab) return { entry, tab }
    }
    return null
  }

  hasWebContents(wc: WebContents): boolean {
    return this.findTab(wc) !== null
  }

  /** 탭 id 로 그 탭을 쥔 창 */
  ownerOfTab(tabId: string): WindowEntry | null {
    return this.all().find((e) => e.tabs.get(tabId) !== null) ?? null
  }

  /** 모든 창의 렌더러에 보낸다(금고 상태·AI 이벤트처럼 앱 전체 상태) */
  broadcast(channel: string, payload: unknown): void {
    for (const entry of this.all()) this.sendTo(entry, channel, payload)
  }

  /** 한 창의 렌더러에만 보낸다(그 창의 탭 목록 등) */
  sendTo(entry: WindowEntry, channel: string, payload: unknown): void {
    if (entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return
    entry.win.webContents.send(channel, payload)
  }

  /** 지금 있는 창마다 한 번, 앞으로 생기는 창에도 생길 때 한 번 부른다(창별 배선) */
  eachWindow(fn: (entry: WindowEntry) => void): void {
    this.configurers.push(fn)
    for (const entry of this.all()) fn(entry)
  }

  /** 창이 닫힌 뒤(남은 창 목록과 함께) */
  onClosed(fn: (entry: WindowEntry, remaining: WindowEntry[]) => void): void {
    this.closedListeners.push(fn)
  }

  /** 마지막 창이 닫힌 뒤 — 앱 전체 서비스 정리 자리 */
  onLastClosed(fn: () => void): void {
    this.lastClosedListeners.push(fn)
  }

  /**
   * 새 창. openTab 이면 설정 기본 주소로 사람 탭 하나를 연다(배선이 끝난 뒤라 홈 주소·프로필 접두사가 적용된다).
   * 위치를 주지 않으면 사람이 쓰던 창에서 조금 비켜 띄운다
   */
  create(opts: { position?: WindowPosition; openTab?: boolean } = {}): WindowEntry {
    const position = opts.position ?? this.cascadePosition()
    const win = this.deps.createWindow(position)
    const tabs = this.deps.createTabs(win)
    const entry: WindowEntry = { id: this.nextId++, win, tabs }
    this.entries.push(entry)
    win.on('focus', () => {
      this.lastFocusedId = entry.id
    })
    // 닫히기 전(뷰가 아직 살아 있을 때)에 자동화 탭을 다른 창으로 옮긴다
    win.on('close', () => this.migrateAutomationTabs(entry))
    win.once('closed', () => {
      this.entries = this.entries.filter((e) => e !== entry)
      const remaining = this.all()
      for (const cb of this.closedListeners) cb(entry, remaining)
      if (remaining.length === 0) for (const cb of this.lastClosedListeners) cb()
    })
    // 창마다 같은 설정·구독을 다시 건다(설정은 마지막 값, 구독은 건 순서대로)
    for (const { key, args } of this.fanoutListeners) callMethod(tabs, key, args)
    for (const [key, args] of this.fanoutLatest) callMethod(tabs, key, args)
    for (const fn of this.configurers) fn(entry)
    if (opts.openTab) tabs.create({ user: true })
    return entry
  }

  private cascadePosition(): WindowPosition | undefined {
    const alive = this.all()
    if (alive.length === 0) return undefined
    let base: WindowEntry
    try {
      base = this.focused()
    } catch {
      return undefined
    }
    const b = base.win.getBounds()
    return { x: b.x + CASCADE_OFFSET, y: b.y + CASCADE_OFFSET }
  }

  /**
   * 창이 닫힐 때 자동화 탭(레인·AI 대상 — 사람이 열지 않은 탭)을 남은 창으로 옮긴다.
   * 사람 탭은 크롬처럼 창과 함께 닫힌다. 마지막 창이면 옮길 곳이 없다(앱 종료)
   */
  private migrateAutomationTabs(closing: WindowEntry): void {
    const target = this.all().find((e) => e !== closing)
    if (!target) return
    for (const t of closing.tabs.list()) {
      if (closing.tabs.isUserTab(t.id)) continue
      const exported = closing.tabs.exportTab(t.id)
      if (!exported) continue
      try {
        target.tabs.adoptTab(exported, { background: true })
      } catch (e: unknown) {
        console.warn('자동화 탭 옮기기 실패', e instanceof Error ? e.message : String(e))
      }
    }
  }

  /**
   * 탭을 떼어 새 창으로. 사람 탭만 뗄 수 있고(자동화 탭은 하네스가 기본 창에서 찾는다),
   * 창의 마지막 탭은 떼지 않는다(빈 창이 남는다). 떼었으면 새 창
   */
  detach(tabId: string, position?: WindowPosition): WindowEntry | null {
    const owner = this.ownerOfTab(tabId)
    if (!owner) return null
    if (!owner.tabs.isUserTab(tabId)) return null
    if (owner.tabs.list().length <= 1) return null
    const exported = owner.tabs.exportTab(tabId)
    if (!exported) return null
    const entry = this.create(position ? { position } : {})
    entry.tabs.adoptTab(exported)
    return entry
  }

  /**
   * 탭을 다른 창의 탭 바 자리(index)로 옮긴다. 사람 탭만. 원래 창이 비면 그 창을 닫는다.
   * 같은 창 안이면 자리만 바꾼다
   */
  moveTab(tabId: string, to: WindowEntry, index?: number): boolean {
    const owner = this.ownerOfTab(tabId)
    if (!owner) return false
    if (owner === to) {
      if (index !== undefined) owner.tabs.move(tabId, index)
      return true
    }
    if (!owner.tabs.isUserTab(tabId)) return false
    const exported = owner.tabs.exportTab(tabId)
    if (!exported) return false
    to.tabs.adoptTab(exported, index === undefined ? {} : { index })
    if (owner.tabs.list().length === 0 && !owner.win.isDestroyed()) owner.win.close()
    return true
  }

  /**
   * 창을 모르는 쪽(AI 러너·브릿지·캡처)에 주는 TabManager 겉모양.
   * 읽기·조작은 target() 창의 관리자에 가고, 모든 창에 같아야 하는 설정·구독(FANOUT_*)은
   * 지금 있는 창 전부에 걸고 새 창에도 다시 건다
   */
  tabsFacade(target: () => WindowEntry): TabManager {
    const fanout = (key: string, args: unknown[]): void => {
      if (FANOUT_LISTENERS.has(key)) this.fanoutListeners.push({ key, args })
      else this.fanoutLatest.set(key, args)
      for (const entry of this.all()) callMethod(entry.tabs, key, args)
    }
    return new Proxy({} as TabManager, {
      get: (_t, key) => {
        if (typeof key === 'string' && (FANOUT_SETTERS.has(key) || FANOUT_LISTENERS.has(key))) {
          return (...args: unknown[]) => fanout(key, args)
        }
        const real = target().tabs
        const value = Reflect.get(real, key) as unknown
        return typeof value === 'function' ? (value as AnyFn).bind(real) : value
      },
      set: (_t, key, value) => {
        Reflect.set(target().tabs, key, value)
        return true
      }
    })
  }

  /** 기본 창의 탭 관리자 겉모양(하네스·AI 러너용) */
  primaryTabs(): TabManager {
    if (!this.primaryFacade) this.primaryFacade = this.tabsFacade(() => this.primary())
    return this.primaryFacade
  }

  /** 사람이 쓰는 창의 탭 관리자 겉모양(캡처·번역·자동 채움처럼 '지금 보는 탭'을 다루는 쪽) */
  focusedTabs(): TabManager {
    if (!this.focusedFacade) this.focusedFacade = this.tabsFacade(() => this.focused())
    return this.focusedFacade
  }

  /**
   * 확장(chrome.tabs·windows)에 주는 탭 제공자 — 목록·새 탭은 사람이 쓰는 창, 닫기·활성화는 그 탭을 가진 창.
   * 창 번호는 하나(WINDOW_ID)로 보인다 — 확장은 창을 구분할 필요가 없다
   */
  extensionTabsProvider(): ExtensionTabsProvider {
    const providerOf = (entry: WindowEntry): ExtensionTabsProvider =>
      entry.tabs.extensionTabsProvider()
    return {
      tabs: () => providerOf(this.focused()).tabs(),
      create: (url, profile, active) => providerOf(this.focused()).create(url, profile, active),
      close: (wc) => {
        const found = this.findTab(wc)
        if (found) providerOf(found.entry).close(wc)
      },
      activate: (wc) => {
        const found = this.findTab(wc)
        if (found) providerOf(found.entry).activate(wc)
      },
      profileOf: (ses: Session) => {
        for (const entry of this.all()) {
          const profile = entry.tabs.profileOfSession(ses)
          if (profile !== 'default') return profile
        }
        return 'default'
      }
    }
  }

  /** 모든 창의 탭 목록(창 순서대로) — 저장·프로필 목록용 */
  allTabLists(): TabInfo[][] {
    return this.all().map((e) => e.tabs.listAll())
  }
}
