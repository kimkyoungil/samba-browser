// [지금 보내기] — 대기열의 말을 하던 일에 바로 끼워 넣고, 못 끼우면 멈춘 뒤 그 말을 먼저 보낸다
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentRunAck, IpcResult } from '../src/shared/ipc'

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
const stop = vi.fn(async () => ({ ok: true, data: undefined }))
const inject = vi.fn(
  async (..._args: unknown[]): Promise<IpcResult<{ injected: boolean; id?: string }>> => ({
    ok: true,
    data: { injected: true, id: 'J9' }
  })
)
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run, inject, stop, confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), create: vi.fn() }
    }
  }
})

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  run.mockClear()
  stop.mockClear()
  inject.mockClear()
  useChatStore.setState({
    status: 'running',
    activeChatId: 5,
    runChatId: 5,
    injecting: [],
    sendNowItem: null,
    draftReturn: null,
    queue: [{ text: '먼저 보낼 말' }, { text: '그다음 말' }],
    messages: [
      { id: 'u', role: 'user', text: '일해' },
      { id: 'a', role: 'ai', text: '', steps: [] }
    ]
  })
})

describe('지금 보내기', () => {
  it('Claude 실행이면 하던 일에 바로 끼워 넣는다(대기열에서 빠지고 곧 전달로)', async () => {
    await useChatStore.getState().sendNow(0)
    expect(inject).toHaveBeenCalledWith('먼저 보낼 말', 5, undefined, undefined)
    const s = useChatStore.getState()
    expect(s.queue).toEqual([{ text: '그다음 말' }])
    expect(s.injecting).toEqual([{ text: '먼저 보낼 말', id: 'J9' }])
    expect(stop).not.toHaveBeenCalled()
  })

  it('끼워 넣을 수 없으면(Codex) 하던 일을 멈추고 그 말을 먼저 보낸다 — 남은 대기열은 그대로', async () => {
    inject.mockResolvedValueOnce({ ok: true, data: { injected: false } })
    await useChatStore.getState().sendNow(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sendNowItem).toEqual({ text: '먼저 보낼 말' })
    useChatStore.getState().handleEvent({ type: 'status', state: 'stopped' })
    await tick()
    expect(run).toHaveBeenCalledWith('먼저 보낼 말', 5)
    const s = useChatStore.getState()
    // 멈춤이라도 남은 말을 입력칸으로 돌려주지 않는다
    expect(s.draftReturn).toBeNull()
    expect(s.queue).toEqual([{ text: '그다음 말' }])
    expect(s.sendNowItem).toBeNull()
  })

  it('/compact 는 끼워 넣지 않고 멈춘 뒤 보낸다', async () => {
    useChatStore.setState({ queue: [{ text: '/compact' }] })
    await useChatStore.getState().sendNow(0)
    expect(inject).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('다른 대화 몫의 말은 그 대화의 일을 멈추지 않는다', async () => {
    useChatStore.setState({ queue: [{ text: '다른 대화 말', chatId: 9 }] })
    await useChatStore.getState().sendNow(0)
    expect(inject).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(useChatStore.getState().queue).toHaveLength(1)
  })

  it('그새 일이 끝났으면 아무것도 하지 않는다(대기열이 알아서 보낸다)', async () => {
    useChatStore.setState({ status: 'done' })
    await useChatStore.getState().sendNow(0)
    expect(inject).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })
})
