// 보낸 말 고쳐 다시 보내기·답 다시 받기 — 기록 자르기, 실행 꼬리표·줄 번호, 화면 동작
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentEvent, AgentRunAck, IpcResult } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { AgentImage } from '../src/shared/agent-image'
import { openDatabase, type Db } from '../src/main/db/client'
import { ChatRepo } from '../src/main/chat/repo'

let closeDelay = 0
vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: () =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        yield { type: 'result', subtype: 'success', is_error: false, result: '네', modelUsage: {} }
        // 끝 상태를 보낸 뒤 스트림이 닫히기까지의 틈(뒷정리 중)
        await new Promise((r) => setTimeout(r, closeDelay))
      })()
  }
})
vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
const truncate = vi.fn(async (..._args: unknown[]): Promise<IpcResult<number>> => ({
  ok: true,
  data: 2
}))
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run, stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), create: vi.fn(), truncate }
    }
  }
})

const { AgentRunner } = await import('../src/main/agent/runner')
const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

describe('기록 자르기(ChatRepo.truncateFrom)', () => {
  let db: Db
  let repo: ChatRepo
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new ChatRepo(db)
    repo.setWorkspaceScope({ id: 1, isDefault: true })
  })
  afterEach(() => db.close())

  it('고른 줄부터 시간순 끝까지 지우고, 지운 줄마다 변경 로그를 남긴다', () => {
    const outbox: string[] = []
    repo.setOutboxRecorder((table, id, op) => outbox.push(`${table}:${id}:${op}`))
    const chat = repo.create('대화', 1000)
    const u1 = repo.append({ chatId: chat.id, role: 'user', content: '첫 말' }, 1100)
    repo.append({ chatId: chat.id, role: 'assistant', content: '첫 답' }, 1200)
    const u2 = repo.append({ chatId: chat.id, role: 'user', content: '둘째 말' }, 1300)
    const a2 = repo.append({ chatId: chat.id, role: 'assistant', content: '둘째 답' }, 1400)
    outbox.length = 0
    expect(repo.truncateFrom(chat.id, u2!.id, 2000)).toBe(2)
    expect(repo.messages(chat.id).map((m) => m.content)).toEqual(['첫 말', '첫 답'])
    expect(outbox).toEqual([
      `chat_messages:${u2!.id}:delete`,
      `chat_messages:${a2!.id}:delete`,
      `chats:${chat.id}:upsert`
    ])
    // 지운 대화 검색에도 안 걸린다
    expect(repo.search('둘째')).toEqual([])
    expect(u1).not.toBeNull()
  })

  it('없는 줄·다른 대화의 줄·지운 대화는 아무것도 안 지운다', () => {
    const a = repo.create('가', 1000)
    const b = repo.create('나', 1000)
    const inB = repo.append({ chatId: b.id, role: 'user', content: '말' }, 1100)
    expect(repo.truncateFrom(a.id, inB!.id)).toBe(0)
    expect(repo.truncateFrom(b.id, 999_999)).toBe(0)
    repo.remove(b.id, 2000)
    expect(repo.truncateFrom(b.id, inB!.id)).toBe(0)
  })
})

describe('실행 꼬리표와 기록 줄 번호(러너)', () => {
  function makeRunner(): { runner: InstanceType<typeof AgentRunner>; events: AgentEvent[] } {
    const events: AgentEvent[] = []
    const settings = {
      get: () => ({
        model: 'sonnet',
        language: 'ko',
        panelWidth: 380,
        lastUrl: '',
        dangerWords: [],
        maxToolCalls: 40,
        agentEffort: 'medium'
      })
    }
    const runner = new AgentRunner(
      {} as unknown as TabManager,
      settings as unknown as SettingsStore,
      (e) => events.push(e)
    )
    runner.setEngineRouting(() => ({
      engine: 'claude',
      auth: { mode: 'claude_subscription' },
      model: 'claude-sonnet-5-5'
    }))
    return { runner, events }
  }

  it('시작할 때 꼬리표를 알리고, 기록을 남긴 뒤 같은 꼬리표로 사용자 말 줄 번호를 알린다', async () => {
    const { runner, events } = makeRunner()
    let row = 40
    runner.setTranscript(() => ({ userRowId: ++row }))
    await runner.run('첫 말', 7)
    await runner.run('둘째 말', 7)
    const turns = events.flatMap((e) => (e.type === 'turn' ? [e.turnId] : []))
    expect(turns).toHaveLength(2)
    expect(turns[0]).not.toBe(turns[1])
    expect(events.filter((e) => e.type === 'saved')).toEqual([
      { type: 'saved', turnId: turns[0], rowId: 41 },
      { type: 'saved', turnId: turns[1], rowId: 42 }
    ])
  })

  it('이어 돌기는 앞 실행의 꼬리표를 물려받는다(한 번만)', async () => {
    const { runner, events } = makeRunner()
    ;(runner as unknown as { inheritTurnId: string | null }).inheritTurnId = '앞-꼬리표'
    await runner.run('이어서', 7)
    await runner.run('새 말', 7)
    const turns = events.flatMap((e) => (e.type === 'turn' ? [e.turnId] : []))
    expect(turns[0]).toBe('앞-꼬리표')
    expect(turns[1]).not.toBe('앞-꼬리표')
  })

  it('끝 상태 직후 뒷정리 중이면 기다렸다가 자를 수 있다고 답한다', async () => {
    const { runner, events } = makeRunner()
    runner.setTranscript(() => ({ userRowId: 1 }))
    closeDelay = 40
    const first = runner.run('말', 7)
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'status' && e.state === 'done'); i++)
      await new Promise((r) => setTimeout(r, 2))
    // 화면은 끝났다고 보지만 메인은 아직 뒷정리 중이다
    expect(runner.hasActiveRun()).toBe(true)
    await expect(runner.waitRunSettled()).resolves.toBe(false)
    expect(events.some((e) => e.type === 'saved')).toBe(true)
    await first
    closeDelay = 0
  })

  it('기록 줄 번호를 못 받으면(대화 없음) 알리지 않는다', async () => {
    const { runner, events } = makeRunner()
    runner.setTranscript(() => null)
    await runner.run('말', 7)
    expect(events.some((e) => e.type === 'saved')).toBe(false)
  })
})

