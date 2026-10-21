// 당근 계정 1개의 숨은 채팅 뷰. TabManager 를 타지 않는 독립 WebContentsView 라서
// 탭 바·브릿지 탭 목록·AI 도구·확장·금고 저장 바에 보이지 않는다. 대신 보안 설정을 여기서 직접 건다.
//
// 뷰는 항상 어느 창엔가 붙어 있다 — 안 보일 때는 전용 숨김 창(host)의 hiddenBounds 에 두어 뷰포트(1100x800)를
// 유지하고(보이는 창의 창 밖 좌표는 뷰포트가 0 이 되어 실측으로 탈락), 보일 때만 앱 창으로 옮겨 붙인다.
// 당근 자체 목록 패널과 프로필 사이드바는 CSS 로 가린다(DOM 은 남아 계속 읽는다)

import { WebContentsView, session, type BrowserWindow, type WebContents } from 'electron'
import type { DaangnAccountState, DaangnBounds, DaangnChannelDto } from '../../shared/daangn'
import { clampBounds, hiddenBounds } from './bounds'
import { buildFillScript, buildHideListCss, buildScanScript, parseScan, type RawScan } from './selectors'
import { classifyChatUrl, isAllowedChatUrl, roomIdOf } from './url-guard'

/** 페이지의 alert·confirm·prompt 를 무력화한다(확인 대화상자가 쌓여 읽기가 멈추는 것도 막는다) */
const SILENCE_DIALOGS_SCRIPT =
  'window.alert = () => undefined; window.confirm = () => true; window.prompt = () => null'

const CHAT_HOME = 'https://chat.daangn.com/'
const LOGIN_URL = 'https://chat.daangn.com/login'
/** 읽기가 이만큼 연달아 실패하면 화면 읽기 실패로 본다 */
const READ_FAIL_LIMIT = 3

// 세션 보안 설정은 파티션마다 한 번만 건다
const hardened = new Set<string>()

function hardenPartition(partition: string): void {
  if (hardened.has(partition)) return
  hardened.add(partition)
  const ses = session.fromPartition(partition)
  // 알림·카메라·위치 같은 권한은 전부 거절한다(알림은 앱이 직접 띄운다)
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  // 다운로드는 받지 않는다
  ses.on('will-download', (e) => e.preventDefault())
}

export interface DaangnAccountViewDeps {
  accountId: number
  /** 저장소에 적힌 세션 파티션 이름 */
  partition: string
  now: () => Date
  /** 채팅 안 링크는 기본 브라우저로 연다 */
  openExternal: (url: string) => void
}

export class DaangnAccountView {
  private view: WebContentsView | null = null
  /** 숨김 창 — 뷰의 집이다 */
  private host: BrowserWindow | null = null
  /** 지금 뷰가 붙어 있는 창(숨김 창이거나 보이는 앱 창) */
  private current: BrowserWindow | null = null
  private url = ''
  private loggedIn = false
  private failures = 0
  private failed = false

  constructor(private readonly deps: DaangnAccountViewDeps) {}

