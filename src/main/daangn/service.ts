// 당근 통합 채팅함 서비스 — 계정별 숨은 뷰 풀을 돌려 채팅 목록을 합치고, 안 읽음이 늘면 알리고,
// 선택한 방을 오른쪽 영역에 붙이고, 답변 템플릿을 입력칸에 채운다.
//
// Electron 에 묶인 부분(뷰 생성·숨김 창·알림 표시)은 deps 로 주입받아, 이 파일은 가짜 뷰·가짜 시계로 시험한다.
// 계정이 0개면 뷰도 타이머도 만들지 않는다. 한 계정의 읽기 실패·로그인 풀림은 그 계정 목록만 비운다

import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import {
  unreadByAccount,
  type DaangnAccountDto,
  type DaangnAccountState,
  type DaangnBounds,
  type DaangnChannelDto,
  type DaangnStateDto
} from '../../shared/daangn'
import type { DaangnRepo } from './repo'
import { NotifyThrottle, diffUnread, planScan } from './schedule'

/** 알림이 같은 방에 다시 울리기까지 최소 간격 */
const NOTIFY_COOLDOWN_MS = 120_000
/** 첫 읽기가 이만큼 연달아 비어 있으면 "진짜 채팅이 없는 계정" 으로 보고 빈 목록을 기준으로 삼는다 */
const EMPTY_FIRST_READS_BASELINE = 3
/** 임시 뷰가 목록을 그릴 때까지 기다리는 최대 횟수(1초 간격) */
const TEMP_WAIT_TRIES = 10

/** DaangnAccountView 의 공개 메서드 부분집합 — 시험에서 가짜로 바꿔 끼운다 */
export interface AccountViewLike {
  start(host: BrowserWindow): Promise<void>
  stop(): void
  state(): DaangnAccountState
  scan(): Promise<{
    me: { displayName: string; profileImage: string | null } | null
    channels: DaangnChannelDto[]
  }>
  openRoom(roomId: string): Promise<void>
  openLogin(): Promise<void>
  currentRoomId(): string | null
  show(bounds: DaangnBounds, target: BrowserWindow): void
  hide(): void
  fillText(text: string): Promise<boolean>
}

export interface DaangnServiceDeps {
  repo: DaangnRepo
  /** 뷰의 집인 숨김 창(없으면 만든다) */
  hiddenHost: () => BrowserWindow
  /** 방을 보여 줄 앱 창. 없으면 보이지 않는다 */
  appWindow: () => BrowserWindow | null
  settings: () => Settings
  send: (channel: string, payload: unknown) => void
  notify: (title: string, body: string, onClick: () => void) => void
  now: () => number
  /** 임시 뷰가 그려지길 기다릴 때 쓴다(시험에서는 즉시) */
  sleep: (ms: number) => Promise<void>
  /** 계정을 만들 때의 작업공간 파티션 접두사(예: 'persist:ws1-') — 그때 한 번 정해 저장한다 */
  partitionPrefix: () => string
  createView: (a: { accountId: number; partition: string }) => AccountViewLike
}

interface OpenRoom {
  accountId: number
  /** null 이면 로그인(QR) 화면을 보여 주는 중 */
  roomId: string | null
}

export class DaangnService {
  private readonly views = new Map<number, AccountViewLike>()
  private readonly channelsBy = new Map<number, DaangnChannelDto[]>()
  private readonly states = new Map<number, DaangnAccountState>()
  private readonly identity = new Map<number, string>()
  private readonly lastReadAt: Record<number, number> = {}
  /** 계정별 지난번 방별 안 읽은 수 — 없으면 그 계정의 첫 읽기(알림 폭주 방지) */
  private readonly prevUnread = new Map<number, Map<string, number>>()
  /** 첫 읽기에서 연달아 빈 목록이 나온 횟수 — 목록이 아직 안 그려졌을 수 있어 몇 번은 기준으로 삼지 않는다 */
  private readonly emptyFirstReads = new Map<number, number>()
  private readonly throttle = new NotifyThrottle(NOTIFY_COOLDOWN_MS)
  private warm = new Set<number>()
  private selectedId: number | null = null
  private open: OpenRoom | null = null
  private bounds: DaangnBounds | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private timerMs = 0
  private chain: Promise<void> = Promise.resolve()
  private queued = 0
  private lastEmitted = ''

  constructor(private readonly deps: DaangnServiceDeps) {}

  // --- 시작·정리 ---------------------------------------------------------------

  /** 앱 시작 때 부른다. 계정이 1개 이상일 때만 타이머를 돌린다 */
  start(): void {
    if (this.deps.repo.listAccounts().length === 0) return
    this.ensureTimer()
    void this.runTick()
  }

  dispose(): void {
    this.clearTimer()
    this.stopAllViews()
  }

  // --- 상태 ----------------------------------------------------------------------

  snapshot(): DaangnStateDto {
    const channels = [...this.channelsBy.values()].flat()
    const unread = unreadByAccount(channels)
    const accounts: DaangnAccountDto[] = this.deps.repo.listAccounts().map((r) => ({
      id: r.id,
      label: r.label,
      displayName: r.displayName,
      profileImage: r.profileImage,
      state: this.states.get(r.id) ?? 'loading',
      unread: unread[r.id] ?? 0
    }))
    return { accounts, channels }
  }

