import { join } from 'node:path'
import { app, crashReporter } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { TabManager } from './browser/tab-manager'
import {
  loadSavedWindowGroups,
  savedTabsOf,
  writeSavedWindowGroups
} from './browser/user-tabs-store'
import { WindowManager, type WindowEntry } from './browser/window-manager'
import { setExtensionTabsProvider } from './extensions/tabs-bridge'
import { installExtensionPageApi } from './extensions/page-api'
import { markQuitting } from './browser/popups'
import { registerInternalProtocol, registerInternalScheme } from './browser/internal-protocol'
import { registerIpc } from './ipc/handlers'
import { registerFaviconIpc } from './ipc/favicon'
import { openDatabase, type Db } from './db/client'
import type { VaultService } from './vault/service'
import type { SyncEngineHolder } from './sync/engine'
import { runLoginHarness, writeVaultLocked } from './e2e/login-harness'
import { chromeUserAgent } from './browser/webstore-ua'
import { humanBusyInWindow } from './browser/human-activity'

// 브라우저 프로세스 크래시 덤프를 로컬에 남긴다(서버 업로드 없음). 원인 추적용
crashReporter.start({ uploadToServer: false, compress: false })

// 콘솔 출력 파이프가 끊겨도(EPIPE — 로그를 받던 터미널·파일 핸들이 먼저 닫힘) 앱이 죽지 않게 한다.
// console.* 이 실패하며 uncaughtException 으로 번져 "A JavaScript error occurred" 창이 뜨던 문제
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}

// E2E 하네스용 userData 분리 — 실행 중인 사용자 앱의 DB 를 건드리지 않기 위해 복사본을 쓴다.
// app.whenReady() 이전에 지정해야 하므로 모듈 최상단에서 처리한다
const userDataOverride = process.env.SAMBA_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)

// 개발 모드(electron.exe 직접 실행)에서도 앱 이름이 'Electron' 대신 제품명으로 보이게 한다
app.setName('SAMBA Browser')

// 창이 다른 창에 가려지면 Windows 가림 감지가 렌더링을 멈춰 capturePage(키패드 OCR)가
// "Current display surface not available for capture" 로 실패한다(실기 2026-09-28) — 가림 감지를 끈다
// WebAuthenticationConditionalUI: 구글 로그인 화면이 열릴 때마다 윈도우 '암호 키 선택' 창이 저절로 뜨는 것을 막는다
// (크롬은 자동완성 목록으로 띄우지만 Electron 은 윈도우 보안 창을 띄운다 — 실기 2026-10-06). 사람이 누르는 패스키 로그인은 그대로 된다
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,WebAuthenticationConditionalUI'
)

// 모든 사이트에 순수 크롬 UA 를 보낸다 — Electron 기본 UA 의 `SAMBABrowser/1.0.0 … Electron/39` 토큰은
// reCAPTCHA Enterprise 같은 점수형 봇 판정에서 점수를 깎아 로그인이 조용히 거부된다(GS샵 실기).
// userAgentFallback 은 이후 만들어지는 모든 세션·webContents 의 기본값이라 whenReady 이전에 바꿔야 한다
app.userAgentFallback = chromeUserAgent(app.userAgentFallback)

// 같은 userData 로 두 번째 인스턴스가 뜨면 data.db 저장이 서로 충돌한다(rename EPERM).
// 락은 userData 경로별이라 SAMBA_USER_DATA 를 나눈 E2E·검증 인스턴스는 나란히 뜰 수 있다
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 바탕화면 아이콘 재실행 = 크롬처럼 같은 계정·같은 데이터로 새 창을 연다
  let lastSecondInstanceAt = 0
  app.on('second-instance', () => {
    if (!windows || windows.all().length === 0) return
    // 사람이 방금(HUMAN_BUSY_MS 안) 어느 창에든 입력 중이면 새 창을 띄우지 않는다 — 그 사이의 두 번째 실행은
    // 사람이 아니라 스크립트(워치독·하네스)가 띄운 것이라, 로그인하던 창의 포커스를 빼앗으면 안 된다
    if (windows.all().some((e) => humanBusyInWindow(e.win))) return
    // 더블클릭이 두 번 들어오거나 스크립트가 연달아 띄워도 창이 줄줄이 생기지 않게 잠깐 막는다
    const now = Date.now()
    if (now - lastSecondInstanceAt < SECOND_INSTANCE_THROTTLE_MS) return
    lastSecondInstanceAt = now
    windows.create({ openTab: true })
  })
}

