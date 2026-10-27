// 화면 — 대화의 코드 작업 폴더 고르기·끄기. 새 대화에서 골라 두면 대화가 만들어질 때 붙는다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentRunAck, IpcResult } from '../src/shared/ipc'

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
const pickCodeFolder = vi.fn(async (): Promise<IpcResult<string | null>> => ({
  ok: true,
  data: 'C:\\work\\shop'
}))
const setCodeFolder = vi.fn(async (..._a: unknown[]) => ({ ok: true, data: undefined }))
const setPcLock = vi.fn(async (..._a: unknown[]) => ({ ok: true, data: undefined }))
const pcLock = vi.fn(async (): Promise<IpcResult<boolean>> => ({ ok: true, data: false }))
const codeFolder = vi.fn(async (): Promise<IpcResult<string | null>> => ({ ok: true, data: null }))
const create = vi.fn(async () => ({
  ok: true,
  data: { id: 42, title: '새 대화', createdAt: 1, updatedAt: 1 }
}))
Object.assign(globalThis, {
  window: {
    samba: {
      agent: {
        run,
        stop: vi.fn(),
        confirmReply: vi.fn(),
        onEvent: vi.fn(),
        pickCodeFolder,
        setCodeFolder,
        codeFolder,
        setPcLock,
        pcLock
      },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), create }
    }
  }
})

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

beforeEach(() => {
  vi.clearAllMocks()
  useChatStore.setState({
    status: 'idle',
    activeChatId: null,
    runChatId: null,
    messages: [],
    queue: [],
    codeFolder: null,
    codeFolderError: null,
    pcLocked: false
  })
})

describe('코드 작업 폴더', () => {
  it('저장된 대화에서 고르면 그 대화에 바로 붙인다', async () => {
    useChatStore.setState({ activeChatId: 7 })
    await useChatStore.getState().pickCodeFolder()
    expect(setCodeFolder).toHaveBeenCalledWith(7, 'C:\\work\\shop')
    expect(useChatStore.getState().codeFolder).toBe('C:\\work\\shop')
  })

  it('새 대화에서 골라 두면 첫 말을 보낼 때 만든 대화에 실행 전에 붙인다', async () => {
    await useChatStore.getState().pickCodeFolder()
    expect(setCodeFolder).not.toHaveBeenCalled()
    await useChatStore.getState().send('테스트 고쳐줘')
    expect(setCodeFolder).toHaveBeenCalledWith(42, 'C:\\work\\shop')
    expect(setCodeFolder.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0])
  })

  it('고를 수 없는 폴더면 까닭을 보여 주고 폴더는 그대로 둔다', async () => {
    pickCodeFolder.mockResolvedValueOnce({ ok: false, error: '드라이브 맨 위는 고를 수 없어요' })
    await useChatStore.getState().pickCodeFolder()
    expect(useChatStore.getState().codeFolder).toBeNull()
    expect(useChatStore.getState().codeFolderError).toBe('드라이브 맨 위는 고를 수 없어요')
  })

  it('끄면 대화에서 떼고, 일하는 대화는 바꾸지 않는다', async () => {
    useChatStore.setState({ activeChatId: 7, codeFolder: 'C:\\work\\shop' })
    await useChatStore.getState().clearCodeFolder()
    expect(setCodeFolder).toHaveBeenCalledWith(7, null)
    expect(useChatStore.getState().codeFolder).toBeNull()

    vi.clearAllMocks()
    useChatStore.setState({ activeChatId: 7, runChatId: 7, status: 'running' })
    await useChatStore.getState().pickCodeFolder()
    expect(pickCodeFolder).not.toHaveBeenCalled()
  })

  it('새 대화로 가면 앞 대화의 폴더를 이어 쓰지 않는다', () => {
    useChatStore.setState({ activeChatId: 7, codeFolder: 'C:\\work\\shop' })
    useChatStore.getState().newChat()
    expect(useChatStore.getState().codeFolder).toBeNull()
  })

  it('PC 잠금: 켜면 대화에 남기고 코드 폴더는 떨어지며, 폴더를 고르면 잠금이 풀린다', async () => {
    useChatStore.setState({ activeChatId: 7, codeFolder: 'D:/work/shop' })
    await useChatStore.getState().setPcLock(true)
    expect(setPcLock).toHaveBeenCalledWith(7, true)
    expect(useChatStore.getState()).toMatchObject({ pcLocked: true, codeFolder: null })
    await useChatStore.getState().pickCodeFolder()
    expect(useChatStore.getState()).toMatchObject({
      pcLocked: false,
      codeFolder: (await pickCodeFolder()).data
    })
  })

  it('PC 잠금: 새 대화에서 켜 두면 첫 말을 보낼 때 만든 대화에 실행 전에 붙인다', async () => {
    await useChatStore.getState().setPcLock(true)
    expect(setPcLock).not.toHaveBeenCalled()
    await useChatStore.getState().send('이 페이지 요약해줘')
    expect(setPcLock).toHaveBeenCalledWith(42, true)
    expect(setPcLock.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0])
  })

  it('대화를 열면 그 대화의 잠금 상태를 읽어 온다', async () => {
    pcLock.mockResolvedValueOnce({ ok: true, data: true })
    useChatStore.setState({ activeChatId: 8 })
    await useChatStore.getState().loadCodeFolder()
    expect(useChatStore.getState().pcLocked).toBe(true)
  })
})