  /** 숨김 창(host) 안에 뷰를 만들고 채팅 홈을 연다. 이미 있으면 아무것도 안 한다 */
  async start(host: BrowserWindow): Promise<void> {
    if (this.view) return
    hardenPartition(this.deps.partition)
    const view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(this.deps.partition),
        sandbox: true,
        contextIsolation: true,
        // 창 밖·뒤에 있어도 계속 그려지게 한다(목록 갱신이 멈추면 안 읽음을 놓친다)
        backgroundThrottling: false
      }
    })
    view.setBorderRadius(0)
    this.view = view
    this.host = host
    this.current = host
    const wc = view.webContents
    this.guard(wc)
    host.contentView.addChildView(view)
    view.setBounds(hiddenBounds())
    wc.on('did-navigate', (_e, url) => this.onNavigated(url))
    wc.on('did-navigate-in-page', (_e, url) => this.onNavigated(url))
    wc.on('did-finish-load', () => void this.injectCss())
    this.url = CHAT_HOME
    await wc.loadURL(CHAT_HOME).catch(() => undefined)
  }

  /** 뷰를 창에서 떼고 닫는다 */
  stop(): void {
    const view = this.view
    this.view = null
    if (!view) return
    try {
      this.current?.contentView.removeChildView(view)
    } catch {
      // 창이 이미 닫혔을 수 있다
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
    this.host = null
    this.current = null
  }

  /** 지금 이 계정의 상태. 주소가 로그인 화면이면 expired, 목록을 읽었으면 logged_in */
  state(): DaangnAccountState {
    if (this.failed) return 'read_failed'
    if (classifyChatUrl(this.url) === 'login') return 'expired'
    return this.loggedIn ? 'logged_in' : 'loading'
  }

  /**
   * 채팅 목록을 읽는다(읽기만 한다). 로그인 화면이거나 아직 안 그려졌으면 빈 목록,
   * 스크립트 실행·해석이 실패하면 던진다 — 3번 연달아 실패하면 state() 가 read_failed 가 된다
   */
  async scan(): Promise<{ me: RawScan['me']; channels: DaangnChannelDto[] }> {
    const wc = this.alive()
    if (!wc) throw new Error('뷰가 없어요')
    if (classifyChatUrl(wc.getURL()) !== 'chat') return { me: null, channels: [] }
    try {
      const raw = await wc.executeJavaScript(buildScanScript())
      const parsed = parseScan(raw, this.deps.accountId, this.deps.now())
      this.failures = 0
      this.failed = false
      // 이름이 읽혔을 때만 로그인된 것으로 본다(목록이 아직 안 그려졌으면 loading 그대로)
      if (parsed.me) this.loggedIn = true
      return parsed
    } catch (err) {
      this.failures += 1
      if (this.failures >= READ_FAIL_LIMIT) this.failed = true
      throw err
    }
  }

  currentRoomId(): string | null {
    const wc = this.alive()
    return wc ? roomIdOf(wc.getURL()) : null
  }

  /** 방을 연다. 목록에 그 줄이 있으면 눌러서(페이지 새로고침 없이), 없으면 주소로 이동한다 */
  async openRoom(roomId: string): Promise<void> {
    const wc = this.alive()
    if (!wc) throw new Error('뷰가 없어요')
    const clicked = await wc
      .executeJavaScript(
        `(() => { const a = document.querySelector('a[href*="/room/' + ${JSON.stringify(roomId)} + '"]'); if (!a) return false; a.click(); return true })()`
      )
      .catch(() => false)
    if (clicked !== true) await wc.loadURL(`${CHAT_HOME}room/${encodeURIComponent(roomId)}`)
  }

  /** 로그인(QR) 화면으로 보낸다 — 계정 추가·다시 로그인에서 쓴다 */
  async openLogin(): Promise<void> {
    const wc = this.alive()
    if (!wc) throw new Error('뷰가 없어요')
    this.loggedIn = false
    await wc.loadURL(LOGIN_URL).catch(() => undefined)
  }

  /** target(앱 창)의 오른쪽 영역에 보이게 한다 — 숨김 창에서 떼어 맨 위에 붙인다 */
  show(bounds: DaangnBounds, target: BrowserWindow): void {
    if (!this.view) return
    const clamped = clampBounds(bounds)
    // 너무 좁으면 옆 패널을 덮지 않게 접어 둔다
    if (!clamped) return this.hide()
    this.moveTo(target)
    this.view.setBounds(clamped)
  }

  /** 다시 숨김 창으로 돌려보낸다 */
  hide(): void {
    if (!this.view || !this.host) return
    this.moveTo(this.host)
    this.view.setBounds(hiddenBounds())
  }

  private moveTo(win: BrowserWindow): void {
    if (!this.view) return
    if (this.current && this.current !== win) {
      try {
        this.current.contentView.removeChildView(this.view)
      } catch {
        // 옛 창이 이미 닫혔을 수 있다
      }
    }
    // 같은 창이어도 다시 붙이면 맨 위로 올라온다
    win.contentView.addChildView(this.view)
    this.current = win
  }

  /** 입력칸에 글을 넣는다(보내기는 누르지 않는다). 입력칸이 없거나 값이 안 들어가면 false */
  async fillText(text: string): Promise<boolean> {
    const wc = this.alive()
    if (!wc) return false
    const ok = await wc.executeJavaScript(buildFillScript(text)).catch(() => false)
    return ok === true
  }

  webContents(): WebContents | null {
    return this.alive()
  }

  // --- 내부 ---------------------------------------------------------------

  private alive(): WebContents | null {
    const wc = this.view?.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }

  private onNavigated(url: string): void {
    this.url = url
    if (classifyChatUrl(url) === 'login') this.loggedIn = false
  }

  private async injectCss(): Promise<void> {
    const wc = this.alive()
    if (!wc || classifyChatUrl(wc.getURL()) !== 'chat') return
    await wc.insertCSS(buildHideListCss()).catch(() => undefined)
  }

  /** 당근 밖으로 못 나가게 하고, 새 창·링크는 기본 브라우저로 보낸다 */
  private guard(wc: WebContents): void {
    const block = (e: { preventDefault: () => void }, url: string): void => {
      if (isAllowedChatUrl(url)) return
      e.preventDefault()
    }
    wc.on('will-navigate', block)
    wc.on('will-redirect', block)
    // 당근 웹이 알림음 파일을 못 찾으면 alert("timer_HtmlChk Function error…") 를 계정마다 계속 띄운다 —
    // 숨은 뷰의 대화상자는 사람이 볼 일이 없으니 막고, 소리도 끈다
    wc.setAudioMuted(true)
    const silence = (): void => {
      void wc.executeJavaScript(SILENCE_DIALOGS_SCRIPT).catch(() => undefined)
    }
    wc.on('dom-ready', silence)
    wc.on('did-navigate-in-page', silence)
    // 숨김 창에서 확인 대화상자(떠나시겠어요?)가 뜨면 읽기가 영영 멈춘다 — 묻지 않고 넘어간다
    wc.on('will-prevent-unload', (e) => e.preventDefault())
    // 로그인 뒤 SPA 이동은 did-finish-load 가 다시 오지 않는다 — 목록 숨김 CSS 를 다시 넣는다
    wc.on('did-navigate-in-page', () => void this.injectCss())
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) this.deps.openExternal(url)
      return { action: 'deny' }
    })
  }
}