  // --- 계정 ----------------------------------------------------------------------

  /** 계정을 만들고 로그인(QR) 화면을 오른쪽 영역에 보인다 */
  async addAccount(label: string): Promise<DaangnAccountDto> {
    const row = this.deps.repo.addAccount({ label, partitionPrefix: this.deps.partitionPrefix() })
    this.states.set(row.id, 'loading')
    this.ensureTimer()
    await this.showLogin(row.id)
    this.emit(true)
    return this.snapshot().accounts.find((a) => a.id === row.id) as DaangnAccountDto
  }

  removeAccount(id: number): void {
    this.views.get(id)?.stop()
    this.views.delete(id)
    this.channelsBy.delete(id)
    this.states.delete(id)
    this.prevUnread.delete(id)
    this.warm.delete(id)
    if (this.open?.accountId === id) this.open = null
    this.deps.repo.removeAccount(id)
    if (this.deps.repo.listAccounts().length === 0) this.clearTimer()
    this.emit(true)
  }

  renameAccount(id: number, label: string): void {
    this.deps.repo.setLabel(id, label)
    this.emit(true)
  }

  /** 로그인이 풀린 계정을 다시 로그인(QR)하게 한다 */
  async relogin(id: number): Promise<void> {
    this.channelsBy.delete(id)
    this.prevUnread.delete(id)
    this.states.set(id, 'loading')
    await this.showLogin(id)
    this.emit(true)
  }

  private async showLogin(id: number): Promise<void> {
    const view = await this.ensureView(id)
    await view.openLogin()
    this.selectedId = id
    this.hideOtherThan(id)
    this.open = { accountId: id, roomId: null }
    this.showOpen()
  }

  // --- 방 ------------------------------------------------------------------------

  async openRoom(accountId: number, roomId: string): Promise<void> {
    const view = await this.ensureView(accountId)
    this.selectedId = accountId
    this.hideOtherThan(accountId)
    await view.openRoom(roomId)
    this.open = { accountId, roomId }
    this.showOpen()
  }

  /** 오른쪽 영역의 위치·크기. null 이면(다른 화면·대화상자) 뷰를 접는다 */
  setRoomBounds(bounds: DaangnBounds | null): void {
    this.bounds = bounds
    if (!this.open) return
    if (bounds) this.showOpen()
    else this.views.get(this.open.accountId)?.hide()
  }

  closeRoom(): void {
    if (this.open) this.views.get(this.open.accountId)?.hide()
    this.open = null
  }

  /**
   * 입력칸에 글을 넣는다. 열려 있는 방의 계정과 다른 계정이면 입력칸을 건드리지 않고 false —
   * 다른 계정 입력칸에 글이 들어가는 일이 없게 한다
   */
  async fillText(accountId: number, text: string): Promise<boolean> {
    if (!this.open || this.open.accountId !== accountId || this.open.roomId === null) return false
    const view = this.views.get(accountId)
    return view ? view.fillText(text) : false
  }

  private showOpen(): void {
    if (!this.open || !this.bounds) return
    const target = this.deps.appWindow()
    if (!target) return
    this.views.get(this.open.accountId)?.show(this.bounds, target)
  }

  private hideOtherThan(accountId: number): void {
    if (this.open && this.open.accountId !== accountId) this.views.get(this.open.accountId)?.hide()
  }

  // --- 틱 ------------------------------------------------------------------------

  /** 한 번 읽기. 겹치지 않게 줄을 세운다 */
  runTick(): Promise<void> {
    this.queued += 1
    const p = this.chain.then(() => this.doTick()).finally(() => (this.queued -= 1))
    this.chain = p.catch(() => undefined)
    return p
  }

  private async doTick(): Promise<void> {
    const s = this.deps.settings()
    const accounts = this.deps.repo.listAccounts()
    if (!s.daangnEnabled || accounts.length === 0) {
      this.stopAllViews()
      return
    }
    this.ensureTimer(s.daangnScanIntervalMs)
    const now = this.deps.now()
    const ids = accounts.map((a) => a.id)
    const channels = [...this.channelsBy.values()].flat()
    const plan = planScan({
      accountIds: ids,
      unread: unreadByAccount(channels),
      lastReadAt: this.lastReadAt,
      warm: this.warm,
      selectedId: this.open?.accountId ?? this.selectedId,
      now,
      warmMax: s.daangnWarmViews,
      tempMax: s.daangnTempViews,
      minGapMs: s.daangnRotateIntervalSec * 1000
    })
    this.warm = new Set(plan.warm)

    // 상시가 아니게 된 뷰는 닫는다(열린 방의 뷰와 이번 임시 대상은 남긴다)
    for (const [id, view] of [...this.views]) {
      if (this.warm.has(id) || plan.temp.includes(id) || this.open?.accountId === id) continue
      view.stop()
      this.views.delete(id)
    }
    await Promise.all(plan.warm.map((id) => this.ensureView(id).then(() => this.readAccount(id))))
    for (const id of plan.temp) await this.readTemp(id)
    this.emit(false)
  }

