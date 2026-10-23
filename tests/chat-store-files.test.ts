// 대화 상태 저장소 — 첨부 파일 보내기·대기열·끌어다 놓은 파일
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentRunAck, IpcResult } from '../src/shared/ipc'
import type { AgentFile } from '../src/shared/agent-file'

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run, stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), create: vi.fn() }
    }
  }
})

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

beforeEach(() => {
  run.mockClear()
  useChatStore.setState({ messages: [], status: 'idle', queue: [], activeChatId: 1 })
})

describe('첨부 파일 보내기', () => {
  const files: AgentFile[] = [{ kind: 'text', name: '주문.csv', text: 'a,b' }]

  it('파일은 다섯 번째 인자로 넘기고, 말풍선에는 이름만 단다', async () => {
    await useChatStore.getState().send('합계 내줘', undefined, undefined, files)
    expect(run).toHaveBeenCalledWith('합계 내줘', 1, undefined, undefined, files)
    const user = useChatStore.getState().messages[0]
    expect(user.files).toEqual(['주문.csv'])
  })

  it('일하는 중에 붙인 파일은 대기열에 함께 두었다가 끝나면 같이 보낸다', async () => {
    useChatStore.setState({ status: 'running' })
    useChatStore.getState().enqueue('다음 것도', undefined, files)
    expect(useChatStore.getState().queue).toEqual([{ text: '다음 것도', files }])
    useChatStore.getState().handleEvent({ type: 'status', state: 'done', toolCalls: 0 })
    await new Promise((r) => setTimeout(r, 0))
    expect(run).toHaveBeenCalledWith('다음 것도', 1, undefined, undefined, files)
  })

  it('끌어다 놓은 파일은 입력줄이 한 번만 받아 간다', () => {
    const f = new File(['x'], 'a.txt')
    useChatStore.getState().dropFiles([f])
    expect(useChatStore.getState().takeDropped()).toEqual([f])
    expect(useChatStore.getState().takeDropped()).toBeNull()
  })
})
