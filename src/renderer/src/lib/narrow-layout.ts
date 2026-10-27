// 좁은 창 배치 — 폰으로 본컴을 볼 때 노든 창은 세로 가상 모니터에 최대화되어 폭이 300px 남짓이 된다
// (원격 에이전트가 글씨도 키운다). 사이드바·브라우저·AI 창을 나란히 놓는 PC 배치는 그 폭에 들어가지 않아
// 오른쪽이 잘렸다(실기 10/27). 좁으면 한 번에 한 칸만 꽉 채운다. PC 에서는 창 최소 폭(1000)이라 들어오지 않는다

import { useSyncExternalStore } from 'react'

/** 이 폭(CSS px)보다 좁으면 한 칸 배치 */
export const NARROW_MAX = 720

export function isNarrowWidth(width: number): boolean {
  return width < NARROW_MAX
}

export type NarrowPane = 'sidebar' | 'panel' | 'main'

/**
 * 좁은 창에서 보일 한 칸 — 펼친 사이드바가 먼저(대화·화면을 고르는 중), 그다음 열린 AI 창, 아니면 브라우저·페이지
 */
export function narrowPane(sidebarCollapsed: boolean, panelCollapsed: boolean): NarrowPane {
  if (!sidebarCollapsed) return 'sidebar'
  return panelCollapsed ? 'main' : 'panel'
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/** 지금 창이 좁은 배치인가(창 크기·글씨 확대가 바뀌면 다시 그린다) */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => isNarrowWidth(window.innerWidth))
}
