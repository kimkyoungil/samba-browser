import { create } from 'zustand'
import type {
  AgentRunAck,
  ChatAgentEvent,
  AgentTodo,
  ChatDto,
  ChatMessageDto,
  HandoffKind,
  IpcResult
} from '@shared/ipc'
import {
  foldNoteBeforeStep,
  parseCompactCommand,
  RECENT_CHAT_LIMIT,
  restoreFinalNote,
  titleFromMessage
} from '@shared/chat'
import { agentImageDataUrl, type AgentImage } from '@shared/agent-image'
import type { AgentFile } from '@shared/agent-file'
import { DEFAULT_SETTINGS, type AgentEffort } from '@shared/settings'
import type { ChatEngine } from '@shared/ai'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  steps?: Step[]
  // 사용자가 붙여 넣은 이미지 미리보기(data URL). 이 세션 화면에만 있고 저장되지 않는다
  images?: string[]
  // 글자 단위로 흘러오는 중인 답(아직 확정 전). text 뒤에 이어서 보여 준다
  partial?: string
  // 사용자가 붙인 파일 이름(사진 말고). 이 세션 화면에만 있다 — 저장된 기록에는 '📎 이름' 한 줄로 남는다
  files?: string[]
  // AI 가 이번 답을 쓰며 생각한 과정(요약본)과 세운 할 일 목록. 이 세션 화면에만 있다
  thinking?: string
  todos?: AgentTodo[]
  // 사용자 말의 실행 꼬리표(메인이 붙여 준다)와 기록 줄 번호 — 고쳐 다시 보낼 때 그 줄부터 지운다
  turnId?: string
  rowId?: number
  // 이 말과 함께 보낸 첨부 원본(다시 보낼 때 그대로 싣는다). 이 세션 화면에만 있다
  sent?: { images?: AgentImage[]; files?: AgentFile[] }
}

// 일하는 중에 보낸 다음 말. 지금 작업이 끝나면 차례로 보낸다
export interface QueuedMessage {
  text: string
  images?: AgentImage[]
  files?: AgentFile[]
  // 이 말을 보낼 대화. 없으면 일하던 그 대화(다른 대화를 보다가 보낸 말은 그 대화 번호가 붙는다)
  chatId?: number
}
// 일하는 중 끼어든 말(메인이 받은 id). AI 가 집어 들면(split) 말풍선이 된다
export interface InjectingMessage extends QueuedMessage {
  id: string
}

// 대화 하나의 실행 표시(진행 띠·확인 카드·실패 문구 등) — 대화방마다 AI 가 따로 돌아 대화마다 둔다.
// seq 는 그 대화의 실행 세대(늦게 온 시작 실패 응답이 새 실행 표시를 덮지 않게)
export type ChatRun = RunView & { seq: number }
export interface Step {
  label: string
  ok: boolean
  // 번역 키. 있으면 화면에서 i18n 문구로 바꿔 보여 준다(메인이 보내는 label 은 그대로 표시)
  key?: string
  // AI 가 일하는 중에 쓴 중간 말(도구 단계가 아니다) — 끝 보고와 섞이지 않게 단계 기록에 둔다
  note?: boolean
}

// 캡차·2FA 사용자 넘김 카드 상태
export interface Handoff {
  requestId: string
  // 카드 종류(captcha = 캡차·2FA, keypad = 결제 비밀번호 키패드). 문구가 달라진다
  kind: HandoffKind
  matched: string
  url: string
}

// SDK 재시도 대기 표시용 (진행 띠 라벨은 i18n 으로 화면에서 조립)
export interface Retry {
  attempt: number
  reason: string
}

// 여러 건짜리 작업의 진행 상황(progress 도구). 화면에는 "3/26" 배지로 뜬다
export interface TaskProgress {
  done: number
  total: number
  label?: string
}

