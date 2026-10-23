// 생각 과정·할 일 목록 — Claude 스트림의 생각 요약과 Codex 의 reasoning·todo_list 를 화면 사건으로 넘긴다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import {
  buildCodexArgs,
  parseCodexLine,
  type CodexEvent,
  type CodexInput
} from '../src/main/agent/provider-codex'
import { lastNonEmptyLine } from '../src/renderer/src/lib/thinking-line'

let claudeMessages: unknown[] = []
let codexEvents: CodexEvent[] = []
const codexInputs: CodexInput[] = []

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: () => {
      const now = claudeMessages
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const m of now) yield m
      })()
    },
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      const now = codexEvents
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const e of now) yield e
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner, appendThinking, THINKING_SHOW_MAX } = await import('../src/main/agent/runner')
const { buildQueryOptions } = await import('../src/main/agent/provider')

function makeRunner(engine: 'claude' | 'codex'): {
  runner: InstanceType<typeof AgentRunner>
  events: AgentEvent[]
} {
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
  runner.setEngineRouting(() =>
    engine === 'codex'
      ? { engine, auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
      : { engine, auth: { mode: 'claude_subscription' }, model: 'claude-sonnet-5-5' }
  )
  return { runner, events }
}

const stream = (event: unknown): unknown => ({
  type: 'stream_event',
  parent_tool_use_id: null,
  event
})
const thinkingDelta = (thinking: string): unknown =>
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } })
const done = { type: 'result', subtype: 'success', is_error: false, result: '' }

beforeEach(() => {
  claudeMessages = []
  codexEvents = []
  codexInputs.length = 0
})

describe('Claude 생각 과정', () => {
  const base: ProviderInput = {
    prompt: 'x',
    systemPrompt: 's',
    model: 'm',
    mcpServers: {},
    allowedTools: [],
    abort: new AbortController()
  }

  it('화면에 흘리는 실행만 생각 요약을 켠다(번역 같은 한 덩어리 호출은 그대로)', () => {
    expect(buildQueryOptions({ ...base, partial: true }, undefined).thinking).toEqual({
      type: 'adaptive',
      display: 'summarized'
    })
    expect('thinking' in buildQueryOptions(base, undefined)).toBe(false)
  })

  it('생각 조각을 이어 붙여 보내고, 새 생각 덩어리는 빈 줄로 띄운다', async () => {
    claudeMessages = [
      stream({ type: 'message_start' }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      thinkingDelta('**계획**'),
      thinkingDelta('\n먼저 본다'),
      stream({ type: 'content_block_start', index: 1, content_block: { type: 'thinking' } }),
      thinkingDelta('다음'),
      { type: 'assistant', message: { content: [{ type: 'text', text: '끝' }] } },
      done
    ]
    const { runner, events } = makeRunner('claude')
    await runner.run('생각해', 1)
    const thoughts = events.filter((e) => e.type === 'thinking')
    expect(thoughts.at(-1)).toEqual({ type: 'thinking', text: '**계획**\n먼저 본다\n\n다음' })
    // 답 글은 따로 그대로 온다
    expect(events).toContainEqual({ type: 'text', text: '끝' })
  })

  it('하위 작업의 생각은 보내지 않는다', async () => {
    claudeMessages = [
      {
        type: 'stream_event',
        parent_tool_use_id: 'tool-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '속' }
        }
      },
      done
    ]
    const { runner, events } = makeRunner('claude')
    await runner.run('일해', 2)
    expect(events.some((e) => e.type === 'thinking')).toBe(false)
  })

  it('아주 긴 생각은 앞을 잘라 상한을 지킨다', () => {
    const long = appendThinking('가'.repeat(THINKING_SHOW_MAX), '나다')
    expect(long).toHaveLength(THINKING_SHOW_MAX)
    expect(long.startsWith('…')).toBe(true)
    expect(long.endsWith('나다')).toBe(true)
    // 잘린 뒤에 더 붙여도 '…' 하나로 시작한다
    const again = appendThinking(long, '라')
    expect(again.startsWith('…가')).toBe(true)
    expect(again).toHaveLength(THINKING_SHOW_MAX)
  })
})

describe('Codex 생각 과정·계획', () => {
  it('대화 실행만 생각 요약을 켠다', () => {
    expect(buildCodexArgs({ model: 'm', thinking: true }).join(' ')).toContain(
      'model_reasoning_summary="detailed"'
    )
    expect(buildCodexArgs({ model: 'm' }).join(' ')).not.toContain('reasoning_summary')
  })

  it('reasoning 항목은 생각, todo_list 항목은 할 일 목록이 된다', () => {
    expect(
      parseCodexLine(
        JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: ' **계산** ' } })
      )
    ).toEqual([{ type: 'thinking', text: '**계산**' }])
    const todo = {
      type: 'todo_list',
      items: [
        { text: '열기', completed: true },
        { text: '읽기', completed: false },
        { text: '  ', completed: false }
      ]
    }
    const expected = [
      {
        type: 'todos',
        items: [
          { text: '열기', status: 'done' },
          { text: '읽기', status: 'pending' }
        ]
      }
    ]
    for (const type of ['item.started', 'item.updated', 'item.completed'])
      expect(parseCodexLine(JSON.stringify({ type, item: todo }))).toEqual(expected)
    // 다른 항목의 started/updated 는 버린다
    expect(
      parseCodexLine(JSON.stringify({ type: 'item.started', item: { type: 'agent_message' } }))
    ).toEqual([])
  })

  it('러너가 생각을 이어 붙이고 할 일 목록을 그대로 넘긴다', async () => {
    codexEvents = [
      { type: 'thinking', text: '첫 생각' },
      { type: 'todos', items: [{ text: '열기', status: 'pending' }] },
      { type: 'thinking', text: '둘째 생각' },
      { type: 'text', text: '답' },
      { type: 'done', ok: true }
    ]
    const { runner, events } = makeRunner('codex')
    await runner.run('해줘', 3)
    await new Promise((r) => setTimeout(r, 20))
    expect(codexInputs[0].thinking).toBe(true)
    expect(events.filter((e) => e.type === 'thinking').at(-1)).toEqual({
      type: 'thinking',
      text: '첫 생각\n\n둘째 생각'
    })
    expect(events).toContainEqual({ type: 'todos', items: [{ text: '열기', status: 'pending' }] })
  })
})

describe('접힌 생각 칸의 한 줄', () => {
  it('마지막으로 비지 않은 줄을 굵게 표시 없이 고른다', () => {
    expect(lastNonEmptyLine('**계획**\n\n  보는 중  \n\n')).toBe('보는 중')
    expect(lastNonEmptyLine('**계산하기**')).toBe('계산하기')
    expect(lastNonEmptyLine('\n \n')).toBe('')
  })
})
