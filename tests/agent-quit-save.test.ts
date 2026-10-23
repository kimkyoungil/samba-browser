// 일하는 도중 앱을 끄면 그때까지의 대화가 기록에 남는다(작업 끝의 기록은 DB 가 닫힌 뒤라 못 남는다)
import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { TranscriptEntry } from '../src/main/agent/runner'

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    // 확정 글 한 문단, 쓰는 중인 글 한 조각을 보낸 뒤 중단될 때까지 붙잡고 있는 실행
    runQuery: (input: { abort: AbortController }) =>
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's1' }
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: '주문 3건을 찾았습니다.' }], usage: {} }
        }
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '첫째는 양말' }
          }
        }
        await new Promise<void>((resolve) =>
          input.abort.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      })()
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner, QUIT_NOTE } = await import('../src/main/agent/runner')

function makeRunner(): {
  runner: InstanceType<typeof AgentRunner>
  saved: Array<[number, TranscriptEntry]>
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
      maxToolCalls: 40
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  const saved: Array<[number, TranscriptEntry]> = []
  runner.setTranscript((chatId, entry) => saved.push([chatId, entry]))
  return { runner, saved, events }
}

describe('앱을 끌 때 도는 작업의 기록', () => {
  it('그때까지의 답(쓰는 중인 글 포함)에 중단 표시를 붙여 한 번만 남기고 멈춘다', async () => {
    const { runner, saved, events } = makeRunner()
    const done = runner.run('어제 주문 정리해줘', 5)
    await new Promise((r) => setTimeout(r, 20))
    expect(runner.isRunning()).toBe(true)

    runner.saveRunningOnQuit()
    expect(saved).toHaveLength(1)
    const [chatId, entry] = saved[0]
    expect(chatId).toBe(5)
    expect(entry.prompt).toBe('어제 주문 정리해줘')
    expect(entry.text).toBe(`주문 3건을 찾았습니다.\n첫째는 양말\n${QUIT_NOTE}`)
    expect(events.filter((e) => e.type === 'status').pop()).toMatchObject({ state: 'stopped' })

    // 멈춘 실행이 마저 끝나도 같은 기록을 또 남기지 않는다
    await done
    await new Promise((r) => setTimeout(r, 20))
    expect(saved).toHaveLength(1)
  })

  it('도는 작업이 없으면 아무것도 남기지 않는다', () => {
    const { runner, saved } = makeRunner()
    runner.saveRunningOnQuit()
    expect(saved).toEqual([])
  })
})
