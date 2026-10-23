// AI 창 입력칸에 쓰다 만 글 — 앱을 껐다 켜도 남게 이 화면의 저장소(localStorage)에 둔다.
// 저장소가 막혀 있어도(사생활 모드·용량 초과) 화면은 그대로 돈다 — 읽기·쓰기 실패는 조용히 넘긴다

const DRAFT_KEY = 'noden.chatDraft'
/** 이보다 긴 글은 남기지 않는다(붙여 넣은 큰 글로 저장소를 채우지 않게) */
export const DRAFT_MAX_CHARS = 20_000

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadDraft(storage: DraftStorage | null = defaultStorage()): string {
  try {
    return storage?.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(text: string, storage: DraftStorage | null = defaultStorage()): void {
  try {
    if (text.trim() === '' || text.length > DRAFT_MAX_CHARS) storage?.removeItem(DRAFT_KEY)
    else storage?.setItem(DRAFT_KEY, text)
  } catch {
    // 저장 실패는 넘긴다 — 쓰던 글은 화면에 그대로 있다
  }
}

/** 앱을 끌 때 남길 글 = 입력칸 글 + 아직 못 보낸 대기열 글(보낼 순서대로) */
export function draftOnQuit(text: string, queued: readonly string[]): string {
  return [...queued, text].filter((t) => t.trim() !== '').join('\n')
}
