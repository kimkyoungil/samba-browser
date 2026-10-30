import type { WebContents } from 'electron'

// 갤럭시 기준 모바일 흉내: UA + 뷰포트 + 터치
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-F711N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

// CDP device metrics 폭. tab-manager 의 뷰 중앙 정렬 계산도 이 값을 그대로 써서
// "에뮬레이션이 보고하는 뷰포트 폭"과 "실제로 화면에 그려지는 카드 폭"이 어긋나지 않게 한다
export const MOBILE_WIDTH = 412
export const MOBILE_HEIGHT = 915

// webContents 별 직렬 실행 큐. PC↔모바일 연타 시 attach/detach 가 뒤엉키지 않게 한다
const queues = new WeakMap<WebContents, Promise<void>>()

function enqueue(wc: WebContents, task: () => Promise<void>): Promise<void> {
  const prev = queues.get(wc) ?? Promise.resolve()
  const next = prev.then(task, task)
  queues.set(wc, next)
  return next
}

// 파괴·크래시된 webContents 에는 아무 명령도 보내지 않는다
function isUsable(wc: WebContents): boolean {
  try {
    return !wc.isDestroyed() && !wc.isCrashed()
  } catch {
    return false
  }
}

function isAttached(wc: WebContents): boolean {
  try {
    return isUsable(wc) && wc.debugger.isAttached()
  } catch (e) {
    console.error('디버거 상태 확인 실패', e)
    return false
  }
}

// 대화상자 감시 등 다른 기능이 디버거를 계속 필요로 하는 webContents.
// 여기 들어 있으면 모바일 에뮬레이션 해제가 디버거를 떼어내지 않는다
const debuggerPinned = new WeakSet<WebContents>()

/** 이 webContents 의 디버거를 에뮬레이션 해제 시에도 유지한다 */
export function keepDebuggerAttached(wc: WebContents): void {
  debuggerPinned.add(wc)
}

/** 디버거를 붙인다(이미 붙어 있으면 그대로). 다른 모듈(dialogs)과 공유한다 */
export function ensureDebuggerAttached(wc: WebContents): boolean {
  return attach(wc)
}

/**
 * 뒤에서 도는 자동화 탭이 '포커스된 보이는 화면'이라고 믿게 한다(CDP Emulation.setFocusEmulationEnabled).
 * 가려진 뷰는 visibilityState 가 hidden 이라 인스타 릴스 격자 같은 지연 렌더링 영역이 그려지지 않아
 * 영상 목록이 0개로 읽혔다(실기 2026-10-13). 사람 화면은 바뀌지 않는다
 */
export async function setFocusEmulation(wc: WebContents, enabled: boolean): Promise<void> {
  if (enabled && !attach(wc)) return
  await send(wc, 'Emulation.setFocusEmulationEnabled', { enabled })
}

/**
 * 브라우저 영역이 접혀 화면 크기가 없는 탭을 이 크기로 배치되게 한다(CDP Emulation.setDeviceMetricsOverride).
 * 0×0 으로 배치된 페이지에서는 AI 가 잰 좌표로 보낸 진짜 클릭이 엉뚱한 곳에 떨어졌다(실기 10/30 11번가).
 * 탭이 보이지 않을 때만 건다 — 사람 화면은 그대로다
 */
export function applyCollapsedSize(wc: WebContents, width: number, height: number): Promise<void> {
  return enqueue(wc, async () => {
    if (!attach(wc)) return
    await send(wc, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 0,
      mobile: false
    })
  })
}

/** 탭이 다시 화면 크기를 받으면 흉내를 푼다(디버거는 다른 기능이 쓸 수 있어 떼지 않는다) */
export function clearCollapsedSize(wc: WebContents): Promise<void> {
  return enqueue(wc, () => send(wc, 'Emulation.clearDeviceMetricsOverride'))
}

function attach(wc: WebContents): boolean {
  try {
    if (!isUsable(wc)) return false
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    return true
  } catch (e) {
    console.error('디버거 연결 실패', e)
    return false
  }
}

// CDP 명령 1건. 탭이 닫히는 중이면 'target closed' 가 나므로 여기서 삼킨다
async function send(wc: WebContents, method: string, params?: object): Promise<void> {
  if (!isAttached(wc)) return
  try {
    await wc.debugger.sendCommand(method, params)
  } catch (e) {
    console.error(`CDP 명령 실패: ${method}`, e)
  }
}

function setUserAgent(wc: WebContents, ua: string): void {
  try {
    if (isUsable(wc)) wc.setUserAgent(ua)
  } catch (e) {
    console.error('UA 설정 실패', e)
  }
}

export function applyMobileEmulation(wc: WebContents): Promise<void> {
  return enqueue(wc, async () => {
    if (!attach(wc)) return
    setUserAgent(wc, MOBILE_UA)
    await send(wc, 'Emulation.setDeviceMetricsOverride', {
      width: MOBILE_WIDTH,
      height: MOBILE_HEIGHT,
      deviceScaleFactor: 2.6,
      mobile: true
    })
    // 터치 에뮬레이션은 켜지 않는다. 켜면 Chromium TouchEmulator 가 오른쪽 버튼 입력을 통째로
    // 삼키고 mousedown 시점에 컨텍스트 메뉴를 띄워, 마우스 제스처(우클릭 드래그)가 불가능해지고
    // 메뉴도 놓는 순간이 아니라 누르는 순간에 뜬다. 모바일 UA + 뷰포트 메트릭만으로 모바일 화면을 받는다
    await send(wc, 'Emulation.setTouchEmulationEnabled', { enabled: false })
    await send(wc, 'Emulation.setUserAgentOverride', {
      userAgent: MOBILE_UA,
      platform: 'Android'
    })
  })
}

export function clearMobileEmulation(wc: WebContents): Promise<void> {
  return enqueue(wc, async () => {
    // 이미 떨어져 있거나 탭이 사라졌으면 할 일이 없다
    if (!isAttached(wc)) {
      setUserAgent(wc, '')
      return
    }
    await send(wc, 'Emulation.clearDeviceMetricsOverride')
    await send(wc, 'Emulation.setTouchEmulationEnabled', { enabled: false })
    await send(wc, 'Emulation.setUserAgentOverride', { userAgent: '' })
    setUserAgent(wc, '')
    // detach 는 명령이 모두 끝난 뒤, 아직 붙어 있고, 다른 기능이 붙잡고 있지 않을 때만
    if (debuggerPinned.has(wc)) return
    try {
      if (isAttached(wc)) wc.debugger.detach()
    } catch (e) {
      console.error('디버거 해제 실패', e)
    }
  })
}