interface ChatState {
  messages: ChatMessage[]
  // 사이드바에 걸리는 최근 대화 목록
  chats: ChatDto[]
  // 지금 열려 있는 대화. null 이면 아직 저장되지 않은 새 대화다
  activeChatId: number | null
  // 대화별 실행 표시. 아래 status·toolCalls·confirm 등은 지금 화면 대화의 것을 그대로 비춘 값이다
  // (대화방마다 AI 가 따로 동시에 돈다 — 다른 대화의 진행은 여기에만 쌓인다)
  runs: Record<number, ChatRun>
  // 화면에 없는 대화의 말풍선(일하는 중이거나, 끝났지만 아직 다시 열어 보지 않은 실행). 다시 열면 기록 대신 이것을 쓴다
  // (기록에는 없는 '쓰는 중' 글·생각 과정·할 일 목록이 여기에 있다)
  parked: Record<number, ChatMessage[]>
  // 실행 세대 번호(대화 구분 없이 늘어난다). 대화별 실행에 이 값을 달아 늦은 응답을 거른다
  runSeq: number
  status: 'idle' | 'running' | 'done' | 'failed' | 'stopped'
  toolCalls: number
  currentLabel: string
  retry: Retry | null
  // 이번 실행에 적용된 플레이북 이름들(빈 배열이면 배지를 숨긴다)
  playbookNames: string[]
  // 여러 건짜리 작업의 진행 상황. null 이면 진행 배지를 숨긴다
  taskProgress: TaskProgress | null
  confirm: { requestId: string; action: string; kind: 'danger' | 'finish' } | null
  // 사이트가 사람의 추가 확인을 요구해 작업이 멈춰 있는 상태
  handoff: Handoff | null
  // 인증 막힘·사용 한도·모델 붐빔(Codex 429 — 한도와 별개)
  authError: 'missing' | 'limit' | 'busy' | null
  // 이 대화의 AI(입력줄 'Claude / Codex'). 대화마다 메인이 기억한다. 새 대화는 마지막으로 고른 AI 를 이어 쓴다
  engine: ChatEngine
  // 사용자가 직접 고른 값인지(새 대화를 만들 때 그 대화에 남길지 정한다)
  engineChosen: boolean
  // 지금 대화의 AI 를 메인에서 다시 읽는다(대화를 열 때)
  loadEngine: () => Promise<void>
  setEngine: (engine: ChatEngine) => Promise<void>
  // 이 대화의 코드 작업 폴더(있으면 코드 작업 모드). 새 대화는 보내기 전에 골라 두면 대화가 만들어질 때 붙는다
  codeFolder: string | null
  // 폴더를 고르지 못한 까닭(드라이브 맨 위·사용자 폴더 전체 등). 다시 고르거나 끄면 지운다
  codeFolderError: string | null
  loadCodeFolder: () => Promise<void>
  pickCodeFolder: () => Promise<void>
  clearCodeFolder: () => Promise<void>
  // PC 잠금 — 켜면 이 대화에서 AI 가 이 PC 의 파일을 하나도 못 본다(코드 폴더와 함께 켜지지 않는다)
  pcLocked: boolean
  setPcLock: (locked: boolean) => Promise<void>
  // 입력줄 아래 "모델 · 강도" 선택. 모델은 이 대화 AI 의 모델이다(메인이 AI 별로 기억한다)
  model: string
  modelChoices: string[]
  effort: AgentEffort
  // 설정에서 현재 모델·후보·추론 강도를 읽어 온다(입력줄이 뜰 때 한 번)
  loadModelMenu: () => Promise<void>
  setModel: (model: string) => Promise<void>
  setEffort: (effort: AgentEffort) => Promise<void>
  // 최근 대화 목록을 다시 읽는다(앱 시작·작업 종료 후)
  loadChats: () => Promise<void>
  // 사이드바 대화 목록에 몇 개까지 보일지(더 보기로 늘린다)와 검색어(비면 최근 목록)
  chatLimit: number
  chatQuery: string
  moreChats: () => Promise<void>
  searchChats: (query: string) => Promise<void>
  // 저장된 대화를 열어 메시지를 화면에 올린다
  openChat: (chatId: number) => Promise<void>
  // 화면을 비우고 새 대화를 시작한다(대화 행은 첫 전송 때 만들어진다)
  newChat: () => void
  // 대화를 지운다(삭제 표식). 화면에 열려 있었으면 새 대화로 돌아간다
  removeChat: (chatId: number) => Promise<void>
  // 대화를 사이드바 맨 위에 고정하거나 푼다(목록을 다시 읽어 자리를 맞춘다)
  pinChat: (chatId: number, pinned: boolean) => Promise<void>
  /** scheduleToken 은 예약이 보낸 실행임을 메인에 알리는 표식이다(사용자 입력에는 없다) */
  send: (
    text: string,
    scheduleToken?: string,
    images?: AgentImage[],
    files?: AgentFile[]
  ) => Promise<void>
  // 일하는 중에 보낸 말. 완료되면 맨 앞부터 하나씩 보내고, 중단·실패면 draftReturn 으로 입력칸에 돌려준다
  queue: QueuedMessage[]
  enqueue: (text: string, images?: AgentImage[], files?: AgentFile[], chatId?: number) => void
  // 일하는 중 끼어들기 — 도는 실행에 말을 넣는다. 못 넣으면(Codex·이미 끝남·대기열이 있음) 대기열에 둔다
  injecting: InjectingMessage[]
  sendWhileRunning: (text: string, images?: AgentImage[], files?: AgentFile[]) => Promise<void>
  unqueue: (index: number) => void
  // [지금 보내기] — 대기열의 그 말을 하던 일에 바로 끼워 넣는다(못 끼우면 하던 일을 멈추고 그 말을 먼저 보낸다)
  sendNow: (index: number) => Promise<void>
  // 하던 일을 멈추고 먼저 보낼 말. 멈춤이 끝 상태로 돌아오면 보낸다
  sendNowItem: QueuedMessage | null
  // 중단·실패로 못 보낸 대기 글. 입력칸이 takeDraftReturn 으로 받아 간다
  draftReturn: QueuedMessage | null
  takeDraftReturn: () => QueuedMessage | null
  // 대화창에 끌어다 놓은 파일. 입력줄이 takeDropped 로 받아 첨부한다
  dropped: File[] | null
  dropFiles: (files: File[]) => void
  takeDropped: () => File[] | null
  // 보낸 말을 고쳐 다시 보낸다 — 그 말부터 뒤를 화면과 기록에서 지우고 새 글로 보낸다(첨부는 그대로)
  resend: (messageId: string, text: string) => Promise<void>
  // 마지막 답을 다시 받는다 — 마지막 말을 같은 글·첨부로 다시 보낸다
  regenerate: () => Promise<void>
  stop: () => Promise<void>
  reply: (requestId: string, approved: boolean) => void
  // 넘김 카드 응답 — skip=true 는 건너뛰고 계속, false 는 작업 중단
  replyHandoff: (requestId: string, skip: boolean) => void
  handleEvent: (e: ChatAgentEvent) => void
}

let seq = 0
const nid = (): string => String(++seq)
// 새 대화 행을 만드는 중이면 그 약속. 그사이 대화를 바꾸거나 또 보내면 만든 대화 번호가 엉뚱한 화면에
// 붙으니, 끝날 때까지 기다렸다가 한다(버리지 않는다)
let creatingChat: Promise<void> | null = null

/** 새 대화 행 만들기를 시작한다 — 끝나면 부를 함수를 돌려준다 */
function beginCreatingChat(): () => void {
  let finish: () => void = () => {}
  creatingChat = new Promise<void>((resolve) => {
    finish = resolve
  })
  return () => {
    creatingChat = null
    finish()
  }
}

// 실행 표시들(진행 띠·확인 카드·실패 문구 등). 일하지 않을 때 대화를 바꾸거나 새 실행을 시작하면 비운다
type RunView = Pick<
  ChatState,
  | 'status'
  | 'toolCalls'
  | 'currentLabel'
  | 'retry'
  | 'playbookNames'
  | 'taskProgress'
  | 'confirm'
  | 'handoff'
  | 'authError'
>
function runState(status: 'idle' | 'running'): RunView {
  return {
    status,
    toolCalls: 0,
    currentLabel: '',
    retry: null,
    playbookNames: [],
    taskProgress: null,
    confirm: null,
    handoff: null,
    authError: null
  }
}

function idleRun(): ChatRun {
  return { ...runState('idle'), seq: 0 }
}

/** 대화 실행 표시에서 화면 위쪽(진행 띠·카드)에 비출 값만 뽑는다 */
function viewOf(r: RunView): RunView {
  return {
    status: r.status,
    toolCalls: r.toolCalls,
    currentLabel: r.currentLabel,
    retry: r.retry,
    playbookNames: r.playbookNames,
    taskProgress: r.taskProgress,
    confirm: r.confirm,
    handoff: r.handoff,
    authError: r.authError
  }
}

