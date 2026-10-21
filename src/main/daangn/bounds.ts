// 당근 숨은 뷰의 영역 계산(Electron 을 쓰지 않아 그대로 시험할 수 있다).
// WebContentsView 는 창에 붙어 있어야 뷰포트가 생긴다(0 이면 당근 웹이 목록을 그리지 않는다).
// 실측(2026-10-21): 보이는 창의 창 밖 좌표(x=-10000)에 두면 뷰포트가 0 이 된다.
// 그래서 보이지 않을 때는 전용 숨김 BrowserWindow(show:false) 안의 실제 영역(hiddenBounds)에 두고,
// 보일 때만 앱 창으로 옮겨 붙인다

import type { DaangnBounds } from '../../shared/daangn'

/** 이보다 좁으면 당근채팅이 1단(모바일) 배치로 바뀌어 방 화면이 달라진다 */
export const MIN_ROOM_WIDTH = 640

/** 숨김 창 안에서 뷰가 차지하는 영역 — 뷰포트가 1100x800 으로 잡힌다 */
export function hiddenBounds(): DaangnBounds {
  return { x: 0, y: 0, width: 1100, height: 800 }
}

/** 렌더러가 보낸 영역을 정수·최소 폭으로 보정한다. 숫자가 아니면 숨김 영역 기본값 */
export function clampBounds(b: DaangnBounds): DaangnBounds {
  const vals = [b.x, b.y, b.width, b.height]
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return hiddenBounds()
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(MIN_ROOM_WIDTH, Math.round(b.width)),
    height: Math.max(1, Math.round(b.height))
  }
}
