// 일하는 중 끼어들기 — 입력 통로, 러너의 기록 나누기·결과 기다리기, 화면 칩·말풍선
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, AgentRunAck, IpcResult } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { AgentImage } from '../src/shared/agent-image'

// 'fold' = 끼어든 말을 같은 턴에 접어 넣는다(실측 기본값), 'separate' = 첫 턴을 끝내고 다음 턴에 답한다
let scenario: 'fold' | 'separate' = 'fold'
let openGate: () => void = () => {}
let inputEnded = false

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      const gate = new Promise<void>((resolve) => {
        openGate = resolve
      })
      return (async function* () {
        const it = input.channel!.iterable[Symbol.asyncIterator]()
        const first = (await it.next()).value as SDKUserMessage
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '첫 답' }] } }
        // 시험이 끼어들기를 한 뒤에 다음 말을 읽는다
        await gate
        const second = (await it.next()).value as SDKUserMessage
        if (scenario === 'separate')
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '첫 답',
            user_message_uuids: [first.uuid]
          }
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '둘째 답' }] } }
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '둘째 답',
          user_message_uuids: scenario === 'fold' ? [first.uuid, second.uuid] : [second.uuid]
        }
        // 입력 통로가 닫혀야 SDK 가 끝난다
        inputEnded = (await it.next()).done === true
      })()
    }
  }
})
vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const ack: IpcResult<AgentRunAck> = { ok: true, data: { started: true } }
const run = vi.fn(async (..._args: unknown[]): Promise<IpcResult<AgentRunAck>> => ack)
const inject = vi.fn(
  async (..._args: unknown[]): Promise<IpcResult<{ injected: boolean; id?: string }>> => ({
    ok: true,
    data: { injected: true, id: 'J1' }
  })
)
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run, inject, stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })), create: vi.fn() }
    }
  }
})

const { createPromptChannel, userMessageOf } = await import('../src/main/agent/provider')
const { AgentRunner } = await import('../src/main/agent/runner')
const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

describe('입력 통로', () => {
  it('첫 말을 내고, 넣는 대로 내고, 닫으면 끝난다(닫힌 뒤엔 못 넣는다)', async () => {
    const ch = createPromptChannel(userMessageOf('첫'))
    const it = ch.iterable[Symbol.asyncIterator]()
    expect(((await it.next()).value as SDKUserMessage).message.content).toBe('첫')
    const pending = it.next()
    expect(ch.push(userMessageOf('둘', undefined, undefined, 'u-2'))).toBe(true)
    const second = (await pending).value as SDKUserMessage
    expect(second.uuid).toBe('u-2')
    ch.close()
    expect((await it.next()).done).toBe(true)
    expect(ch.push(userMessageOf('셋'))).toBe(false)
    expect(ch.closed()).toBe(true)
  })

  it('사진·문서가 붙으면 블록 배열, 아니면 글 그대로 싣는다', () => {
    const img: AgentImage = { mediaType: 'image/png', data: 'aGk=' }
    const content = userMessageOf('봐', [img], [{ name: 'a.pdf', data: 'JVBE' }]).message.content
    expect(Array.isArray(content) && content.map((b) => b.type)).toEqual([
      'document',
      'image',
      'text'
    ])
  })
})

