// 끌어다 놓은 파일 — 모델에는 내용이, 대화 기록에는 이름만 간다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { CodexInput } from '../src/main/agent/provider-codex'
import type { TranscriptEntry } from '../src/main/agent/runner'
import type { AgentFile } from '../src/shared/agent-file'

const claudeInputs: ProviderInput[] = []
const codexInputs: CodexInput[] = []

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runQuery: (input: ProviderInput) => {
      claudeInputs.push(input)
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '확인했어요',
          modelUsage: {}
        }
      })()
    },
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        yield { type: 'text', text: '확인했어요' }
        yield { type: 'done', ok: true }
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner, CODEX_NO_PDF_NOTE } = await import('../src/main/agent/runner')

const FILES: AgentFile[] = [
  { kind: 'text', name: '주문.csv', text: '주문번호,금액\n1001,32000' },
  { kind: 'pdf', name: '견적.pdf', data: 'JVBERi0x' }
]

function makeRunner(codex: boolean): {
  runner: InstanceType<typeof AgentRunner>
  saved: TranscriptEntry[]
} {
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
    () => undefined
  )
  runner.setEngineRouting(() =>
    codex
      ? { engine: 'codex', auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
      : { engine: 'claude', auth: { mode: 'claude_subscription' }, model: 'claude-sonnet-5-5' }
  )
  const saved: TranscriptEntry[] = []
  runner.setTranscript((_chatId, entry) => saved.push(entry))
  return { runner, saved }
}

beforeEach(() => {
  claudeInputs.length = 0
  codexInputs.length = 0
})

describe('실행기 — 첨부 파일', () => {
  it('Claude: 글 파일 내용은 지시문 뒤에, PDF 는 문서로 싣고 기록에는 이름만 남긴다', async () => {
    const { runner, saved } = makeRunner(false)
    await runner.run('이 주문 합계 내줘', 1, undefined, undefined, FILES)
    await new Promise((r) => setTimeout(r, 20))
    const input = claudeInputs[0]
    expect(input.prompt.startsWith('이 주문 합계 내줘')).toBe(true)
    expect(input.prompt).toContain('[첨부 파일: 주문.csv]\n주문번호,금액\n1001,32000')
    expect(input.documents).toEqual([{ name: '견적.pdf', data: 'JVBERi0x' }])
    expect(saved[0].prompt).toBe('이 주문 합계 내줘\n📎 주문.csv, 견적.pdf')
    expect(saved[0].prompt).not.toContain('1001')
  })

  it('Codex: 글 파일 내용은 싣고, PDF 는 못 읽는다고 알린다', async () => {
    const { runner } = makeRunner(true)
    await runner.run('이 주문 합계 내줘', 2, undefined, undefined, FILES)
    await new Promise((r) => setTimeout(r, 20))
    const prompt = codexInputs[0].prompt
    expect(prompt).toContain('1001,32000')
    expect(prompt).toContain(CODEX_NO_PDF_NOTE)
  })

  it('첨부가 없으면 종전과 같다', async () => {
    const { runner, saved } = makeRunner(false)
    await runner.run('안녕', 3)
    await new Promise((r) => setTimeout(r, 20))
    expect(claudeInputs[0].documents).toBeUndefined()
    expect(saved[0].prompt).toBe('안녕')
  })
})
