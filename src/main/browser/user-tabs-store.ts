// 사람이 열어 둔 탭 기억하기 — 앱을 다시 띄우면(업데이트·재시작) 쓰던 탭을 그대로 되살린다.
// 실기 2026-10-02: 앱을 재시작할 때마다 사용자가 띄워 둔 탭·프로필 탭이 전부 사라졌다.
// 자동화(하네스·AI)가 연 탭은 기억하지 않는다 — 다시 뜨면 주인 없는 작업 탭이 된다.
import { readFileSync, writeFileSync } from 'node:fs'
import type { TabInfo } from '../../shared/ipc'

export interface SavedTab {
  url: string
  profile: string
  mobile: boolean
  active: boolean
}

/** 한 번에 되살리는 탭 수 상한 — 파일이 망가져도 창이 탭으로 뒤덮이지 않게 */
export const MAX_SAVED_TABS = 30

/** 되살리는 창 수 상한 */
export const MAX_SAVED_WINDOWS = 8

/** 창 하나의 저장 탭 목록 */
export type SavedWindow = SavedTab[]

/** 창 하나 — 별칭(브릿지 X-Samba-Window 가 쓰는 안정된 이름)과 탭 목록. 이름 있는 창은 탭이 없어도 되살린다 */
export interface SavedWindowGroup {
  name: string | null
  tabs: SavedTab[]
}

/** 파일 모양(v2). v1 은 탭 배열 하나(창 하나)였다 — 읽을 때 그대로 받아들인다.
 *  windows 원소는 탭 배열(이름 없는 창) 또는 {name, tabs}(이름 있는 창) 둘 다 읽는다 */
interface SavedTabsFileV2 {
  version: 2
  windows: Array<SavedWindow | { name: string | null; tabs: SavedWindow }>
}

/** 창 별칭 규칙 — 글자로 시작(숫자만인 창 번호와 섞이지 않게), 32자까지 */
export const WINDOW_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/

/** 지금 탭 목록에서 저장할 것만 고른다(사람이 연 탭, 순서 그대로). 주소가 없는 탭은 뺀다 */
export function savedTabsOf(list: readonly TabInfo[], isUser: (id: string) => boolean): SavedTab[] {
  return list
    .filter((t) => t.kind !== 'popup' && isUser(t.id) && t.url !== '')
    .slice(0, MAX_SAVED_TABS)
    .map((t) => ({ url: t.url, profile: t.profile, mobile: t.mobile, active: t.active }))
}

/** 탭 배열(JSON 값)을 검증해 탭 목록으로 바꾼다. 모양이 틀린 항목은 버린다 */
function parseTabList(parsed: unknown): SavedTab[] {
  if (!Array.isArray(parsed)) return []
  const out: SavedTab[] = []
  for (const v of parsed) {
    if (typeof v !== 'object' || v === null) continue
    const t = v as Partial<SavedTab>
    if (typeof t.url !== 'string' || t.url === '' || typeof t.profile !== 'string') continue
    out.push({
      url: t.url,
      profile: t.profile,
      mobile: t.mobile === true,
      active: t.active === true
    })
  }
  return out.slice(0, MAX_SAVED_TABS)
}

/** 저장 파일 내용을 읽어 탭 목록(창 하나 분량)으로 바꾼다. 파일이 깨졌으면 빈 목록 */
export function parseSavedTabs(raw: string): SavedTab[] {
  return parseSavedWindows(raw)[0] ?? []
}

/**
 * 저장 파일 내용을 창별 탭 목록으로 바꾼다.
 * v1(탭 배열 하나)은 창 하나로, v2({version:2, windows}) 는 창마다 하나씩. 빈 창·틀린 모양은 버린다
 */
export function parseSavedWindows(raw: string): SavedWindow[] {
  return parseSavedWindowGroups(raw)
    .map((g) => g.tabs)
    .filter((w) => w.length > 0)
}

/** 창별 목록 + 별칭. 이름 없는 빈 창은 버리고, 이름 있는 창은 빈 채로도 남긴다(브릿지가 이름으로 다시 찾는다) */
export function parseSavedWindowGroups(raw: string): SavedWindowGroup[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (Array.isArray(parsed)) {
    const one = parseTabList(parsed)
    return one.length > 0 ? [{ name: null, tabs: one }] : []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const file = parsed as Partial<SavedTabsFileV2>
  if (file.version !== 2 || !Array.isArray(file.windows)) return []
  const groups: SavedWindowGroup[] = []
  const seen = new Set<string>()
  for (const w of file.windows) {
    let name: string | null = null
    let tabs: SavedTab[]
    if (Array.isArray(w)) tabs = parseTabList(w)
    else if (typeof w === 'object' && w !== null) {
      const o = w as { name?: unknown; tabs?: unknown }
      name = typeof o.name === 'string' && WINDOW_NAME_RE.test(o.name) ? o.name : null
      tabs = parseTabList(o.tabs)
    } else continue
    // 같은 이름이 둘이면 앞 것만
    if (name !== null) {
      if (seen.has(name)) name = null
      else seen.add(name)
    }
    if (name === null && tabs.length === 0) continue
    groups.push({ name, tabs })
  }
  return groups.slice(0, MAX_SAVED_WINDOWS)
}

export function loadSavedTabs(file: string): SavedTab[] {
  return loadSavedWindows(file)[0] ?? []
}

export function loadSavedWindows(file: string): SavedWindow[] {
  return loadSavedWindowGroups(file)
    .map((g) => g.tabs)
    .filter((w) => w.length > 0)
}

export function loadSavedWindowGroups(file: string): SavedWindowGroup[] {
  try {
    return parseSavedWindowGroups(readFileSync(file, 'utf-8'))
  } catch {
    // 처음 실행이면 파일이 없다
    return []
  }
}

/** 창 하나(v1 모양)로 저장한다 — 옛 호출부 호환 */
export function writeSavedTabs(file: string, tabs: readonly SavedTab[]): void {
  writeSavedWindows(file, [tabs as SavedTab[]])
}

/** 창별 목록(v2 모양)으로 저장한다. 탭이 하나도 없는 창은 빼고 쓴다 */
export function writeSavedWindows(file: string, windows: readonly SavedWindow[]): void {
  writeSavedWindowGroups(
    file,
    windows.map((tabs) => ({ name: null, tabs }))
  )
}

/** 창별 목록 + 별칭으로 저장한다. 이름 없는 빈 창만 뺀다 */
export function writeSavedWindowGroups(file: string, groups: readonly SavedWindowGroup[]): void {
  const payload: SavedTabsFileV2 = {
    version: 2,
    windows: groups
      .filter((g) => g.name !== null || g.tabs.length > 0)
      .slice(0, MAX_SAVED_WINDOWS)
      .map((g) => (g.name === null ? g.tabs : { name: g.name, tabs: g.tabs }))
  }
  try {
    writeFileSync(file, JSON.stringify(payload), 'utf-8')
  } catch (e: unknown) {
    console.warn('열린 탭 저장 실패', e instanceof Error ? e.message : String(e))
  }
}
