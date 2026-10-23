// 일하는 동안 다른 대화 열기·새 대화 — 진행은 일하는 대화 화면에 쌓이고, 다른 대화의 말은 그 대화 몫으로 기다린다
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  AgentRunAck,
  ChatDetailDto,
  ChatDto,
  ChatMessageDto,
  IpcResult
} from '../src/shared/ipc'

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
const row = (
  id: number,
  chatId: number,
  role: 'user' | 'assistant',
  content: string
): ChatMessageDto => ({ id, chatId, role, content, steps: null, createdAt: id, updatedAt: id })
const chat = (id: number, title: string): ChatDto => ({ id, title, createdAt: 1, updatedAt: 1 })
const detail: Record<number, ChatDetailDto> = {
  1: { chat: chat(1, '일하는 대화'), messages: [row(1, 1, 'user', '옛 말 1')] },
  2: {
    chat: chat(2, '다른 대화'),
    messages: [row(5, 2, 'user', '옛 말 2'), row(6, 2, 'assistant', '옛 답 2')]
  },
  3: { chat: chat(3, '셋째 대화'), messages: [] }
}
const get = vi.fn(async (id: number): Promise<IpcResult<ChatDetailDto | null>> => ({
  ok: true,
  data: detail[id] ?? null
}))
const create = vi.fn(async (title: string): Promise<IpcResult<ChatDto>> => ({
  ok: true,
  data: chat(9, title)
}))
const remove = vi.fn(async (): Promise<IpcResult<boolean>> => ({ ok: true, data: true }))
Object.assign(globalThis, {
  window: {
    samba: {
      agent: {
        run,
        stop: vi.fn(),
        confirmReply: vi.fn(),
        onEvent: vi.fn(),
        chatEngine: vi.fn(async () => ({ ok: false }))
      },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), get, create, remove },
      ai: {},
      settings: {}
    }
  }
})

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  run.mockClear()
  get.mockClear()
  create.mockClear()
  remove.mockClear()
  // 대화 1 에서 일하는 중
  useChatStore.setState({
    activeChatId: 1,
    runChatId: 1,
    parked: {},
    status: 'running',
    queue: [],
    injecting: [],
    draftReturn: null,
    chats: [chat(1, '일하는 대화'), chat(2, '다른 대화')],
    messages: [
      { id: 'u', role: 'user', text: '일해' },
      { id: 'a', role: 'ai', text: '', partial: '쓰는 중', steps: [] }
    ]
  })
})

describe('일하는 동안 다른 대화 보기', () => {
  it('다른 대화를 열어도 일은 계속되고, 진행은 일하는 대화 화면에 쌓였다가 돌아오면 그대로 보인다', async () => {
    await useChatStore.getState().openChat(2)
    let s = useChatStore.getState()
    expect(s.activeChatId).toBe(2)
    expect(s.status).toBe('running')
    expect(s.messages.map((m) => m.text)).toEqual(['옛 말 2', '옛 답 2'])
    // 실행 이벤트는 대화 1 화면(맡겨 둔 것)으로 간다
    s.handleEvent({ type: 'thinking', text: '생각' })
    s.handleEvent({ type: 'step', label: '탭 열기', ok: true })
    s.handleEvent({ type: 'text', text: '다 했어요' })
    s = useChatStore.getState()
    expect(s.messages.map((m) => m.text)).toEqual(['옛 말 2', '옛 답 2'])
    expect(s.parked[1].at(-1)).toMatchObject({ text: '다 했어요', thinking: '생각' })
    expect(s.toolCalls).toBe(1)
    // 돌아오면 기록 대신 맡겨 둔 화면을 쓴다
    get.mockClear()
    await useChatStore.getState().openChat(1)
    s = useChatStore.getState()
    expect(get).not.toHaveBeenCalled()
    expect(s.messages.at(-1)).toMatchObject({ text: '다 했어요', thinking: '생각' })
    expect(s.parked).toEqual({})
  })

  it('새 대화도 열 수 있고, 일하는 대화를 다시 누르면 화면을 기록으로 덮지 않는다', async () => {
    await useChatStore.getState().openChat(1)
    expect(get).not.toHaveBeenCalled()
    useChatStore.getState().newChat()
    const s = useChatStore.getState()
    expect(s.activeChatId).toBeNull()
    expect(s.messages).toEqual([])
    expect(s.status).toBe('running')
    expect(s.parked[1]).toHaveLength(2)
  })

  it('일하는 대화는 지우지 않는다', async () => {
    await useChatStore.getState().removeChat(1)
    expect(remove).not.toHaveBeenCalled()
  })

  it('기록 줄 번호는 맡겨 둔 화면의 말에도 단다', async () => {
    useChatStore.getState().handleEvent({ type: 'turn', turnId: 'T1' })
    await useChatStore.getState().openChat(2)
    useChatStore.getState().handleEvent({ type: 'saved', turnId: 'T1', rowId: 77 })
    expect(useChatStore.getState().parked[1][0].rowId).toBe(77)
  })
})

