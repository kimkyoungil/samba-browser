// AI 지침 — 설정에 적은 규칙이 Claude·Codex 모든 대화의 지시문에 붙는다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { CodexInput } from '../src/main/agent/provider-codex'
import { appendUserInstructions } from '../src/main/agent/prompt'
import { AGENT_INSTRUCTIONS_MAX, parseSettings } from '../src/shared/settings'

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
        yield { type: 'result', subtype: 'success', is_error: false, result: '네', modelUsage: {} }
      })()
    },
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        yield { type: 'done', ok: true }
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

const RULES = '답은 존댓말로, 결론부터.'

function makeRunner(engine: 'claude' | 'codex'): InstanceType<typeof AgentRunner> {
  const settings = {
    get: () => ({
      model: 'sonnet',
      language: 'ko',
      panelWidth: 380,
      lastUrl: '',
      dangerWords: [],
      maxToolCalls: 40,
      agentEffort: 'medium',
      agentInstructions: RULES
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    () => undefined
  )
  runner.setEngineRouting(() =>
    engine === 'codex'
      ? { engine, auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
      : { engine, auth: { mode: 'claude_subscription' }, model: 'claude-sonnet-5-5' }
  )
  return runner
}

beforeEach(() => {
  claudeInputs.length = 0
  codexInputs.length = 0
})

describe('AI 지침', () => {
  it('비어 있으면 붙이지 않고, 있으면 지시문 끝에 붙인다', () => {
    expect(appendUserInstructions('기본', '  ')).toBe('기본')
    const out = appendUserInstructions('기본', RULES)
    expect(out.startsWith('기본')).toBe(true)
    expect(out.endsWith(RULES)).toBe(true)
    expect(out).toContain("USER'S STANDING INSTRUCTIONS")
  })

  it('너무 긴 지침은 설정을 읽을 때 상한으로 자른다', () => {
    const s = parseSettings({ agentInstructions: 'x'.repeat(AGENT_INSTRUCTIONS_MAX + 10) })
    expect(s.agentInstructions).toHaveLength(AGENT_INSTRUCTIONS_MAX)
    expect(parseSettings({}).agentInstructions).toBe('')
  })

  it('Claude 대화의 지시문에 붙는다', async () => {
    await makeRunner('claude').run('안녕', 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(claudeInputs[0].systemPrompt).toContain(RULES)
  })

  it('Codex 대화의 지시문에도 붙는다(도구 통로를 못 열 때의 지시문 포함)', async () => {
    await makeRunner('codex').run('안녕', 2)
    await new Promise((r) => setTimeout(r, 20))
    expect(codexInputs[0].systemPrompt).toContain(RULES)
  })
})
