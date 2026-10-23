import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { isHttpUrl } from '../shared/url'

// 메인 창 생성. 렌더러(React UI)가 전체를 덮고, 웹뷰는 그 위에 겹쳐 배치.
// 창이 여럿일 수 있다(WindowManager) — position 을 주면 그 자리에(새 창·탭 분리), 없으면 OS 기본 자리에 띄운다
export function createMainWindow(position?: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    title: 'noden 브라우저',
    // 작업표시줄·알트탭에 노든 마크가 보이게(개발 모드에서도 electron 기본 아이콘 대신)
    icon: join(__dirname, '../../resources/icon.ico'),
    ...(position ? { x: Math.max(0, position.x), y: Math.max(0, position.y) } : {}),
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f5f5f7', symbolColor: '#1d1d1f', height: 38 },
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/renderer.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 외부 브라우저로 넘기는 건 http/https 만. file:/javascript: 등은 무시한다
    if (isHttpUrl(url)) void shell.openExternal(url)
    else console.warn(`외부 열기 차단: ${url}`)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