// 내부 페이지 스킴(samba://) 등록도 app.whenReady() 이전이어야 한다
registerInternalScheme()

// 어디서도 잡지 못한 Promise 거부는 조용히 사라지지 않게 기록한다
process.on('unhandledRejection', (reason) => {
  console.error('처리되지 않은 Promise 거부', reason)
})

/** 연달아 들어온 second-instance 를 새 창으로 받지 않는 간격 */
const SECOND_INSTANCE_THROTTLE_MS = 1500

// second-instance(새 창)·종료 정리에서 써야 하므로 모듈 스코프로 올려둔다
let windows: WindowManager | undefined
let db: Db | undefined
let vault: VaultService | undefined
let sync: SyncEngineHolder | undefined

// 종료 순서: vault.dispose()(lock 포함, DB 조회 발생) → db.close() 순으로 해야 한다.
// 반대로 하면(예전 버그) db.close() 뒤에 창이 닫히며 vault.dispose() → lock() →
// pruneDeviceWrappedKeyIfDisabled() 가 이미 닫힌 sql.js 핸들에 쿼리를 날려 'out of memory'
// 예외가 Uncaught 로 터진다. before-quit 과 창 closed 이벤트 양쪽에서 호출될 수 있으므로
// db.close()/vault.dispose() 자체도 멱등하지만, 이 함수도 한 번만 실제로 동작하게 막아 둔다
let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    // 폴링·Realtime 구독을 먼저 끊는다 — 닫히는 DB 에 질의가 더 날아가지 않게
    sync?.current()?.stop()
    sync?.release()
  } catch (e: unknown) {
    console.error('동기화 종료 실패', e)
  }
  try {
    vault?.dispose()
  } catch (e: unknown) {
    console.error('금고 종료 실패', e)
  }
  try {
    db?.close()
  } catch (e: unknown) {
    console.error('DB 종료 실패', e)
  }
}

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('com.samba.browser')
    app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
    // 자체 새 탭 페이지 서빙. 개발 모드에서는 vite 개발 서버로 넘긴다
    registerInternalProtocol({
      rendererDir: join(__dirname, '../renderer'),
      ...(is.dev && process.env['ELECTRON_RENDERER_URL']
        ? { devServerUrl: process.env['ELECTRON_RENDERER_URL'] }
        : {})
    })
    // 창 여러 개(크롬처럼 새 창·탭 분리). 첫 창을 먼저 만들고, IPC 배선은 창을 모르는 WindowManager 에 건다
    windows = new WindowManager({
      createWindow: (position) => createMainWindow(position),
      createTabs: (win) => new TabManager(win)
    })
    const wm = windows
    // 파비콘은 사이트 자체에서만 받아온다(제3자 전송 없음). 탭 생성 전에 등록해야
    // 첫 탭의 page-favicon-updated 도 캐시에 들어간다
    registerFaviconIpc(wm)
    const first = wm.create()
    // 확장 팝업·서비스워커의 탭·창 API(tabs.create·windows 등)를 사람이 쓰는 창의 탭으로 처리한다
    setExtensionTabsProvider(wm.extensionTabsProvider())
    installExtensionPageApi()
    db = await openDatabase(join(app.getPath('userData'), 'data.db'))
    const ipc = registerIpc(wm, db)
    vault = ipc.vault
    sync = ipc.sync
    // 하네스 브릿지·AI 가 쓰는 기본 창의 탭 관리자(E2E 하네스도 같은 것을 쓴다)
    const tabs = first.tabs
    // 하네스 모드: 저장된 사이트를 순회하며 자동 로그인을 검증하고 끝나면 앱을 종료한다.
    // 환경변수 스위치는 개발 빌드에서만 인정한다 — 패키징된 앱에서는 무시한다
    const e2eTarget = app.isPackaged ? undefined : process.env.SAMBA_E2E_LOGIN
    if (e2eTarget) {
      const outFile = process.env.SAMBA_E2E_OUT ?? 'docs/검수/e2e-login-results.md'
      await vault.ensureUnlockedByDevice()
      if (vault.state() !== 'unlocked') {
        // 기기 키(DPAPI)는 Chromium 의 OSCrypt 키에 묶여 있어, DB 뿐 아니라 userData 의
        // "Local State" 파일까지 함께 복사해야 복사본에서도 자동 해제가 된다
        console.error('[e2e] vault locked — data.db 와 함께 "Local State" 도 복사했는지 확인')
        writeVaultLocked(outFile)
        app.quit()
        return
      }
      const limit = Number(process.env.SAMBA_E2E_LIMIT ?? '0')
      await runLoginHarness(
        {
          tabs,
          vault,
          excludedHosts: () => ipc.settings.get().vaultExcludedHosts,
          vaultAccessPolicy: () => ipc.settings.get().vaultAccessPolicy
        },
        {
          hosts: e2eTarget === 'all' ? 'all' : e2eTarget.split(',').map((h) => h.trim()),
          outFile,
          limit: Number.isFinite(limit) ? limit : 0,
          resume: process.env.SAMBA_E2E_RESUME === '1'
        }
      )
      app.quit()
      return
    }
    // 지난번에 사람이 열어 둔 탭을 창별로 되살린다(프로필·순서·보던 탭 그대로). 없으면 기본 탭 하나.
    // url 을 주지 않으면 설정에서 계산된 기본 주소(새 탭 페이지/홈/빈 페이지)로 연다
    const savedTabsFile = join(app.getPath('userData'), 'user-tabs.json')
    const restoreInto = (
      entry: WindowEntry,
      saved: ReturnType<typeof loadSavedWindowGroups>[number]['tabs']
    ): void => {
      let restored = 0
      let activeId: string | null = null
      for (const t of saved) {
        try {
          const info = entry.tabs.create({
            url: t.url,
            profile: t.profile,
            mobile: t.mobile,
            user: true,
            background: restored > 0
          })
          if (t.active) activeId = info.id
          restored += 1
        } catch (e: unknown) {
          console.warn('탭 되살리기 실패', t.url, e instanceof Error ? e.message : String(e))
        }
      }
      if (activeId) entry.tabs.activate(activeId)
    }
    // 창 별칭(브릿지가 이름으로 찾는 창)도 함께 되살린다 — 첫 창은 이미 만들어져 있으니 이름만 붙인다
    loadSavedWindowGroups(savedTabsFile).forEach((group, i) => {
      let entry: WindowEntry
      if (i === 0) {
        entry = first
        first.name = group.name
      } else {
        entry = wm.create(group.name ? { name: group.name } : {})
      }
      restoreInto(entry, group.tabs)
    })
    // 되살린 탭이 하나도 없는 창(첫 실행·전부 실패)은 빈 창으로 두지 않는다
    for (const entry of wm.all()) {
      if (entry.tabs.list().length === 0) entry.tabs.create({ user: true })
    }
    // 사람 탭이 바뀔 때마다(열기·닫기·이동·자리 바꿈·창 닫힘) 잠깐 모았다가 창별 목록으로 저장한다.
    // 마지막 창을 닫기 시작한 뒤에는 저장하지 않는다 — 종료 중 탭이 하나씩 사라지는 목록을 저장하면 다음에 빈 창이 뜬다
    let savingStopped = false
    let saveTimer: NodeJS.Timeout | null = null
    const stopSaving = (): void => {
      savingStopped = true
      if (saveTimer) clearTimeout(saveTimer)
    }
    const scheduleSave = (): void => {
      if (savingStopped) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        if (savingStopped) return
        writeSavedWindowGroups(
          savedTabsFile,
          wm.all().map((e) => ({
            name: e.name,
            tabs: savedTabsOf(e.tabs.listAll(), (id) => e.tabs.isUserTab(id))
          }))
        )
      }, 800)
    }
    app.on('before-quit', stopSaving)
    wm.eachWindow((entry) => {
      // 닫히는 창이 마지막 창이면 종료 — 그때부터 저장을 멈춘다
      entry.win.on('close', () => {
        if (wm.all().length <= 1) stopSaving()
      })
      entry.tabs.onChange(scheduleSave)
    })
    // 창 하나가 닫히면(다른 창이 남아 있을 때) 남은 창 목록으로 다시 저장한다
    wm.onClosed(scheduleSave)
    // macOS 의 activate 재생성은 1단계(Windows 전용) 범위 밖이라 배선하지 않는다
  })
  .catch((e: unknown) => {
    console.error('앱 초기화 실패', e)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 종료 직전 금고를 먼저 잠그고 DB 를 안전하게 저장/닫는다(내부적으로 pending save 를 즉시 flush 함).
// markQuitting 을 먼저 세운다 — 이 표식이 없으면 팝업 창(결제창)의 close 지연이
// preventDefault 로 종료 자체를 취소해, DB·금고만 닫힌 좀비 앱이 남는다
app.on('before-quit', () => {
  markQuitting()
  shutdown()
})
