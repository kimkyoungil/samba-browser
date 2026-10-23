import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentEvent, AgentRunAck, IpcResult } from '../src/shared/ipc'

// 렌더러 전역 window.samba 스텁(chat-store.test.ts 와 같은 방식)
const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (_prompt: string): Promise<IpcResult<AgentRunAck>> => ack)
const stop = vi.fn(async (): Promise<IpcResult<void>> => ({ ok: true, data: undefined }))
const win = { samba: { agent: { run, stop, confirmReply: vi.fn(), onEvent: vi.fn() } } }
Object.assign(globalThis, { window: win })

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

const fire = (e: AgentEvent): void => useChatStore.getState().handleEvent(e)
const lastMessage = (): ReturnType<typeof useChatStore.getState>['messages'][number] => {
  const msgs = useChatStore.getState().messages
  return msgs[msgs.length - 1]
}

describe('chatStore — 글자 단위 답과 대기열', () => {
  beforeEach(() => {
    run.mockReset()
    run.mockImplementation(async () => ack)
    useChatStore.setState({
      messages: [],
      runSeq: 0,
      status: 'idle',
      toolCalls: 0,
      currentLabel: '',
      retry: null,
      confirm: null,
      authError: null,
      queue: [],
      draftReturn: null
    })
  })

  it('쓰는 중 글을 보여 주고, 확정 글이 오면 바꿔 단다', async () => {
    await useChatStore.getState().send('인사해')
    fire({ type: 'partial', text: '안녕' })
    expect(lastMessage().partial).toBe('안녕')
    fire({ type: 'partial', text: '' })
    fire({ type: 'text', text: '안녕하세요' })
    expect(lastMessage().text).toBe('안녕하세요')
    expect(lastMessage().partial).toBeFalsy()
  })

  it('중단되면 쓰던 데까지를 화면 글로 남긴다', async () => {
    await useChatStore.getState().send('길게 써')
    fire({ type: 'text', text: '첫 문단' })
    fire({ type: 'partial', text: '쓰다 만' })
    fire({ type: 'status', state: 'stopped' })
    expect(lastMessage().text).toBe('첫 문단\n쓰다 만')
    expect(lastMessage().partial).toBeUndefined()
  })

  it('완료되면 대기열 맨 앞 말을 이어서 보낸다', async () => {
    await useChatStore.getState().send('첫 작업')
    run.mockClear()
    useChatStore.getState().enqueue('다음 작업')
    useChatStore.getState().enqueue('그다음 작업')
    fire({ type: 'status', state: 'done' })
    // send 는 대화 행을 만드는 await 를 한 번 거친 뒤 run 을 부른다
    await new Promise((r) => setTimeout(r, 0))
    expect(run).toHaveBeenCalledWith('다음 작업')
    expect(useChatStore.getState().queue.map((q) => q.text)).toEqual(['그다음 작업'])
    expect(useChatStore.getState().status).toBe('running')
  })

  it('중단·실패면 저절로 보내지 않고 입력칸으로 돌려준다', async () => {
    await useChatStore.getState().send('첫 작업')
    run.mockClear()
    useChatStore.getState().enqueue('하나')
    useChatStore.getState().enqueue('둘')
    fire({ type: 'status', state: 'stopped' })
    expect(run).not.toHaveBeenCalled()
    expect(useChatStore.getState().queue).toEqual([])
    expect(useChatStore.getState().draftReturn?.text).toBe('하나\n둘')
    // 입력칸이 받아 가면 비워진다
    expect(useChatStore.getState().takeDraftReturn()?.text).toBe('하나\n둘')
    expect(useChatStore.getState().draftReturn).toBeNull()
  })

  it('대기 취소는 그 줄만 뺀다', () => {
    useChatStore.getState().enqueue('가')
    useChatStore.getState().enqueue('나')
    useChatStore.getState().unqueue(0)
    expect(useChatStore.getState().queue.map((q) => q.text)).toEqual(['나'])
  })
})
