// 탭 바 끌어 옮기기의 순수 판정 — 같은 창 안 자리 바꾸기 / 다른 창에서 온 탭 받기 / 탭 바 밖에 놓아 새 창으로 떼기.
// DOM·IPC 는 TabBar.tsx 가 맡고, 여기는 테스트할 수 있는 계산만 둔다

/** 창 사이로 탭 id 를 실어 나르는 dataTransfer 형식(창마다 React 상태가 따로라 글자로 넘긴다) */
export const TAB_DRAG_MIME = 'application/x-samba-tab'

export interface DropPlan {
  /** 같은 창 안 자리 바꾸기(move) / 다른 창에서 온 탭 받기(adopt) / 할 일 없음 */
  kind: 'move' | 'adopt' | 'none'
  tabId: string
  /** 놓을 자리(탭만 센 자리) */
  toIndex: number
}

/**
 * 탭 바에 놓았을 때 할 일.
 * - 끈 탭이 이 창의 탭이면 자리 바꾸기(끄는 탭을 빼고 나면 그 뒤 자리들이 하나씩 당겨진다)
 * - 이 창에 없는 탭 id 면 다른 창의 탭 — 받아 온다
 */
export function planDrop(
  draggedId: string,
  shownIds: readonly string[],
  dropIndex: number
): DropPlan {
  const from = shownIds.indexOf(draggedId)
  if (from < 0) return { kind: 'adopt', tabId: draggedId, toIndex: dropIndex }
  const to = dropIndex > from ? dropIndex - 1 : dropIndex
  if (to === from) return { kind: 'none', tabId: draggedId, toIndex: to }
  return { kind: 'move', tabId: draggedId, toIndex: to }
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 끌기가 끝났을 때 탭을 새 창으로 떼어야 하는가.
 * 어느 드롭 대상도 받지 않았고(dropEffect none — 페이지 위·바탕화면·다른 앱), 마우스가 탭 바 밖에 있을 때만.
 * 탭 바 안에서 끝났으면(Esc 취소·제자리) 떼지 않는다. 좌표가 0,0 이면 창 밖(알 수 없음)으로 본다
 */
export function shouldDetach(
  dropEffect: string,
  point: { x: number; y: number },
  tabBar: Rect | null
): boolean {
  if (dropEffect !== 'none') return false
  if (!tabBar) return true
  if (point.x === 0 && point.y === 0) return true
  const inside =
    point.x >= tabBar.left &&
    point.x <= tabBar.right &&
    point.y >= tabBar.top &&
    point.y <= tabBar.bottom
  return !inside
}

/** 이 dataTransfer 가 삼바 탭 끌기인가(다른 창에서 온 것도 포함) */
export function isTabDrag(types: readonly string[] | DOMStringList | undefined): boolean {
  if (!types) return false
  return Array.from(types as ArrayLike<string>).includes(TAB_DRAG_MIME)
}
