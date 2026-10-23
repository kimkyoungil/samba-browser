import { create } from 'zustand'
import type { AgentEvent, ChatDto, ChatMessageDto, HandoffKind } from '@shared/ipc'
import { RECENT_CHAT_LIMIT, titleFromMessage } from '@shared/chat'
import { agentImageDataUrl, type AgentImage } from '@shared/agent-image'
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
}

// 일하는 중에 보낸 다음 말. 지금 작업이 끝나면 차례로 보낸다
export interface QueuedMessage {
  text: string
  images?: AgentImage[]
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
  authError: 'missing' | 'limit' | null
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
  // 저장된 대화를 열어 메시지를 화면에 올린다
  openChat: (chatId: number) => Promise<void>
  // 화면을 비우고 새 대화를 시작한다(대화 행은 첫 전송 때 만들어진다)
  newChat: () => void
  // 대화를 지운다(삭제 표식). 화면에 열려 있었으면 새 대화로 돌아간다
  removeChat: (chatId: number) => Promise<void>
  /** scheduleToken 은 예약이 보낸 실행임을 메인에 알리는 표식이다(사용자 입력에는 없다) */
  send: (text: string, scheduleToken?: string, images?: AgentImage[]) => Promise<void>
  // 일하는 중에 보낸 말. 완료되면 맨 앞부터 하나씩 보내고, 중단·실패면 draftReturn 으로 입력칸에 돌려준다
  queue: QueuedMessage[]
  enqueue: (text: string, images?: AgentImage[]) => void
  unqueue: (index: number) => void
  // 중단·실패로 못 보낸 대기 글. 입력칸이 takeDraftReturn 으로 받아 간다
  draftReturn: QueuedMessage | null
  takeDraftReturn: () => QueuedMessage | null
  stop: () => Promise<void>
  reply: (requestId: string, approved: boolean) => void
  // 넘김 카드 응답 — skip=true 는 건너뛰고 계속, false 는 작업 중단
  replyHandoff: (requestId: string, skip: boolean) => void
  handleEvent: (e: AgentEvent) => void
}

let seq = 0
const nid = (): string => String(++seq)

