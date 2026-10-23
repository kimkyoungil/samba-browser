// 대화 상태 저장소 — 지난 대화 더 보기·검색
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatDto, IpcResult } from '../src/shared/ipc'
import { RECENT_CHAT_LIMIT } from '../src/shared/chat'

const chat = (id: number): ChatDto => ({ id, title: `대화 ${id}`, createdAt: id, updatedAt: id })
const list = vi.fn(async (limit?: number): Promise<IpcResult<ChatDto[]>> => ({
  ok: true,
  data: Array.from({ length: limit ?? 0 }, (_, i) => chat(i + 1))
}))
const search = vi.fn(async (_q: string, _limit?: number): Promise<IpcResult<ChatDto[]>> => ({
  ok: true,
  data: [chat(99)]
}))
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run: vi.fn(), stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list, search, create: vi.fn() }
    }
  }
})

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

beforeEach(() => {
  list.mockClear()
  search.mockClear()
  useChatStore.setState({ chats: [], chatLimit: RECENT_CHAT_LIMIT, chatQuery: '' })
})

describe('지난 대화 — 더 보기·검색', () => {
  it('더 보기는 한 장(RECENT_CHAT_LIMIT)씩 늘려 다시 읽는다', async () => {
    await useChatStore.getState().loadChats()
    expect(list).toHaveBeenLastCalledWith(RECENT_CHAT_LIMIT)
    await useChatStore.getState().moreChats()
    expect(list).toHaveBeenLastCalledWith(RECENT_CHAT_LIMIT * 2)
    expect(useChatStore.getState().chats).toHaveLength(RECENT_CHAT_LIMIT * 2)
  })

  it('검색어가 있으면 검색으로 읽고, 지우면 다시 최근 목록 첫 장', async () => {
    await useChatStore.getState().moreChats()
    await useChatStore.getState().searchChats('쿠팡')
    expect(search).toHaveBeenLastCalledWith('쿠팡', RECENT_CHAT_LIMIT)
    expect(useChatStore.getState().chats.map((c) => c.id)).toEqual([99])
    // 작업이 끝나 목록을 다시 읽을 때도 검색어를 지킨다
    await useChatStore.getState().loadChats()
    expect(search).toHaveBeenCalledTimes(2)
    await useChatStore.getState().searchChats('')
    expect(list).toHaveBeenLastCalledWith(RECENT_CHAT_LIMIT)
  })
})
