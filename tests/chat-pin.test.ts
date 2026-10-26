// 대화 고정 — 고정한 대화는 목록 맨 위(최근 고정 순), 풀면 원래 자리로. 이 PC 에만 남는다
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openDatabase, type Db } from '../src/main/db/client'
import { ChatRepo } from '../src/main/chat/repo'
import type { ChatDto, IpcResult } from '../src/shared/ipc'

describe('대화 고정(ChatRepo)', () => {
  let db: Db
  let repo: ChatRepo
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new ChatRepo(db)
    repo.setWorkspaceScope({ id: 1, isDefault: true })
  })
  afterEach(() => db.close())

  it('고정한 대화를 맨 위에 최근 고정 순으로 두고, 풀면 최근 순 제자리로 돌아간다', () => {
    const a = repo.create('가', 1000)
    const b = repo.create('나', 2000)
    const c = repo.create('다', 3000)
    expect(repo.list().map((x) => x.title)).toEqual(['다', '나', '가'])
    repo.setPinned(a.id, true, 5000)
    repo.setPinned(b.id, true, 6000)
    const list = repo.list()
    expect(list.map((x) => x.title)).toEqual(['나', '가', '다'])
    expect(list.map((x) => x.pinned)).toEqual([true, true, false])
    repo.setPinned(b.id, false)
    expect(repo.list().map((x) => x.title)).toEqual(['가', '다', '나'])
    expect(c.pinned).toBe(false)
  })

  it('고정해도 대화의 수정 시각은 그대로이고, 동기화 변경 로그를 남기지 않는다', () => {
    const outbox: string[] = []
    repo.setOutboxRecorder((table, id, op) => outbox.push(`${table}:${id}:${op}`))
    const a = repo.create('가', 1000)
    outbox.length = 0
    const pinned = repo.setPinned(a.id, true, 9000)
    expect(pinned).toMatchObject({ id: a.id, pinned: true, updatedAt: 1000 })
    expect(repo.list()[0].updatedAt).toBe(1000)
    expect(outbox).toEqual([])
  })

  it('없는 대화·지운 대화는 고정하지 않는다', () => {
    const a = repo.create('가', 1000)
    repo.remove(a.id, 2000)
    expect(repo.setPinned(a.id, true)).toBeNull()
    expect(repo.setPinned(999, true)).toBeNull()
  })
})

describe('대화 고정(화면)', () => {
  it('고정·풀기를 메인에 보내고 목록을 다시 읽는다', async () => {
    const pin = vi.fn(async (): Promise<IpcResult<ChatDto | null>> => ({
      ok: true,
      data: { id: 3, title: '가', createdAt: 1, updatedAt: 1, pinned: true }
    }))
    const list = vi.fn(async (): Promise<IpcResult<ChatDto[]>> => ({
      ok: true,
      data: [{ id: 3, title: '가', createdAt: 1, updatedAt: 1, pinned: true }]
    }))
    Object.assign(globalThis, { window: { samba: { chats: { pin, list } } } })
    const { useChatStore } = await import('../src/renderer/src/stores/chatStore')
    await useChatStore.getState().pinChat(3, true)
    expect(pin).toHaveBeenCalledWith(3, true)
    expect(list).toHaveBeenCalled()
    expect(useChatStore.getState().chats[0].pinned).toBe(true)
  })
})
