import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import { buildQueryOptions, type ProviderInput } from '../src/main/agent/provider'

// 스트림 메시지·지연은 테스트가 매번 주입한다. afterMs 는 마지막 메시지(result) 뒤
// 스트림이 실제로 닫히기까지 걸리는 시간 — 그 사이가 '끝 상태는 보냈고 뒷정리만 남은' 틈이다
let script: { delayMs: number; messages: unknown[]; afterMs: number } = {
  delayMs: 0,
  messages: [],
  afterMs: 0
}
const queryInputs: ProviderInput[] = []

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      queryInputs.push(input)
      const now = script
      return (async function* () {
        await new Promise((r) => setTimeout(r, now.delayMs))
        for (const m of now.messages) yield m
        await new Promise((r) => setTimeout(r, now.afterMs))
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

function makeRunner(): { runner: InstanceType<typeof AgentRunner>; events: AgentEvent[] } {
  const events: AgentEvent[] = []
  const settings = {
    get: () => ({
      model: 'sonnet',
      language: 'ko',
      panelWidth: 380,
      lastUrl: '',
      dangerWords: [],
      maxToolCalls: 40
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  return { runner, events }
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))
const delta = (text: string): unknown => ({
  type: 'stream_event',
  parent_tool_use_id: null,
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
})
const done = { type: 'result', subtype: 'success', is_error: false, result: '' }

describe('글자 단위 답(partial)', () => {
  it('조각을 이어 붙여 보내고, 확정 글이 오면 지운 뒤 확정 글을 보낸다', async () => {
    script = {
      delayMs: 0,
      afterMs: 0,
      messages: [
        { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } },
        {
          type: 'stream_event',
          parent_tool_use_id: null,
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } }
        },
        delta('안녕'),
        delta('하세요'),
        { type: 'assistant', message: { content: [{ type: 'text', text: '안녕하세요' }] } },
        done
      ]
    }
    const { runner, events } = makeRunner()
    await runner.run('인사해')
    const shown = events.filter((e) => e.type === 'partial' || e.type === 'text')
    expect(shown).toEqual([
      { type: 'partial', text: '안녕' },
      { type: 'partial', text: '안녕하세요' },
      { type: 'partial', text: '' },
      { type: 'text', text: '안녕하세요' }
    ])
    // 채팅 실행은 SDK 에 글자 단위 스트림을 켜 달라고 한다
    expect(queryInputs[queryInputs.length - 1].partial).toBe(true)
  })

  it('하위 작업(parent_tool_use_id 있음)의 조각은 보내지 않는다', async () => {
    script = {
      delayMs: 0,
      afterMs: 0,
      messages: [
        {
          type: 'stream_event',
          parent_tool_use_id: 'tool-1',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '속' }
          }
        },
        done
      ]
    }
    const { runner, events } = makeRunner()
    await runner.run('일해')
    expect(events.some((e) => e.type === 'partial')).toBe(false)
  })
})

describe('끝 상태 직후에 온 다음 지시', () => {
  it('앞 실행의 뒷정리를 기다렸다가 시작한다(이미 실행 중으로 튕기지 않는다)', async () => {
    script = { delayMs: 0, afterMs: 40, messages: [done] }
    const { runner, events } = makeRunner()
    const first = runner.run('첫 작업')
    // result 를 받아 done 은 보냈지만 스트림은 아직 닫히지 않았다
    await tick(10)
    expect(events.filter((e) => e.type === 'status').map((e) => e.state)).toEqual([
      'running',
      'done'
    ])
    script = { delayMs: 0, afterMs: 0, messages: [done] }
    await expect(runner.run('대기열 다음 말')).resolves.toBeUndefined()
    await first
    expect(events.filter((e) => e.type === 'status').map((e) => e.state)).toEqual([
      'running',
      'done',
      'running',
      'done'
    ])
  })

  it('끝 상태 전(실행 중)에 온 지시는 여전히 받지 않는다', async () => {
    script = { delayMs: 60_000, afterMs: 0, messages: [] }
    const { runner } = makeRunner()
    void runner.run('긴 작업')
    await tick()
    await expect(runner.run('끼어들기')).rejects.toThrow('이미 실행 중')
    runner.stop()
  })
})

describe('buildQueryOptions — 글자 단위 스트림', () => {
  const base: ProviderInput = {
    prompt: 'x',
    systemPrompt: 's',
    model: 'm',
    mcpServers: {},
    allowedTools: [],
    abort: new AbortController()
  }
  it('partial 을 주면 includePartialMessages 를 켠다', () => {
    expect(buildQueryOptions({ ...base, partial: true }, undefined).includePartialMessages).toBe(
      true
    )
  })
  it('주지 않으면(번역 등 한 덩어리 호출) 옵션을 넣지 않는다', () => {
    expect('includePartialMessages' in buildQueryOptions(base, undefined)).toBe(false)
  })
})
