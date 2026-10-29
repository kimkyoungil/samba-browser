// AI 채팅 기록 공유 타입. 메인·렌더러 양쪽에서 쓴다.
//
// 비밀값 방어: 메시지에 담기는 것은 사용자가 친 글, AI 가 쓴 글, 그리고 진행 로그의
// **라벨**뿐이다. fill_secret·login 같은 도구는 평문을 라벨에 넣지 않으므로(도구 쪽에서
// 이미 보장한다) 여기서도 label/ok/key 세 칸만 저장한다 — 그 밖의 키는 sanitizeSteps 가 버린다

export type ChatRole = 'user' | 'assistant' | 'system'

export const CHAT_ROLES: readonly ChatRole[] = ['user', 'assistant', 'system']

/** 사이드바에 걸리는 최근 채팅 개수 */
export const RECENT_CHAT_LIMIT = 20

/** 제목을 자동으로 지을 때 잘라 쓰는 첫 메시지 길이 */
export const CHAT_TITLE_MAX = 40

/** 진행 로그 한 줄. 화면의 Step 과 같은 모양이되, 저장되는 칸은 이 넷뿐이다 */
export interface ChatStepDto {
  label: string
  ok: boolean
  /** 번역 키(있으면 화면에서 i18n 문구로 바꿔 보여 준다) */
  key?: string
  /** AI 가 일하는 중에 쓴 중간 말(도구 단계가 아니다). label 이 그 글이다 */
  note?: boolean
}

/**
 * 도구 단계가 시작되면, 그때까지 쓴 답 글은 '중간 말'로 단계 기록에 넣고 답 글을 비운다 —
 * 답 글에는 마지막 단계 뒤에 쓴 글(끝 보고)만 남는다. 노든은 일하며 쓴 혼잣말과 끝 보고를 한 말풍선에
 * 이어 붙여 끝 보고가 묻혔다(사장님 10/29 "업무가 끝나면 끝났습니다 하고 보고를 해야 되잖아")
 */
export function foldNoteBeforeStep<S extends { label: string; ok: boolean; note?: boolean }>(
  text: string,
  steps: S[]
): { text: string; steps: S[] } {
  const note = text.trim()
  if (note === '') return { text, steps }
  return { text: '', steps: [...steps, { label: note, ok: true, note: true } as S] }
}

/** 끝났는데 끝 보고 글이 비었으면(마지막에 도구로 끝냄) 마지막 중간 말을 답 글로 되돌린다 */
export function restoreFinalNote<S extends { label: string; ok: boolean; note?: boolean }>(
  text: string,
  steps: S[]
): { text: string; steps: S[] } {
  if (text.trim() !== '') return { text, steps }
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].note) return { text: steps[i].label, steps: steps.filter((_, j) => j !== i) }
  }
  return { text, steps }
}

/** 대화 한 줄(목록용) */
export interface ChatDto {
  id: number
  title: string
  createdAt: number
  updatedAt: number
  // 사이드바 맨 위에 고정했는가(이 PC 에만 남는다)
  pinned?: boolean
}

/** 메시지 한 줄 */
export interface ChatMessageDto {
  id: number
  chatId: number
  role: ChatRole
  content: string
  steps: ChatStepDto[] | null
  createdAt: number
  updatedAt: number
}

/** 대화 열기 응답 — 대화 정보 + 메시지 전체 */
export interface ChatDetailDto {
  chat: ChatDto
  messages: ChatMessageDto[]
}

/** 메시지 추가 요청 */
export interface AppendMessageInput {
  chatId: number
  role: ChatRole
  content: string
  steps?: ChatStepDto[]
}

/** 다른 앱(Aside)에서 가져올 대화 미리 보기 — 찾거나 고른 파일 하나 */
export interface ChatImportPreview {
  /** 가져올 파일(메인이 찾았거나 사용자가 고른 것만 옮길 수 있다) */
  path: string
  /** 파일에 든 대화방·말 수 */
  chats: number
  messages: number
  /** 이번에 새로 만들 대화방, 이미 가져온 방에 덧붙일 방, 옮길 말 수(이미 가져온 말은 빼고) */
  newChats: number
  appendChats: number
  newMessages: number
  /** 첫·마지막 말 시각(없으면 null) */
  from: number | null
  to: number | null
}

/** 가져오기 결과 */
export interface ChatImportResult {
  createdChats: number
  appendedChats: number
  messages: number
  /** 노든 그림 폴더로 옮겨 대화에 띄운 그림 수 */
  images: number
}

export function isChatRole(value: unknown): value is ChatRole {
  return typeof value === 'string' && (CHAT_ROLES as readonly string[]).includes(value)
}

/**
 * 저장 전 진행 로그를 정제한다.
 * 알 수 없는 칸(도구가 덧붙였을 수 있는 값·인자 등)은 전부 버리고 label/ok/key 만 남긴다.
 * 이것이 "스텝 로그에 평문 비밀번호가 들어갈 경로가 없다"는 마지막 방어선이다
 */
export function sanitizeSteps(steps: unknown): ChatStepDto[] | null {
  if (!Array.isArray(steps)) return null
  const rows: ChatStepDto[] = []
  for (const raw of steps) {
    if (typeof raw !== 'object' || raw === null) continue
    const step = raw as Record<string, unknown>
    const label = typeof step.label === 'string' ? step.label : ''
    const key = typeof step.key === 'string' ? step.key : undefined
    rows.push({
      label,
      ok: step.ok === true,
      ...(key === undefined ? {} : { key }),
      ...(step.note === true ? { note: true } : {})
    })
  }
  return rows
}

/** 첫 사용자 메시지에서 대화 제목을 짓는다. 비어 있으면 호출부가 기본 문구를 쓴다 */
export function titleFromMessage(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  return line.length > CHAT_TITLE_MAX ? `${line.slice(0, CHAT_TITLE_MAX)}…` : line
}

/**
 * /compact 로 남긴 압축 요약 답 글의 머리 표시. 이 표시로 시작하는 AI 답은 화면에서 '대화를 압축했어요'로 그리고,
 * 다음 세션의 앞부분 요약은 여기서부터 시작한다(그 앞 대화는 이 요약이 대신한다)
 */
export const COMPACT_MARK = '[대화 압축 요약]'

/** '/compact' 명령이면 덧붙인 지시(없으면 빈 글), 아니면 null. '/compactx' 같은 글은 명령이 아니다 */
export function parseCompactCommand(text: string): string | null {
  const m = /^\/compact(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? (m[1] ?? '').trim() : null
}
