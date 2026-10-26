import { create } from 'zustand'
import type {
  AgentEvent,
  AgentRunAck,
  AgentTodo,
  ChatDto,
  ChatMessageDto,
  HandoffKind,
  IpcResult
} from '@shared/ipc'
import { parseCompactCommand, RECENT_CHAT_LIMIT, titleFromMessage } from '@shared/chat'
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
export interface Step {
  label: string
  ok: boolean
  // 번역 키. 있으면 화면에서 i18n 문구로 바꿔 보여 준다(메인이 보내는 label 은 그대로 표시)
  key?: string
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
  // 지금 도는(또는 마지막으로 돈) 실행의 대화. 다른 대화를 보는 동안에도 진행은 이 대화 말풍선에 쌓인다
  runChatId: number | null
  // 화면에 없는 대화의 말풍선(일하는 중이거나, 끝났지만 아직 다시 열어 보지 않은 실행). 다시 열면 기록 대신 이것을 쓴다
  // (기록에는 없는 '쓰는 중' 글·생각 과정·할 일 목록이 여기에 있다)
  parked: Record<number, ChatMessage[]>
  // 실행 세대 번호. 이전 작업의 늦은 IPC 응답이 새 작업 UI 를 덮지 않게 한다
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
  handleEvent: (e: AgentEvent) => void
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

/** 지금 화면이 실행의 대화면 그 말풍선을 맡겨 둔다 — 다른 대화를 보는 동안에도 진행이 거기에 쌓인다 */
function parkCurrent(s: {
  activeChatId: number | null
  runChatId: number | null
  messages: ChatMessage[]
  parked: Record<number, ChatMessage[]>
}): Record<number, ChatMessage[]> {
  if (s.activeChatId === null || s.activeChatId !== s.runChatId) return s.parked
  return { ...s.parked, [s.activeChatId]: s.messages }
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
  runChatId: null,
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
    if (get().status === 'running' && get().activeChatId === get().runChatId) return
    set({ engine, engineChosen: true })
    const chatId = get().activeChatId
    if (chatId !== null) await window.samba.agent.setChatEngine?.(chatId, engine)
    await get().loadModelMenu()
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
    if (chatId === get().activeChatId && chatId === get().runChatId && get().status === 'running')
      return
    // 맡겨 둔 화면이 있으면 그것을 쓴다(기록에는 아직 없는 진행 중 글·생각 과정이 있다)
    let messages = get().parked[chatId]
    if (!messages) {
      const r = await window.samba.chats?.get(chatId)
      if (!r?.ok || r.data === null) return
      messages = r.data.messages.map(toChatMessage)
      // 기록을 읽는 사이 실행이 이 대화 화면을 맡겼으면 그것이 더 새것이다
      messages = get().parked[chatId] ?? messages
    }
    // 일하는 중이면 실행 표시는 그대로 둔다(진행 띠·확인 카드는 브라우저 작업의 것이다)
    const running = get().status === 'running'
    const kept = parkCurrent(get())
    const parked = Object.fromEntries(
      Object.entries(kept).filter(([id]) => Number(id) !== chatId)
    ) as Record<number, ChatMessage[]>
    set({
      activeChatId: chatId,
      messages,
      parked,
      ...(running ? {} : runState('idle'))
    })
    // 이 대화에서 고른 AI 와 그 모델로 입력줄을 맞춘다
    void get().loadEngine()
  },
  newChat: () => {
    if (creatingChat) {
      void creatingChat.then(() => get().newChat())
      return
    }
    // 일하는 대화를 떠나면 그 화면을 맡겨 둔다. 일하는 중이면 실행 표시는 그대로 둔다
    const running = get().status === 'running'
    set({
      activeChatId: null,
      messages: [],
      parked: parkCurrent(get()),
      ...(running ? {} : runState('idle'))
    })
  },
  pinChat: async (chatId, pinned) => {
    const r = await window.samba.chats?.pin?.(chatId, pinned)
    if (r?.ok) await get().loadChats()
  },
  removeChat: async (chatId) => {
    // 일하는 대화는 지우지 않는다(끝난 실행이 지운 대화에 기록을 남기려 한다)
    if (get().status === 'running' && chatId === get().runChatId) return
    const r = await window.samba.chats?.remove(chatId)
    if (!r?.ok) return
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      parked: Object.fromEntries(
        Object.entries(s.parked).filter(([id]) => Number(id) !== chatId)
      ) as Record<number, ChatMessage[]>,
      // 대기열에 남은 그 대화 몫도 버린다
      queue: s.queue.filter((q) => q.chatId !== chatId)
    }))
    if (get().activeChatId === chatId) get().newChat()
  },
  send: async (text, scheduleToken, images, files) => {
    while (creatingChat) await creatingChat
    if (get().status === 'running') {
      // 다른 대화가 일하는 중 — 이 대화의 말은 대기열에 두었다가 그 일이 끝나면 이 대화에서 보낸다.
      // (일하는 대화 자체의 말은 입력줄이 끼어들기로 보낸다. 예약 실행은 예전처럼 건너뛴다)
      if (scheduleToken === undefined && get().activeChatId !== get().runChatId)
        await queueInThisChat(text, images, files)
      return
    }
    const seq = get().runSeq + 1
    // 보낸 순간 입력줄에 보이던 AI — 새 대화를 만드는 동안 무엇이 바뀌어도 이 값으로 남긴다
    const engine = get().engine
    const engineChosen = get().engineChosen
    set((s) => ({
      messages: [...s.messages, ...turnPair(text, images, files)],
      runSeq: seq,
      runChatId: s.activeChatId,
      // 앞서 맡겨 둔 다른 대화 화면은 이제 버린다(그 대화는 다시 열면 기록으로 보인다)
      parked: {},
      ...runState('running')
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
          // 새 대화에서 AI 를 직접 골랐으면 그 대화에 먼저 남긴다 — 화면이 이 대화로 넘어가 AI 를
          // 다시 읽기 전에, 그리고 실행 전에(메인이 이 값으로 경로를 고른다)
          if (engineChosen) await window.samba.agent.setChatEngine?.(chatId, engine)
          set((s) => ({
            activeChatId: created.data.id,
            runChatId: created.data.id,
            chats: [created.data, ...s.chats]
          }))
        }
      } finally {
        doneCreating()
      }
    }
    // 메인은 "시작 접수" ack 만 즉시 돌려준다. 완료·실패는 status 이벤트로 온다.
    // 늦게 도착한 이전 세대의 응답은 버린다
    const r = await startRun(text, chatId, scheduleToken, images, files)
    if (!r.ok && get().runSeq === seq) set({ status: 'failed', currentLabel: r.error, retry: null })
  },
  queue: [],
  enqueue: (text, images, files, chatId) =>
    set((s) => ({
      queue: [
        ...s.queue,
        {
          text,
          ...(images && images.length > 0 ? { images } : {}),
          ...(files && files.length > 0 ? { files } : {}),
          ...(chatId === undefined ? {} : { chatId })
        }
      ]
    })),
  unqueue: (index) => set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),
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
    if (id === undefined || get().status !== 'running') return get().enqueue(text, images, files)
    set((s) => ({
      injecting: [
        ...s.injecting,
        {
          id,
          text,
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
        set({ status: 'failed', currentLabel: r?.ok === false ? r.error : '', retry: null })
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
    await window.samba.agent.stop()
  },
  reply: (requestId, approved) => {
    window.samba.agent.confirmReply(requestId, approved)
    set({ confirm: null })
  },
  // 넘김 카드도 확인 카드와 같은 응답 채널을 쓴다(승인=건너뛰고 계속, 거부=작업 중단)
  replyHandoff: (requestId, skip) => {
    window.samba.agent.confirmReply(requestId, skip)
    set({ handoff: null })
    // '작업 중단'은 응답만으로 끝나지 않는다 — 실행 자체를 멈춘다
    if (!skip) void window.samba.agent.stop()
  },
  handleEvent: (e) => {
    // 실행의 말풍선은 그 대화 화면에 쌓는다 — 다른 대화를 보는 중이면 맡겨 둔 화면에
    const target = get().runChatId
    const onScreen = target === null || target === get().activeChatId
    const msgs = onScreen || target === null ? get().messages : (get().parked[target] ?? [])
    const last = msgs[msgs.length - 1]
    const putMsgs = (next: ChatMessage[]): void => {
      if (onScreen || target === null) set({ messages: next })
      else set((s) => ({ parked: { ...s.parked, [target]: next } }))
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
    // 그새 다음 실행이 다른 대화에서 시작됐을 수 있다 — 화면과 맡겨 둔 화면을 다 찾는다
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
    if (e.type === 'step' && last?.role === 'ai') {
      patchLast({ steps: [...(last.steps ?? []), { label: e.label, ok: e.ok }] })
      set((s) => ({ toolCalls: s.toolCalls + 1, currentLabel: e.label, retry: null }))
    }
    if (e.type === 'progress' && e.kind === 'apiRetry')
      set({ retry: { attempt: e.attempt, reason: e.reason } })
    // progress 도구가 알려 준 "n/N" — 화면 위쪽 진행 배지에 그대로 뜬다
    if (e.type === 'progress' && e.kind === 'task')
      set({
        taskProgress:
          e.label === undefined
            ? { done: e.done, total: e.total }
            : { done: e.done, total: e.total, label: e.label }
      })
    // 이번 실행에 적용된 플레이북(이름만 온다)
    if (e.type === 'playbook') set({ playbookNames: e.names })
    if (e.type === 'confirm')
      set({ confirm: { requestId: e.requestId, action: e.action, kind: e.kind ?? 'danger' } })
    if (e.type === 'handoff') {
      set({ handoff: { requestId: e.requestId, kind: e.kind, matched: e.matched, url: e.url } })
      if (last?.role === 'ai') {
        patchLast({
          steps: [...(last.steps ?? []), { label: '', ok: true, key: 'handoff.waiting' }]
        })
      }
    }
    if (e.type === 'handoffDone') {
      // 자동 재개·시간 초과로 끝났을 수도 있으므로 카드를 항상 닫는다
      set({ handoff: null })
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
      // send() 가 실행을 시작할 때 status 를 먼저 running 으로 바꾸므로 정상 시작은 통과한다
      if (e.state === 'running' && get().status !== 'running') return
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
      // 대기 중인 다음 말 — 완료면 맨 앞 것을 이어서 보내고, 중단·실패면 이 대화 몫은 저절로 돌지 않게
      // 입력칸으로 돌려준다(다른 대화 몫은 이 대화의 실패와 상관없으니 이어서 보낸다).
      // AI 가 집어 들지 못하고 끝난 끼어든 말도 이 대화 몫으로 대기열 맨 앞에 돌린다
      const leftover = done ? get().injecting : []
      const all = [...leftover.map(toQueued), ...get().queue]
      const sameChat = (q: QueuedMessage): boolean => (q.chatId ?? target) === target
      const returned = done && e.state !== 'done' ? all.filter(sameChat) : []
      const queue = returned.length > 0 ? all.filter((q) => !sameChat(q)) : all
      const next = done ? queue[0] : undefined
      const prevDraft = get().draftReturn
      const draftParts = [...(prevDraft ? [prevDraft] : []), ...returned]
      set({
        ...(done ? { injecting: [], queue: next ? queue.slice(1) : queue } : {}),
        ...(returned.length > 0
          ? {
              draftReturn: {
                text: draftParts
                  .map((q) => q.text)
                  .filter(Boolean)
                  .join('\n'),
                images: draftParts.flatMap((q) => q.images ?? []),
                files: draftParts.flatMap((q) => q.files ?? []),
                ...(target === null ? {} : { chatId: target })
              }
            }
          : {}),
        status: e.state,
        authError: auth,
        toolCalls: e.toolCalls ?? get().toolCalls,
        retry: e.state === 'running' ? get().retry : null,
        // 중단 후 응답 불가능한 확인·넘김 카드가 남지 않도록 정리
        confirm: done ? null : get().confirm,
        handoff: done ? null : get().handoff
      })
      // 상태가 끝으로 바뀐 뒤에 보낸다(send 는 실행 중이면 받지 않는다). 메인은 앞 실행의 뒷정리를 기다렸다가 시작한다.
      // 그 말의 대화가 지금 화면이면 평소처럼, 아니면 화면은 그대로 두고 뒤에서 보낸다
      if (next) {
        const to = next.chatId ?? target
        if (to === null || to === get().activeChatId)
          void get().send(next.text, undefined, next.images, next.files)
        else void sendInBackground(to, next)
      }
    }
  }
}))

/**
 * 다른 대화가 일하는 중에 보낸 말 — 이 대화 몫으로 대기열에 둔다. 새 대화면 대기열이 찾아올 수 있게
 * 대화 행부터 만든다
 */
async function queueInThisChat(
  text: string,
  images?: AgentImage[],
  files?: AgentFile[]
): Promise<void> {
  const store = useChatStore
  let chatId = store.getState().activeChatId
  if (chatId === null) {
    const doneCreating = beginCreatingChat()
    try {
      const { engine, engineChosen } = store.getState()
      const created = await window.samba.chats?.create(titleFromMessage(text) || text.slice(0, 40))
      if (!created?.ok) return
      chatId = created.data.id
      if (engineChosen) await window.samba.agent.setChatEngine?.(chatId, engine)
      // 그사이 다른 대화를 열지 않았으면 이 새 대화가 화면의 대화다
      if (store.getState().activeChatId === null)
        store.setState((s) => ({
          activeChatId: created.data.id,
          chats: [created.data, ...s.chats]
        }))
      else store.setState((s) => ({ chats: [created.data, ...s.chats] }))
    } finally {
      doneCreating()
    }
  }
  store.getState().enqueue(text, images, files, chatId)
}

/**
 * 앞 일이 끝난 뒤 다른 대화 몫의 대기 말을 보낸다. 그 대화가 화면에 없으면 화면은 그대로 두고,
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
  // 그사이 다른 실행이 시작됐으면 맨 앞에 되돌려 놓는다(그 실행이 끝나면 다시 차례가 온다)
  if (store.getState().status === 'running') {
    store.setState((s) => ({ queue: [{ ...item, chatId }, ...s.queue] }))
    return
  }
  const seq = store.getState().runSeq + 1
  const pair = turnPair(item.text, item.images, item.files)
  store.setState((s) =>
    s.activeChatId === chatId
      ? { messages: [...s.messages, ...pair], parked: {} }
      : { parked: { [chatId]: [...(base ?? []), ...pair] } }
  )
  store.setState({ runSeq: seq, runChatId: chatId, ...runState('running') })
  const r = await startRun(item.text, chatId, undefined, item.images, item.files)
  if (!r.ok && store.getState().runSeq === seq)
    store.setState({ status: 'failed', currentLabel: r.error, retry: null })
}

/** 끼어든 말을 대기열 모양으로(메인이 준 id 는 버린다) */
function toQueued(q: InjectingMessage): QueuedMessage {
  return {
    text: q.text,
    ...(q.images ? { images: q.images } : {}),
    ...(q.files ? { files: q.files } : {})
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