describe('러너 — 끼어든 말', () => {
  function makeRunner(): {
    runner: InstanceType<typeof AgentRunner>
    events: AgentEvent[]
    saved: { prompt: string; text: string }[]
  } {
    const events: AgentEvent[] = []
    const saved: { prompt: string; text: string }[] = []
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
    let row = 100
    runner.setTranscript((_chatId, entry) => {
      saved.push({ prompt: entry.prompt, text: entry.text })
      return { userRowId: ++row }
    })
    return { runner, events, saved }
  }
  const until = async (ok: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 2))
  }

  beforeEach(() => {
    inputEnded = false
  })

  for (const mode of ['fold', 'separate'] as const) {
    it(`${mode === 'fold' ? '같은 턴에 접어 넣어도' : '다음 턴으로 따로 답해도'} 다음 응답에서 기록을 나누고, 끼어든 말에 답한 뒤에 끝낸다`, async () => {
      scenario = mode
      const { runner, events, saved } = makeRunner()
      const p = runner.run('첫 말', 5)
      await until(() => events.some((e) => e.type === 'text' && e.text === '첫 답'))
      // 다른 대화에는 못 넣는다
      expect(runner.inject('엉뚱한 대화', 6)).toBeNull()
      const id = runner.inject('끼어든 말', 5)
      expect(id).toEqual(expect.any(String))
      openGate()
      await p
      expect(inputEnded).toBe(true)
      expect(events.filter((e) => e.type === 'split')).toEqual([
        { type: 'split', injectIds: [id], texts: ['끼어든 말'] }
      ])
      // 끝 상태는 마지막 결과 한 번뿐이다
      expect(events.filter((e) => e.type === 'status' && e.state !== 'running')).toEqual([
        { type: 'status', state: 'done', toolCalls: 0 }
      ])
      expect(saved).toEqual([
        { prompt: '첫 말', text: '첫 답' },
        { prompt: '끼어든 말', text: '둘째 답' }
      ])
      // 기록 두 줄은 각각 다른 꼬리표로 줄 번호가 돌아온다
      const turns = events.flatMap((e) => (e.type === 'turn' ? [e.turnId] : []))
      expect(turns).toHaveLength(2)
      expect(events.filter((e) => e.type === 'saved')).toEqual([
        { type: 'saved', turnId: turns[0], rowId: 101 },
        { type: 'saved', turnId: turns[1], rowId: 102 }
      ])
      // 끝난 실행에는 더 못 넣는다
      expect(runner.inject('늦은 말', 5)).toBeNull()
    })
  }

  it('도는 실행이 없으면 못 넣는다', () => {
    const { runner } = makeRunner()
    expect(runner.inject('말', 5)).toBeNull()
  })
})

describe('화면 — 끼어들기', () => {
  const img: AgentImage = { mediaType: 'image/png', data: 'aGk=' }
  beforeEach(() => {
    run.mockClear()
    inject.mockClear()
    useChatStore.setState({
      activeChatId: 5,
      status: 'running',
      queue: [],
      injecting: [],
      draftReturn: null,
      messages: [
        { id: 'u1', role: 'user', text: '첫 말' },
        { id: 'a1', role: 'ai', text: '', partial: '쓰는 중' }
      ]
    })
  })

  it('넣었으면 칩으로 두었다가, AI 가 집어 들면 말풍선과 새 답 말풍선이 된다', async () => {
    await useChatStore.getState().sendWhileRunning('끼어든 말', [img])
    expect(inject).toHaveBeenCalledWith('끼어든 말', 5, [img], undefined)
    expect(useChatStore.getState().injecting).toEqual([
      { id: 'J1', text: '끼어든 말', chatId: 5, images: [img] }
    ])
    useChatStore.getState().handleEvent({ type: 'split', injectIds: ['J1'], texts: ['끼어든 말'] })
    const s = useChatStore.getState()
    expect(s.injecting).toEqual([])
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '첫 말'],
      ['ai', '쓰는 중'],
      ['user', '끼어든 말'],
      ['ai', '']
    ])
    expect(s.messages[2].sent).toEqual({ images: [img] })
    // 새 답 말풍선에 꼬리표가 달린다
    useChatStore.getState().handleEvent({ type: 'turn', turnId: 'T2' })
    expect(useChatStore.getState().messages[2].turnId).toBe('T2')
  })

  it('못 넣었거나 대기열이 이미 있으면 대기열로 간다', async () => {
    inject.mockResolvedValueOnce({ ok: true, data: { injected: false } })
    await useChatStore.getState().sendWhileRunning('하나')
    expect(useChatStore.getState().queue).toEqual([{ text: '하나', chatId: 5 }])
    await useChatStore.getState().sendWhileRunning('둘')
    // 순서가 뒤바뀌지 않게 대기열 뒤에 선다(묻지도 않는다)
    expect(inject).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().queue.map((q) => q.text)).toEqual(['하나', '둘'])
  })

  it('집어 들지 못하고 끝나면 완료면 이어서 보내고, 중단이면 입력칸으로 돌려준다', async () => {
    useChatStore.setState({ injecting: [{ id: 'J1', text: '못 간 말' }] })
    useChatStore.getState().handleEvent({ type: 'status', state: 'done', toolCalls: 0 })
    await new Promise((r) => setTimeout(r, 0))
    expect(run).toHaveBeenCalledWith('못 간 말', 5)
    expect(useChatStore.getState().injecting).toEqual([])
    useChatStore.setState({ status: 'running', injecting: [{ id: 'J2', text: '또 못 간 말' }] })
    useChatStore.getState().handleEvent({ type: 'status', state: 'stopped' })
    expect(useChatStore.getState().draftReturn?.text).toBe('또 못 간 말')
    expect(useChatStore.getState().injecting).toEqual([])
  })
})