/** 이 대화가 지금 일하는 중인가 */
export function isChatRunning(
  s: { runs: Record<number, ChatRun>; activeChatId: number | null; status: ChatRun['status'] },
  chatId: number | null
): boolean {
  // 화면 대화는 위쪽 표시(status)가 그 대화 것이다 — 아직 대화 행이 없는 새 대화도 여기로 본다
  if (chatId === s.activeChatId) return s.status === 'running'
  return chatId !== null && s.runs[chatId]?.status === 'running'
}

/**
 * 대화 chatId 의 실행 표시를 고친다. 화면의 대화면 위쪽 표시(status 등)도 같이 고친다.
 * chatId 가 null 이면(아직 대화 행을 만들기 전의 새 대화) 화면 표시만 고친다
 */
function patchRun(
  chatId: number | null,
  patch: Partial<ChatRun> | ((r: ChatRun) => Partial<ChatRun>)
): void {
  useChatStore.setState((s) => {
    const onScreen = chatId === s.activeChatId
    // 화면 대화는 위쪽 표시가 지금 값이다(대화별 표시가 아직 없을 수 있다 — 대화 행 만들기 전 등)
    const cur =
      (chatId === null ? undefined : s.runs[chatId]) ??
      (onScreen ? { ...viewOf(s), seq: s.runSeq } : idleRun())
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
    return {
      ...(chatId === null ? {} : { runs: { ...s.runs, [chatId]: next } }),
      ...(onScreen ? viewOf(next) : {})
    }
  })
}

/**
 * 화면의 대화에 실행 흔적이 있으면(일하는 중이거나 이번에 돈 실행) 그 말풍선을 맡겨 둔다 —
 * 다른 대화를 보는 동안에도 진행이 거기에 쌓이고, 다시 열면 생각 과정·할 일 목록까지 그대로 보인다
 */
function parkCurrent(s: {
  activeChatId: number | null
  runs: Record<number, ChatRun>
  messages: ChatMessage[]
  parked: Record<number, ChatMessage[]>
}): Record<number, ChatMessage[]> {
  const run = s.activeChatId === null ? undefined : s.runs[s.activeChatId]
  if (s.activeChatId === null || !run || run.status === 'idle') return s.parked
  return { ...s.parked, [s.activeChatId]: s.messages }
}

/** 맡겨 둔 말풍선 중 일하는 대화 것만 남긴다(끝난 대화는 다시 열면 기록으로 보인다) */
function keepRunningParked(s: {
  runs: Record<number, ChatRun>
  parked: Record<number, ChatMessage[]>
}): Record<number, ChatMessage[]> {
  return Object.fromEntries(
    Object.entries(s.parked).filter(([id]) => s.runs[Number(id)]?.status === 'running')
  ) as Record<number, ChatMessage[]>
}

/** 실행을 메인에 맡긴다. 이미지·파일이 있을 때만 뒤 인자를 붙인다(평소 경로의 호출 모양을 그대로 둔다) */
function startRun(
  text: string,
  chatId: number | null,
  scheduleToken?: string,
  images?: AgentImage[],
  files?: AgentFile[]
): Promise<IpcResult<AgentRunAck>> {
  if (files && files.length > 0)
    return window.samba.agent.run(text, chatId ?? undefined, scheduleToken, images, files)
  if (images && images.length > 0)
    return window.samba.agent.run(text, chatId ?? undefined, scheduleToken, images)
  const args: [string, number?, string?] =
    scheduleToken === undefined
      ? chatId === null
        ? [text]
        : [text, chatId]
      : [text, chatId ?? undefined, scheduleToken]
  return window.samba.agent.run(...args)
}

/** 사용자 말풍선과 비어 있는 답 말풍선 한 쌍 */
function turnPair(text: string, images?: AgentImage[], files?: AgentFile[]): ChatMessage[] {
  const previews = images && images.length > 0 ? images.map(agentImageDataUrl) : undefined
  const fileNames = files && files.length > 0 ? files.map((f) => f.name) : undefined
  return [
    {
      id: nid(),
      role: 'user',
      text,
      ...(previews ? { images: previews } : {}),
      ...(fileNames ? { files: fileNames } : {}),
      ...(previews || fileNames
        ? {
            sent: {
              ...(previews ? { images } : {}),
              ...(fileNames ? { files } : {})
            }
          }
        : {})
    },
    { id: nid(), role: 'ai', text: '', steps: [] }
  ]
}