  /** 상시가 아닌 계정을 잠깐 띄워 목록만 읽고 닫는다 */
  private async readTemp(id: number): Promise<void> {
    const view = await this.ensureView(id)
    for (let i = 0; i < TEMP_WAIT_TRIES; i++) {
      const st = view.state()
      if (st === 'logged_in' || st === 'expired' || st === 'read_failed') break
      await this.deps.sleep(1000)
    }
    await this.readAccount(id)
    if (this.open?.accountId !== id && !this.warm.has(id)) {
      view.stop()
      this.views.delete(id)
    }
  }

  private async readAccount(id: number): Promise<void> {
    const view = this.views.get(id)
    if (!view) return
    this.lastReadAt[id] = this.deps.now()
    try {
      const r = await view.scan()
      const st = view.state()
      if (st === 'expired' || st === 'read_failed') return this.drop(id, st)
      if (st === 'loading') return
      this.applyChannels(id, r.channels)
      this.setState(id, 'logged_in')
      if (r.me && r.me.displayName && this.identity.get(id) !== r.me.displayName) {
        this.identity.set(id, r.me.displayName)
        this.deps.repo.setIdentity(id, r.me.displayName, r.me.profileImage)
      }
    } catch {
      // 한두 번 실패는 옛 목록을 그대로 둔다. 뷰가 연달아 실패로 판정하면(read_failed) 그 계정만 비운다
      const st = view.state()
      if (st === 'expired' || st === 'read_failed') this.drop(id, st)
    }
  }

  /** 이 계정 목록을 비우고 상태를 바꾼다. 다음에 다시 읽히면 "첫 읽기" 로 본다 */
  private drop(id: number, st: DaangnAccountState): void {
    this.channelsBy.delete(id)
    this.prevUnread.delete(id)
    this.emptyFirstReads.delete(id)
    this.setState(id, st)
  }

  private setState(id: number, st: DaangnAccountState): void {
    if (this.states.get(id) === st) return
    this.states.set(id, st)
    this.deps.repo.setState(id, st, this.deps.now())
  }

  private applyChannels(id: number, channels: DaangnChannelDto[]): void {
    const prev = this.prevUnread.get(id) ?? null
    const label = this.deps.repo.listAccounts().find((a) => a.id === id)?.label ?? `계정 ${id}`
    if (this.deps.settings().daangnNotify) {
      for (const c of diffUnread(prev, channels)) {
        if (!this.throttle.allow(`${c.accountId}:${c.roomId}`, this.deps.now())) continue
        this.deps.notify(`[${label}] ${c.peerName}`, c.lastMessage, () =>
          this.deps.send(IPC.daangnNotifyClick, { accountId: c.accountId, roomId: c.roomId })
        )
      }
    }
    // 기준(지난번 안 읽은 수)은 목록이 실제로 채워진 읽기에서 잡는다. 첫 읽기가 빈 목록이면(아직 안 그려졌을 수 있다)
    // 몇 번 더 기다렸다가 — 그러지 않으면 곧 채워진 목록 전체가 새 메시지로 보여 알림이 쏟아진다
    if (prev === null && channels.length === 0) {
      const n = (this.emptyFirstReads.get(id) ?? 0) + 1
      this.emptyFirstReads.set(id, n)
      if (n >= EMPTY_FIRST_READS_BASELINE) this.prevUnread.set(id, new Map())
    } else {
      this.emptyFirstReads.delete(id)
      this.prevUnread.set(id, new Map(channels.map((c) => [`${c.accountId}:${c.roomId}`, c.unread])))
    }
    this.channelsBy.set(id, channels)
  }

  // --- 내부 ------------------------------------------------------------------------

  private async ensureView(id: number): Promise<AccountViewLike> {
    const existing = this.views.get(id)
    if (existing) return existing
    const row = this.deps.repo.listAccounts().find((a) => a.id === id)
    if (!row) throw new Error('없는 계정이에요')
    const view = this.deps.createView({ accountId: id, partition: row.partition })
    this.views.set(id, view)
    await view.start(this.deps.hiddenHost())
    return view
  }

  private stopAllViews(): void {
    for (const view of this.views.values()) view.stop()
    this.views.clear()
    this.warm.clear()
    this.open = null
  }

  private ensureTimer(intervalMs = this.deps.settings().daangnScanIntervalMs): void {
    if (this.timer && this.timerMs === intervalMs) return
    this.clearTimer()
    this.timerMs = intervalMs
    this.timer = setInterval(() => {
      if (this.queued === 0) void this.runTick()
    }, intervalMs)
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 렌더러에 통합 상태를 보낸다. 바뀐 게 없으면(force 가 아니면) 보내지 않는다 */
  private emit(force: boolean): void {
    const snap = this.snapshot()
    const sig = JSON.stringify(snap)
    if (!force && sig === this.lastEmitted) return
    this.lastEmitted = sig
    this.deps.send(IPC.daangnUpdated, snap)
  }
}