// 진행 로그(step)는 마지막 AI 메시지에 붙인다
export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  chats: [],
  activeChatId: null,
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
    if (get().status === 'running') return
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
    const r = await window.samba.chats?.list(RECENT_CHAT_LIMIT)
    if (r?.ok) set({ chats: r.data })
  },
  openChat: async (chatId) => {
    if (get().status === 'running') return
    const r = await window.samba.chats?.get(chatId)
    if (!r?.ok || r.data === null) return
    set({
      activeChatId: chatId,
      messages: r.data.messages.map(toChatMessage),
      status: 'idle',
      toolCalls: 0,
      currentLabel: '',
      retry: null,
      playbookNames: [],
      taskProgress: null,
      confirm: null,
      handoff: null,
      authError: null
    })
    // 이 대화에서 고른 AI 와 그 모델로 입력줄을 맞춘다
    void get().loadEngine()
  },
  newChat: () => {
    if (get().status === 'running') return
    set({
      activeChatId: null,
      messages: [],
      status: 'idle',
      toolCalls: 0,
      currentLabel: '',
      retry: null,
      playbookNames: [],
      taskProgress: null,
      confirm: null,
      handoff: null,
      authError: null
    })
  },
  removeChat: async (chatId) => {
    const r = await window.samba.chats?.remove(chatId)
    if (!r?.ok) return
    set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId) }))
    if (get().activeChatId === chatId) get().newChat()
  },
  send: async (text, scheduleToken, images) => {
    if (get().status === 'running') return
    const seq = get().runSeq + 1
    // 보낸 순간 입력줄에 보이던 AI — 새 대화를 만드는 동안 무엇이 바뀌어도 이 값으로 남긴다
    const engine = get().engine
    const engineChosen = get().engineChosen
    const previews = images && images.length > 0 ? images.map(agentImageDataUrl) : undefined
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nid(), role: 'user', text, ...(previews ? { images: previews } : {}) },
        { id: nid(), role: 'ai', text: '', steps: [] }
      ],
      runSeq: seq,
      status: 'running',
      toolCalls: 0,
      currentLabel: '',
      retry: null,
      playbookNames: [],
      taskProgress: null,
      confirm: null,
      handoff: null,
      authError: null
    }))
    // 아직 저장되지 않은 새 대화면 여기서 대화 행을 만든다(제목은 첫 메시지에서 짓는다).
    // 저장은 메인(러너)이 작업 완료 시점에 한 번에 한다
    let chatId = get().activeChatId
    if (chatId === null) {
      const created = await window.samba.chats?.create(titleFromMessage(text) || text.slice(0, 40))
      if (created?.ok) {
        chatId = created.data.id
        // 새 대화에서 AI 를 직접 골랐으면 그 대화에 먼저 남긴다 — 화면이 이 대화로 넘어가 AI 를
        // 다시 읽기 전에, 그리고 실행 전에(메인이 이 값으로 경로를 고른다)
        if (engineChosen) await window.samba.agent.setChatEngine?.(chatId, engine)
        set((s) => ({ activeChatId: created.data.id, chats: [created.data, ...s.chats] }))
      }
    }
    // 메인은 "시작 접수" ack 만 즉시 돌려준다. 완료·실패는 status 이벤트로 온다.
    // 늦게 도착한 이전 세대의 응답은 버린다
    // 예약 실행이 아니면 인자를 덧붙이지 않는다(평소 경로의 호출 모양을 그대로 둔다)
    const args: [string, number?, string?] =
      scheduleToken === undefined
        ? chatId === null
          ? [text]
          : [text, chatId]
        : [text, chatId ?? undefined, scheduleToken]
    // 이미지가 있을 때만 네 번째 인자를 붙인다(평소 경로의 호출 모양을 그대로 둔다)
    const r =
      images && images.length > 0
        ? await window.samba.agent.run(text, chatId ?? undefined, scheduleToken, images)
        : await window.samba.agent.run(...args)
    if (!r.ok && get().runSeq === seq) set({ status: 'failed', currentLabel: r.error, retry: null })
  },
  queue: [],
  enqueue: (text, images) =>
    set((s) => ({
      queue: [...s.queue, images && images.length > 0 ? { text, images } : { text }]
    })),
  unqueue: (index) => set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),
  draftReturn: null,
  takeDraftReturn: () => {
    const d = get().draftReturn
    if (d) set({ draftReturn: null })
    return d
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
    const msgs = get().messages
    const last = msgs[msgs.length - 1]
    const patchLast = (p: Partial<ChatMessage>): void =>
      set({ messages: [...msgs.slice(0, -1), { ...last, ...p }] })
    if (e.type === 'text' && last?.role === 'ai')
      patchLast({ text: last.text ? `${last.text}\n${e.text}` : e.text, partial: undefined })
    if (e.type === 'partial' && last?.role === 'ai') patchLast({ partial: e.text })
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
        ? (e.message.slice(5) as 'missing' | 'limit')
        : null
      const done = e.state === 'done' || e.state === 'failed' || e.state === 'stopped'
      // 작업이 끝나면 메인이 방금 기록을 남겼다 — 목록의 제목·순서를 다시 읽는다
      if (done) void get().loadChats()
      // 중단·실패로 끊긴 '쓰는 중' 글은 그때까지 쓴 대로 화면에 남긴다(기록에는 확정 글만 있다)
      const messages =
        done && last?.role === 'ai' && last.partial
          ? [
              ...msgs.slice(0, -1),
              {
                ...last,
                text: last.text ? `${last.text}\n${last.partial}` : last.partial,
                partial: undefined
              }
            ]
          : get().messages
      // 대기 중인 다음 말 — 완료면 맨 앞 것을 이어서 보내고, 중단·실패면 저절로 돌지 않게 입력칸으로 돌려준다
      const queue = get().queue
      const next = done && e.state === 'done' ? queue[0] : undefined
      const returned = done && e.state !== 'done' && queue.length > 0 ? queue : []
      const prevDraft = get().draftReturn
      const draftParts = [...(prevDraft ? [prevDraft] : []), ...returned]
      set({
        messages,
        ...(next ? { queue: queue.slice(1) } : {}),
        ...(returned.length > 0
          ? {
              queue: [],
              draftReturn: {
                text: draftParts
                  .map((q) => q.text)
                  .filter(Boolean)
                  .join('\n'),
                images: draftParts.flatMap((q) => q.images ?? [])
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
      // 상태가 끝으로 바뀐 뒤에 보낸다(send 는 실행 중이면 받지 않는다). 메인은 앞 실행의 뒷정리를 기다렸다가 시작한다
      if (next) void get().send(next.text, undefined, next.images)
    }
  }
}))

/** 저장된 메시지 한 줄을 화면 메시지로 바꾼다(system 은 AI 말풍선으로 보여 준다) */
function toChatMessage(row: ChatMessageDto): ChatMessage {
  return {
    id: `db-${row.id}`,
    role: row.role === 'user' ? 'user' : 'ai',
    text: row.content,
    steps: row.steps ?? undefined
  }
}