// 진행 로그(step)는 마지막 AI 메시지에 붙인다
export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  chats: [],
  activeChatId: null,
  runs: {},
  parked: {},
  runSeq: 0,
  status: 'idle',
  toolCalls: 0,
  currentLabel: '',
  retry: null,
  playbookNames: [],
  taskProgress: null,
  confirm: null,
  handoff: null,
  authError: null,
  engine: 'claude',
  engineChosen: false,
  loadEngine: async () => {
    const r = await window.samba.agent.chatEngine?.(get().activeChatId)
    if (!r?.ok) return
    // 저장된 대화는 그 대화의 값, 새 대화는 사용자가 고른 값이 없을 때만 앱 기본값
    if (get().activeChatId !== null || !get().engineChosen) set({ engine: r.data.engine })
    await get().loadModelMenu()
  },
  setEngine: async (engine) => {
    // 일하는 대화의 AI 는 바꾸지 않는다(다른 대화는 일하는 중에도 고를 수 있다)
    if (get().status === 'running') return
    set({ engine, engineChosen: true })
    const chatId = get().activeChatId
    if (chatId !== null) await window.samba.agent.setChatEngine?.(chatId, engine)
    await get().loadModelMenu()
  },
  codeFolder: null,
  codeFolderError: null,
  pcLocked: false,
  loadCodeFolder: async () => {
    // 새 대화는 화면에서 골라 둔 값을 그대로 둔다(대화가 만들어질 때 붙인다)
    const chatId = get().activeChatId
    if (chatId === null) return
    const [folder, lock] = await Promise.all([
      window.samba.agent.codeFolder?.(chatId),
      window.samba.agent.pcLock?.(chatId)
    ])
    if (get().activeChatId !== chatId) return
    set({
      ...(folder?.ok ? { codeFolder: folder.data } : {}),
      ...(lock?.ok ? { pcLocked: lock.data } : {}),
      codeFolderError: null
    })
  },
  setPcLock: async (locked) => {
    // 일하는 대화는 끝난 뒤에 바꾼다
    if (get().status === 'running') return
    const chatId = get().activeChatId
    if (chatId !== null) {
      const r = await window.samba.agent.setPcLock?.(chatId, locked)
      if (r && !r.ok) {
        set({ codeFolderError: r.error })
        return
      }
    }
    // 잠그면 코드 폴더는 떨어진다(메인도 같이 뗀다)
    set((s) => ({
      pcLocked: locked,
      codeFolder: locked ? null : s.codeFolder,
      codeFolderError: null
    }))
  },
  pickCodeFolder: async () => {
    // 일하는 대화의 폴더는 바꾸지 않는다(다음 말부터 적용되면 하던 일과 섞인다)
    if (get().status === 'running') return
    const r = await window.samba.agent.pickCodeFolder?.()
    if (!r) return
    if (!r.ok) {
      set({ codeFolderError: r.error })
      return
    }
    if (r.data === null) return
    const chatId = get().activeChatId
    if (chatId !== null) {
      const saved = await window.samba.agent.setCodeFolder?.(chatId, r.data)
      if (saved && !saved.ok) {
        set({ codeFolderError: saved.error })
        return
      }
    }
    // 폴더를 붙이면 PC 잠금은 풀린다(메인도 같이 푼다)
    set({ codeFolder: r.data, codeFolderError: null, pcLocked: false })
  },
  clearCodeFolder: async () => {
    if (get().status === 'running') return
    const chatId = get().activeChatId
    if (chatId !== null) await window.samba.agent.setCodeFolder?.(chatId, null)
    set({ codeFolder: null, codeFolderError: null })
  },
  model: DEFAULT_SETTINGS.taskModels.standard,
  modelChoices: [],
  effort: DEFAULT_SETTINGS.agentEffort,
  loadModelMenu: async () => {
    // 이 대화 AI 의 모델 목록. 옛 메인(메뉴 IPC 없음)이면 앱 기본 연결의 작업별 모델로 떨어진다
    const engine = get().engine
    const menu = await window.samba.ai?.chatModelMenu?.(engine)
    if (menu?.ok) {
      if (get().engine === engine) set({ model: menu.data.model, modelChoices: menu.data.choices })
    } else {
      const r = await window.samba.ai?.taskModels()
      if (r?.ok) set({ model: r.data.taskModels.standard, modelChoices: r.data.choices })
    }
    const s = await window.samba.settings?.get()
    if (s?.ok) set({ effort: s.data.agentEffort })
  },
  setModel: async (model) => {
    // 화면을 먼저 바꾸고 저장한다(실패하면 다음 loadModelMenu 에서 되돌아온다)
    set({ model })
    if (window.samba.ai?.setChatModel) await window.samba.ai.setChatModel(get().engine, model)
    else await window.samba.ai?.setTaskModel('standard', model)
  },
  setEffort: async (effort) => {
    set({ effort })
    await window.samba.settings?.set({ agentEffort: effort })
  },
  loadChats: async () => {
    const { chatLimit, chatQuery } = get()
    const q = chatQuery.trim()
    const r = q
      ? await window.samba.chats?.search?.(q, chatLimit)
      : await window.samba.chats?.list(chatLimit)
    // 그사이 검색어가 바뀌었으면 늦게 온 결과는 버린다
    if (r?.ok && get().chatQuery.trim() === q) set({ chats: r.data })
  },
  chatLimit: RECENT_CHAT_LIMIT,
  chatQuery: '',
  moreChats: async () => {
    set((s) => ({ chatLimit: s.chatLimit + RECENT_CHAT_LIMIT }))
    await get().loadChats()
  },
  searchChats: async (query) => {
    // 검색어를 바꾸면 다시 첫 장(최근 RECENT_CHAT_LIMIT 개)부터
    set({ chatQuery: query, chatLimit: RECENT_CHAT_LIMIT })
    await get().loadChats()
  },
  openChat: async (chatId) => {
    while (creatingChat) await creatingChat
    // 이미 보고 있는 실행 대화를 다시 누르면 그대로 둔다(기록으로 덮으면 쓰는 중 글·생각 과정이 사라진다)
    if (chatId === get().activeChatId && get().status === 'running') return
    // 맡겨 둔 화면이 있으면 그것을 쓴다(기록에는 아직 없는 진행 중 글·생각 과정이 있다)
    let messages = get().parked[chatId]
    if (!messages) {
      const r = await window.samba.chats?.get(chatId)
      if (!r?.ok || r.data === null) return
      messages = r.data.messages.map(toChatMessage)
      // 기록을 읽는 사이 실행이 이 대화 화면을 맡겼으면 그것이 더 새것이다
      messages = get().parked[chatId] ?? messages
    }
    // 연 대화의 실행 표시를 위쪽에 비춘다 — 일하는 중이면 그 진행 띠·확인 카드, 아니면 빈 표시
    const kept = parkCurrent(get())
    const parked = Object.fromEntries(
      Object.entries(kept).filter(([id]) => Number(id) !== chatId)
    ) as Record<number, ChatMessage[]>
    const run = get().runs[chatId]
    set({
      activeChatId: chatId,
      messages,
      parked,
      codeFolder: null,
      codeFolderError: null,
      pcLocked: false,
      ...viewOf(run?.status === 'running' ? run : runState('idle'))
    })
    // 이 대화에서 고른 AI 와 그 모델로 입력줄을 맞춘다
    void get().loadEngine()
    // 이 대화의 코드 작업 폴더도 다시 읽는다
    void get().loadCodeFolder()
  },
  newChat: () => {
    if (creatingChat) {
      void creatingChat.then(() => get().newChat())
      return
    }
    // 일하는 대화를 떠나면 그 화면을 맡겨 둔다. 새 대화는 빈 실행 표시로 시작한다
    set({
      activeChatId: null,
      messages: [],
      parked: parkCurrent(get()),
      // 새 대화는 코드 작업 폴더·PC 잠금 없이 시작한다(앞 대화 설정을 몰래 이어 쓰지 않게)
      codeFolder: null,
      codeFolderError: null,
      pcLocked: false,
      ...runState('idle')
    })
  },
  pinChat: async (chatId, pinned) => {
    const r = await window.samba.chats?.pin?.(chatId, pinned)
    if (r?.ok) await get().loadChats()
  },
  removeChat: async (chatId) => {
    // 일하는 대화는 지우지 않는다(끝난 실행이 지운 대화에 기록을 남기려 한다)
    if (isChatRunning(get(), chatId)) return
    const r = await window.samba.chats?.remove(chatId)
    if (!r?.ok) return
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      parked: Object.fromEntries(
        Object.entries(s.parked).filter(([id]) => Number(id) !== chatId)
      ) as Record<number, ChatMessage[]>,
      runs: Object.fromEntries(
        Object.entries(s.runs).filter(([id]) => Number(id) !== chatId)
      ) as Record<number, ChatRun>,
      // 대기열에 남은 그 대화 몫도 버린다
      queue: s.queue.filter((q) => q.chatId !== chatId)
    }))
    if (get().activeChatId === chatId) get().newChat()
  },
  send: async (text, scheduleToken, images, files) => {
    while (creatingChat) await creatingChat
    // 이 대화가 일하는 중이면 보내지 않는다(그 대화의 다음 말은 입력줄이 끼어들기·대기열로 보낸다).
    // 다른 대화가 일하는 중인 건 상관없다 — 대화방마다 따로 돈다. 예약 실행만 예전처럼 다른 일이 돌면 건너뛴다
    if (get().status === 'running') return
    if (
      scheduleToken !== undefined &&
      Object.values(get().runs).some((r) => r.status === 'running')
    )
      return
    const seq = get().runSeq + 1
    // 보낸 순간 입력줄에 보이던 AI — 새 대화를 만드는 동안 무엇이 바뀌어도 이 값으로 남긴다
    const engine = get().engine
    const codeFolder = get().codeFolder
    const pcLocked = get().pcLocked
    set((s) => ({
      messages: [...s.messages, ...turnPair(text, images, files)],
      runSeq: seq,
      // 끝난 다른 대화의 맡겨 둔 화면은 이제 버린다(다시 열면 기록으로 보인다). 일하는 대화 것은 둔다
      parked: keepRunningParked(s),
      ...runState('running'),
      ...(s.activeChatId === null
        ? {}
        : { runs: { ...s.runs, [s.activeChatId]: { ...runState('running'), seq } } })
    }))
    // 아직 저장되지 않은 새 대화면 여기서 대화 행을 만든다(제목은 첫 메시지에서 짓는다).
    // 저장은 메인(러너)이 작업 완료 시점에 한 번에 한다
    let chatId = get().activeChatId
    if (chatId === null) {
      const doneCreating = beginCreatingChat()
      try {
        const created = await window.samba.chats?.create(
          titleFromMessage(text) || text.slice(0, 40)
        )
        if (created?.ok) {
          chatId = created.data.id
          // 입력줄에 보이던 AI 를 그 대화에 먼저 남긴다 — 화면이 이 대화로 넘어가 AI 를 다시 읽기 전에,
          // 그리고 실행 전에(메인이 이 값으로 경로를 고른다). 직접 고르지 않았어도 남긴다: 앞 대화의 Codex 가
          // 화면에 남아 있는데 고른 적이 없다고 안 남기면 메인은 기본 AI(Claude)로 돌았다(실기 10/29 빈 답)
          await window.samba.agent.setChatEngine?.(chatId, engine)
          // 새 대화에서 골라 둔 코드 작업 폴더도 실행 전에 붙인다(메인이 이 값으로 코드 모드를 켠다)
          if (codeFolder) await window.samba.agent.setCodeFolder?.(chatId, codeFolder)
          if (pcLocked) await window.samba.agent.setPcLock?.(chatId, true)
          // 화면에 쌓던 실행 표시를 이 대화 몫으로 옮긴다
          set((s) => ({
            activeChatId: created.data.id,
            chats: [created.data, ...s.chats],
            runs: { ...s.runs, [created.data.id]: { ...viewOf(s), seq } }
          }))
        }
      } finally {
        doneCreating()
      }
    }
    // 메인은 "시작 접수" ack 만 즉시 돌려준다. 완료·실패는 status 이벤트로 온다.
    // 늦게 도착한 이전 세대의 응답은 버린다
    const r = await startRun(text, chatId, scheduleToken, images, files)
    if (!r.ok) {
      const failed = { status: 'failed' as const, currentLabel: r.error, retry: null }
      if (chatId === null) {
        if (get().runSeq === seq) set(failed)
      } else if (get().runs[chatId]?.seq === seq) patchRun(chatId, failed)
    }
  },
  queue: [],
  enqueue: (text, images, files, chatId) =>
    set((s) => {
      // 대화를 안 주면 지금 화면의 대화 몫(대화방마다 따로 돌아 대기열도 대화별로 꺼낸다)
      const to = chatId ?? s.activeChatId ?? undefined
      return {
        queue: [
          ...s.queue,
          {
            text,
            ...(images && images.length > 0 ? { images } : {}),
            ...(files && files.length > 0 ? { files } : {}),
            ...(to === undefined ? {} : { chatId: to })
          }
        ]
      }
    }),
  unqueue: (index) => set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),
  sendNowItem: null,
  sendNow: async (index) => {
    const q = get().queue[index]
    if (!q) return
    const target = q.chatId ?? get().activeChatId
    // 그새 그 대화의 일이 끝났으면 대기열이 알아서 보낸다
    if (!isChatRunning(get(), target)) return
    const drop = (): void => set((s) => ({ queue: s.queue.filter((x) => x !== q) }))
    // 1) 지금 실행에 끼워 넣는다(Claude). /compact 는 대화 전체를 요약해야 하니 끼우지 않는다
    const inject = window.samba.agent.inject
    if (inject && parseCompactCommand(q.text) === null) {
      const r = await inject(q.text, target ?? undefined, q.images, q.files)
      const id = r.ok && r.data.injected ? r.data.id : undefined
      // 그새 일이 끝났으면 대기열이 이미 보냈거나 보낸다
      if (!isChatRunning(get(), target) || !get().queue.includes(q)) return
      if (id !== undefined) {
        drop()
        set((s) => ({
          injecting: [...s.injecting, { ...q, id, ...(target === null ? {} : { chatId: target }) }]
        }))
        return
      }
    }
    // 2) 끼워 넣을 수 없으면(Codex·/compact) 그 대화의 하던 일을 멈추고 이 말을 먼저 보낸다
    drop()
    set({ sendNowItem: { ...q, ...(target === null ? {} : { chatId: target }) } })
    await window.samba.agent.stop(target ?? undefined)
  },
  injecting: [],
  sendWhileRunning: async (text, images, files) => {
    // 이미 대기열에 말이 있으면 순서가 뒤바뀌지 않게 이것도 대기열 뒤에 둔다.
    // /compact 는 하던 일 도중에 끼워 넣지 않는다 — 끝난 뒤 그 대화 전체를 요약해야 한다
    const inject = window.samba.agent.inject
    if (get().queue.length > 0 || !inject || parseCompactCommand(text) !== null)
      return get().enqueue(text, images, files)
    const chatId = get().activeChatId
    const r = await inject(text, chatId ?? undefined, images, files)
    const id = r.ok && r.data.injected ? r.data.id : undefined
    // 못 넣었거나 그사이 실행이 끝났으면 대기열로 — 끝난 뒤 이어서 보낸다
    if (id === undefined || !isChatRunning(get(), chatId))
      return get().enqueue(text, images, files, chatId ?? undefined)
    set((s) => ({
      injecting: [
        ...s.injecting,
        {
          id,
          text,
          ...(chatId === null ? {} : { chatId }),
          ...(images && images.length > 0 ? { images } : {}),
          ...(files && files.length > 0 ? { files } : {})
        }
      ]
    }))
  },
  draftReturn: null,
  takeDraftReturn: () => {
    const d = get().draftReturn
    // 다른 대화 몫이면 그 대화를 열 때까지 기다린다
    if (!d || (d.chatId !== undefined && d.chatId !== get().activeChatId)) return null
    set({ draftReturn: null })
    return d
  },
  dropped: null,
  dropFiles: (files) => {
    if (files.length > 0) set((s) => ({ dropped: [...(s.dropped ?? []), ...files] }))
  },
  takeDropped: () => {
    const d = get().dropped
    if (d) set({ dropped: null })
    return d
  },
  resend: async (messageId, text) => {
    if (get().status === 'running') return
    const msgs = get().messages
    const at = msgs.findIndex((m) => m.id === messageId && m.role === 'user')
    if (at < 0) return
    const target = msgs[at]
    // 이 말부터 뒤에서 기록에 남은 첫 줄 — 그 줄부터 끝까지 지운다(기록 전에 끊긴 말은 화면에만 있다)
    const rowId = msgs.slice(at).find((m) => m.rowId !== undefined)?.rowId
    const chatId = get().activeChatId
    if (chatId !== null && rowId !== undefined) {
      const r = await window.samba.chats?.truncate?.(chatId, rowId)
      // 기록을 못 지웠으면 보내지 않는다 — 지운 줄 알았던 답이 다음 대화 맥락에 그대로 남는다
      if (!r?.ok) {
        patchRun(chatId, {
          status: 'failed',
          currentLabel: r?.ok === false ? r.error : '',
          retry: null
        })
        return
      }
    }
    set({ messages: msgs.slice(0, at) })
    await get().send(text, undefined, target.sent?.images, target.sent?.files)
  },
  regenerate: async () => {
    const last = [...get().messages].reverse().find((m) => m.role === 'user')
    if (last) await get().resend(last.id, last.text)
  },
  stop: async () => {
    // 지금 화면 대화의 일만 멈춘다(다른 대화는 계속 돈다). 새 대화 행을 만드는 중이면 그 번호를 기다린다
    while (creatingChat) await creatingChat
    // 대화 행이 없으면(만들기 실패) 대화 없는 실행만 멈춘다
    await window.samba.agent.stop(get().activeChatId ?? undefined)
  },
  reply: (requestId, approved) => {
    window.samba.agent.confirmReply(requestId, approved)
    patchRun(chatOfCard(get(), requestId), { confirm: null })
  },
  // 넘김 카드도 확인 카드와 같은 응답 채널을 쓴다(승인=건너뛰고 계속, 거부=작업 중단)
  replyHandoff: (requestId, skip) => {
    window.samba.agent.confirmReply(requestId, skip)
    const owner = chatOfCard(get(), requestId)
    patchRun(owner, { handoff: null })
    // '작업 중단'은 응답만으로 끝나지 않는다 — 그 대화의 실행 자체를 멈춘다
    if (!skip) void window.samba.agent.stop(owner ?? undefined)
  },
  handleEvent: (e) => {
    // 이벤트의 대화(대화방마다 따로 돈다). 대화 번호가 없으면(대화 없는 실행·페이지 대화상자 확인) 화면 대화
    const target = e.chatId ?? get().activeChatId
    // 그 대화가 화면에 있으면 화면 말풍선에, 아니면 맡겨 둔 말풍선에 쌓는다
    const onScreen = target === get().activeChatId
    const msgs = onScreen ? get().messages : target === null ? [] : (get().parked[target] ?? [])
    const last = msgs[msgs.length - 1]
    const putMsgs = (next: ChatMessage[]): void => {
      if (onScreen) set({ messages: next })
      else if (target !== null) set((s) => ({ parked: { ...s.parked, [target]: next } }))
    }
    const patchLast = (p: Partial<ChatMessage>): void =>
      putMsgs([...msgs.slice(0, -1), { ...last, ...p }])
    if (e.type === 'text' && last?.role === 'ai')
      patchLast({ text: last.text ? `${last.text}\n${e.text}` : e.text, partial: undefined })
    if (e.type === 'partial' && last?.role === 'ai') patchLast({ partial: e.text })
    // 생각 과정·할 일 목록은 매번 전체가 온다 — 그대로 갈아 끼운다
    if (e.type === 'thinking' && last?.role === 'ai') patchLast({ thinking: e.text })
    if (e.type === 'todos' && last?.role === 'ai') patchLast({ todos: e.items })
    // 실행이 시작됐다 — 방금 보낸 말(마지막 AI 말풍선 바로 앞)에 꼬리표를 단다. 이어 돌기는 같은 꼬리표라 그대로 둔다
    if (e.type === 'turn' && last?.role === 'ai') {
      const user = msgs[msgs.length - 2]
      if (user?.role === 'user' && user.turnId === undefined)
        putMsgs([...msgs.slice(0, -2), { ...user, turnId: e.turnId }, last])
    }
    // 끼어든 말을 AI 가 집어 들었다 — 칩을 말풍선으로 바꾸고 새 답 말풍선을 연다(묶여 들어간 말은 한 말풍선)
    if (e.type === 'split') {
      const picked = get().injecting.filter((q) => e.injectIds.includes(q.id))
      const images = picked.flatMap((q) => q.images ?? [])
      const files = picked.flatMap((q) => q.files ?? [])
      const text = picked.length > 0 ? picked.map((q) => q.text).join('\n') : e.texts.join('\n')
      // 앞 답에 남은 '쓰는 중' 글은 그때까지 쓴 대로 굳힌다
      const before =
        last?.role === 'ai' && last.partial
          ? [
              ...msgs.slice(0, -1),
              {
                ...last,
                text: last.text ? `${last.text}\n${last.partial}` : last.partial,
                partial: undefined
              }
            ]
          : msgs
      set((s) => ({ injecting: s.injecting.filter((q) => !e.injectIds.includes(q.id)) }))
      putMsgs([
        ...before,
        {
          id: nid(),
          role: 'user',
          text,
          ...(images.length > 0 ? { images: images.map(agentImageDataUrl) } : {}),
          ...(files.length > 0 ? { files: files.map((f) => f.name) } : {}),
          ...(images.length > 0 || files.length > 0
            ? {
                sent: {
                  ...(images.length > 0 ? { images } : {}),
                  ...(files.length > 0 ? { files } : {})
                }
              }
            : {})
        },
        { id: nid(), role: 'ai', text: '', steps: [] }
      ])
      return
    }
    // 기록을 남겼다 — 꼬리표가 같은 말에 줄 번호를 단다(이어 돌기가 남긴 뒤 줄은 첫 번호를 지킨다)
    // 그새 화면이 다른 대화로 넘어갔을 수 있다 — 화면과 맡겨 둔 화면을 다 찾는다
    if (e.type === 'saved') {
      const stamp = (list: ChatMessage[]): ChatMessage[] | null => {
        const at = list.findIndex((m) => m.turnId === e.turnId && m.role === 'user')
        if (at < 0 || list[at].rowId !== undefined) return null
        return list.map((m, i) => (i === at ? { ...m, rowId: e.rowId } : m))
      }
      const onView = stamp(get().messages)
      if (onView) set({ messages: onView })
      else
        for (const [id, list] of Object.entries(get().parked)) {
          const next = stamp(list)
          if (next) {
            set((s) => ({ parked: { ...s.parked, [Number(id)]: next } }))
            break
          }
        }
    }
    // 진행 기록 한 줄(자동 학습 차례 등) — 끝 보고 자리는 그대로 두고 단계 기록에만 붙인다
    if (e.type === 'step' && e.note && last?.role === 'ai') {
      patchLast({ steps: [...(last.steps ?? []), { label: e.label, ok: e.ok, note: true }] })
    } else if (e.type === 'step' && last?.role === 'ai') {
      // 도구 단계가 시작되면 그때까지 쓴 글은 중간 말로 옮긴다 — 말풍선 글자리에는 끝 보고만 남는다
      const folded = foldNoteBeforeStep(last.text, last.steps ?? [])
      patchLast({
        text: folded.text,
        steps: [...folded.steps, { label: e.label, ok: e.ok }]
      })
      patchRun(target, (r) => ({ toolCalls: r.toolCalls + 1, currentLabel: e.label, retry: null }))
    }
    if (e.type === 'progress' && e.kind === 'apiRetry')
      patchRun(target, { retry: { attempt: e.attempt, reason: e.reason } })
    // progress 도구가 알려 준 "n/N" — 화면 위쪽 진행 배지에 그대로 뜬다
    if (e.type === 'progress' && e.kind === 'task')
      patchRun(target, {
        taskProgress:
          e.label === undefined
            ? { done: e.done, total: e.total }
            : { done: e.done, total: e.total, label: e.label }
      })
    // 이번 실행에 적용된 플레이북(이름만 온다)
    if (e.type === 'playbook') patchRun(target, { playbookNames: e.names })
    if (e.type === 'confirm')
      patchRun(target, {
        confirm: { requestId: e.requestId, action: e.action, kind: e.kind ?? 'danger' }
      })
    if (e.type === 'handoff') {
      patchRun(target, {
        handoff: { requestId: e.requestId, kind: e.kind, matched: e.matched, url: e.url }
      })
      if (last?.role === 'ai') {
        patchLast({
          steps: [...(last.steps ?? []), { label: '', ok: true, key: 'handoff.waiting' }]
        })
      }
    }
    if (e.type === 'handoffDone') {
      // 자동 재개·시간 초과로 끝났을 수도 있으므로 카드를 항상 닫는다
      patchRun(target, { handoff: null })
      if (last?.role === 'ai') {
        patchLast({
          steps: [
            ...(last.steps ?? []),
            {
              label: '',
              ok: e.outcome !== 'aborted' && e.outcome !== 'timeout',
              key: `handoff.step.${e.outcome}`
            }
          ]
        })
      }
    }
    if (e.type === 'status') {
      // 중단·실패·완료 뒤에 뒤늦게 도착한 running 은 무시한다.
      // send() 가 실행을 시작할 때 그 대화 상태를 먼저 running 으로 바꾸므로 정상 시작은 통과한다
      const cur = isChatRunning(get(), target) ? 'running' : 'other'
      if (e.state === 'running' && cur !== 'running') return
      const auth = e.message?.startsWith('auth:')
        ? (e.message.slice(5) as 'missing' | 'limit' | 'busy')
        : null
      const done = e.state === 'done' || e.state === 'failed' || e.state === 'stopped'
      // 작업이 끝나면 메인이 방금 기록을 남겼다 — 목록의 제목·순서를 다시 읽는다
      if (done) void get().loadChats()
      // 중단·실패로 끊긴 '쓰는 중' 글은 그때까지 쓴 대로 화면에 남긴다(기록에는 확정 글만 있다)
      if (done && last?.role === 'ai' && last.partial)
        putMsgs([
          ...msgs.slice(0, -1),
          {
            ...last,
            text: last.text ? `${last.text}\n${last.partial}` : last.partial,
            partial: undefined
          }
        ])
      // 마지막에 도구로 끝내 끝 보고 글이 비었으면 마지막 중간 말을 답 글로 되돌린다(메인 기록과 같게)
      else if (done && last?.role === 'ai' && !last.text) {
        const final = restoreFinalNote(last.text, last.steps ?? [])
        if (final.text) putMsgs([...msgs.slice(0, -1), { ...last, ...final }])
      }
      // 이 대화의 다음 말 — 완료면 맨 앞 것을 이어서 보내고, 중단·실패면 저절로 돌지 않게 입력칸으로 돌려준다.
      // AI 가 집어 들지 못하고 끝난 끼어든 말도 이 대화 몫으로 대기열 맨 앞에 돌린다.
      // [지금 보내기]로 하던 일을 멈춘 경우엔 그 말을 먼저 보내고, 남은 대기열은 그대로 둔다.
      // 다른 대화 몫은 그 대화가 끝날 때 꺼낸다(대화방마다 따로 돈다)
      // 대화 번호 없는 대기 말은 화면 대화 몫(대기열에 넣을 때 화면 대화 번호를 붙이지만, 새 대화는 없다)
      const mineOf = (q: QueuedMessage): boolean => (q.chatId ?? get().activeChatId) === target
      const urgentItem = get().sendNowItem
      const urgent = done && urgentItem && mineOf(urgentItem) ? urgentItem : null
      const leftover = done ? get().injecting.filter(mineOf) : []
      const mine = [...leftover.map(toQueued), ...get().queue.filter(mineOf)]
      const returned = done && e.state !== 'done' && !urgent ? mine : []
      const mineLeft = returned.length > 0 ? [] : mine
      const next = done ? (urgent ?? mineLeft[0]) : undefined
      const prevDraft = get().draftReturn
      const draftParts = [...(prevDraft ? [prevDraft] : []), ...returned]
      if (done)
        set((s) => ({
          injecting: s.injecting.filter((q) => !mineOf(q)),
          sendNowItem: urgent ? null : s.sendNowItem,
          queue: [
            ...s.queue.filter((q) => !mineOf(q)),
            ...(urgent || !next ? mineLeft : mineLeft.slice(1))
          ]
        }))
      if (returned.length > 0)
        set({
          draftReturn: {
            text: draftParts
              .map((q) => q.text)
              .filter(Boolean)
              .join('\n'),
            images: draftParts.flatMap((q) => q.images ?? []),
            files: draftParts.flatMap((q) => q.files ?? []),
            ...(target === null ? {} : { chatId: target })
          }
        })
      patchRun(target, (r) => ({
        status: e.state,
        authError: auth,
        toolCalls: e.toolCalls ?? r.toolCalls,
        retry: e.state === 'running' ? r.retry : null,
        // 중단 후 응답 불가능한 확인·넘김 카드가 남지 않도록 정리
        confirm: done ? null : r.confirm,
        handoff: done ? null : r.handoff
      }))
      // 상태가 끝으로 바뀐 뒤에 보낸다(send 는 그 대화가 일하는 중이면 받지 않는다). 메인은 앞 실행의 뒷정리를
      // 기다렸다가 시작한다. 그 말의 대화가 지금 화면이면 평소처럼, 아니면 화면은 그대로 두고 뒤에서 보낸다
      if (next) {
        const to = next.chatId ?? target
        if (to === get().activeChatId)
          void get().send(next.text, undefined, next.images, next.files)
        else if (to !== null) void sendInBackground(to, next)
      }
    }
  }
}))