describe('다른 대화에서 보낸 말', () => {
  it('그 대화 몫으로 기다렸다가, 앞 일이 끝나면 그 대화에서 보낸다', async () => {
    await useChatStore.getState().openChat(2)
    await useChatStore.getState().send('둘째 대화 질문')
    expect(run).not.toHaveBeenCalled()
    expect(useChatStore.getState().queue).toEqual([{ text: '둘째 대화 질문', chatId: 2 }])
    useChatStore.getState().handleEvent({ type: 'status', state: 'done', toolCalls: 0 })
    await tick()
    expect(run).toHaveBeenCalledWith('둘째 대화 질문', 2)
    const s = useChatStore.getState()
    expect(s.runChatId).toBe(2)
    expect(s.messages.map((m) => m.text)).toEqual(['옛 말 2', '옛 답 2', '둘째 대화 질문', ''])
  })

  it('새 대화에서 보내면 대화 행부터 만들어 그 대화 몫으로 둔다', async () => {
    useChatStore.getState().newChat()
    await useChatStore.getState().send('새 대화 질문')
    expect(create).toHaveBeenCalledTimes(1)
    const s = useChatStore.getState()
    expect(s.activeChatId).toBe(9)
    expect(s.queue).toEqual([{ text: '새 대화 질문', chatId: 9 }])
  })

  it('그 대화가 화면에 없으면 화면은 그대로 두고 뒤에서 보낸다(그 대화 화면은 기록 + 새 말)', async () => {
    await useChatStore.getState().openChat(2)
    await useChatStore.getState().send('둘째 대화 질문')
    await useChatStore.getState().openChat(3)
    useChatStore.getState().handleEvent({ type: 'status', state: 'done', toolCalls: 0 })
    for (let i = 0; i < 5; i++) await tick()
    expect(run).toHaveBeenCalledWith('둘째 대화 질문', 2)
    const s = useChatStore.getState()
    expect(s.activeChatId).toBe(3)
    expect(s.messages).toEqual([])
    expect(s.runChatId).toBe(2)
    expect(s.parked[2].map((m) => m.text)).toEqual(['옛 말 2', '옛 답 2', '둘째 대화 질문', ''])
    // 진행은 그 대화 화면에 쌓인다
    s.handleEvent({ type: 'text', text: '둘째 답' })
    expect(useChatStore.getState().parked[2].at(-1)?.text).toBe('둘째 답')
  })

  it('앞 일이 실패하면 그 대화 몫만 입력칸으로 돌려주고, 다른 대화 몫은 이어서 보낸다', async () => {
    useChatStore.setState({
      queue: [{ text: '같은 대화 다음 말' }, { text: '다른 대화 말', chatId: 2 }]
    })
    useChatStore.getState().handleEvent({ type: 'status', state: 'failed', message: '오류' })
    for (let i = 0; i < 5; i++) await tick()
    const s = useChatStore.getState()
    expect(s.draftReturn).toMatchObject({ text: '같은 대화 다음 말', chatId: 1 })
    expect(run).toHaveBeenCalledWith('다른 대화 말', 2)
    expect(s.queue).toEqual([])
  })

  it('돌려준 글은 그 대화를 열었을 때만 입력칸이 받아 간다', async () => {
    useChatStore.setState({ status: 'failed', draftReturn: { text: '돌려받을 글', chatId: 1 } })
    await useChatStore.getState().openChat(2)
    expect(useChatStore.getState().takeDraftReturn()).toBeNull()
    await useChatStore.getState().openChat(1)
    expect(useChatStore.getState().takeDraftReturn()?.text).toBe('돌려받을 글')
  })
})