describe('화면 — 고쳐 보내기·다시 받기', () => {
  const img: AgentImage = { mediaType: 'image/png', data: 'aGk=' }
  beforeEach(() => {
    run.mockClear()
    truncate.mockClear()
    useChatStore.setState({
      activeChatId: 3,
      status: 'idle',
      queue: [],
      messages: [
        { id: 'db-10', role: 'user', text: '첫 말', rowId: 10 },
        { id: 'db-11', role: 'ai', text: '첫 답', rowId: 11 },
        { id: 'u2', role: 'user', text: '둘째 말', sent: { images: [img] } },
        { id: 'a2', role: 'ai', text: '둘째 답' }
      ]
    })
  })

  it('실행 꼬리표는 방금 보낸 말에, 줄 번호는 꼬리표가 같은 말에 단다', () => {
    const { handleEvent } = useChatStore.getState()
    handleEvent({ type: 'turn', turnId: 'T2' })
    // 이어 돌기의 같은 꼬리표·다른 꼬리표는 덮지 않는다
    handleEvent({ type: 'turn', turnId: 'T9' })
    expect(useChatStore.getState().messages[2].turnId).toBe('T2')
    handleEvent({ type: 'saved', turnId: 'T2', rowId: 12 })
    handleEvent({ type: 'saved', turnId: 'T2', rowId: 14 })
    expect(useChatStore.getState().messages[2].rowId).toBe(12)
  })

  it('고쳐 보내면 그 말부터 기록을 지우고, 화면도 잘라 고친 글과 원래 첨부로 다시 보낸다', async () => {
    useChatStore.getState().handleEvent({ type: 'saved', turnId: 'x', rowId: 99 })
    useChatStore.setState((s) => ({
      messages: s.messages.map((m) => (m.id === 'u2' ? { ...m, rowId: 12 } : m))
    }))
    await useChatStore.getState().resend('u2', '고친 둘째 말')
    expect(truncate).toHaveBeenCalledWith(3, 12)
    expect(run).toHaveBeenCalledWith('고친 둘째 말', 3, undefined, [img])
    const texts = useChatStore.getState().messages.map((m) => m.text)
    expect(texts).toEqual(['첫 말', '첫 답', '고친 둘째 말', ''])
  })

  it('고친 말이 아직 기록 전이면 그 뒤에서 처음 남은 줄부터 지운다', async () => {
    await useChatStore.getState().resend('db-10', '고친 첫 말')
    expect(truncate).toHaveBeenCalledWith(3, 10)
    truncate.mockClear()
    // 앞의 다시 보내기가 '일하는 중'으로 바꿔 두었다 — 끝난 것으로 돌린다
    useChatStore.setState({
      status: 'idle',
      messages: [
        { id: 'u1', role: 'user', text: '기록 전' },
        { id: 'a1', role: 'ai', text: '', rowId: 30 }
      ]
    })
    await useChatStore.getState().resend('u1', '다시')
    expect(truncate).toHaveBeenCalledWith(3, 30)
  })

  it('기록을 못 지웠으면 보내지 않는다', async () => {
    truncate.mockResolvedValueOnce({ ok: false, error: '일하는 중' })
    useChatStore.setState((s) => ({
      messages: s.messages.map((m) => (m.id === 'u2' ? { ...m, rowId: 12 } : m))
    }))
    await useChatStore.getState().resend('u2', '고친 말')
    expect(run).not.toHaveBeenCalled()
    expect(useChatStore.getState().status).toBe('failed')
    expect(useChatStore.getState().messages).toHaveLength(4)
  })

  it('다시 받기는 마지막 말을 같은 글·첨부로 다시 보낸다', async () => {
    await useChatStore.getState().regenerate()
    expect(run).toHaveBeenCalledWith('둘째 말', 3, undefined, [img])
    // 기록 전인 말이라 지울 줄이 없다
    expect(truncate).not.toHaveBeenCalled()
  })

  it('일하는 중에는 아무것도 하지 않는다', async () => {
    useChatStore.setState({ status: 'running' })
    await useChatStore.getState().resend('u2', '고친 말')
    await useChatStore.getState().regenerate()
    expect(truncate).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