/** 이 카드(확인·넘김) 번호를 띄운 대화. 못 찾으면 null(아직 대화 행이 없는 새 대화 화면) */
function chatOfCard(
  s: {
    runs: Record<number, ChatRun>
    activeChatId: number | null
    confirm: ChatRun['confirm']
    handoff: ChatRun['handoff']
  },
  requestId: string
): number | null {
  for (const [id, r] of Object.entries(s.runs)) {
    if (r.confirm?.requestId === requestId || r.handoff?.requestId === requestId) return Number(id)
  }
  return s.activeChatId
}

/**
 * 앞 일이 끝난 뒤 화면에 없는 대화 몫의 대기 말을 보낸다. 화면은 그대로 두고,
 * 그 대화의 말풍선(맡겨 둔 것, 없으면 기록)에 쌓는다
 */
async function sendInBackground(chatId: number, item: QueuedMessage): Promise<void> {
  const store = useChatStore
  let base = store.getState().parked[chatId]
  if (!base) {
    const r = await window.samba.chats?.get(chatId)
    // 그사이 지운 대화면 보내지 않는다
    if (!r?.ok || r.data === null) return
    base = r.data.messages.map(toChatMessage)
  }
  // 그사이 그 대화의 다른 실행이 시작됐으면 맨 앞에 되돌려 놓는다(그 실행이 끝나면 다시 차례가 온다)
  if (isChatRunning(store.getState(), chatId)) {
    store.setState((s) => ({ queue: [{ ...item, chatId }, ...s.queue] }))
    return
  }
  const seq = store.getState().runSeq + 1
  const pair = turnPair(item.text, item.images, item.files)
  store.setState((s) =>
    s.activeChatId === chatId
      ? { messages: [...s.messages, ...pair], runSeq: seq }
      : { parked: { ...s.parked, [chatId]: [...(base ?? []), ...pair] }, runSeq: seq }
  )
  patchRun(chatId, { ...runState('running'), seq })
  const r = await startRun(item.text, chatId, undefined, item.images, item.files)
  if (!r.ok && store.getState().runs[chatId]?.seq === seq)
    patchRun(chatId, { status: 'failed', currentLabel: r.error, retry: null })
}

/** 끼어든 말을 대기열 모양으로(메인이 준 id 는 버리고 대화 번호는 남긴다) */
function toQueued(q: InjectingMessage): QueuedMessage {
  return {
    text: q.text,
    ...(q.images ? { images: q.images } : {}),
    ...(q.files ? { files: q.files } : {}),
    ...(q.chatId === undefined ? {} : { chatId: q.chatId })
  }
}

/** 저장된 메시지 한 줄을 화면 메시지로 바꾼다(system 은 AI 말풍선으로 보여 준다) */
function toChatMessage(row: ChatMessageDto): ChatMessage {
  return {
    id: `db-${row.id}`,
    role: row.role === 'user' ? 'user' : 'ai',
    text: row.content,
    steps: row.steps ?? undefined,
    rowId: row.id
  }
}
