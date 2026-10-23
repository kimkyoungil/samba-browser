// 대화마다 고르는 AI(Claude / Codex) — 저장·인증 경로·실행기 분기
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ProviderInput } from '../src/main/agent/provider'
import type { CodexInput } from '../src/main/agent/provider-codex'
import { ChatEngineStore } from '../src/main/agent/chat-engine'
import { resolveEngineAuth } from '../src/main/ai/auth-route'
import { buildCodexArgs } from '../src/main/agent/provider-codex'
import { engineOfProvider, isChatEngine, providerOfEngine } from '../src/shared/ai'
import { DEFAULT_TASK_MODELS, taskModelChoices } from '../src/main/ai/models'

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
        yield { type: 'system', subtype: 'init', session_id: 'sess' }
        yield { type: 'result', subtype: 'success', is_error: false, result: '클로드 답' }
      })()
    },
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        yield { type: 'text', text: '코덱스 답' }
        yield { type: 'done', ok: true }
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner, CODEX_CHAT_PROMPT } = await import('../src/main/agent/runner')

const tmpFile = (): string =>
  join(mkdtempSync(join(tmpdir(), 'samba-chat-engine-')), 'chat-engines.json')
const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

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
      agentEffort: 'high'
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  runner.setChatSessions(null, () => [
    { role: 'user', content: '어제 주문 몇 건이야' },
    { role: 'assistant', content: '12건입니다' }
  ])
  return { runner, events }
}

beforeEach(() => {
  claudeInputs.length = 0
  codexInputs.length = 0
})

describe('ChatEngineStore — 대화별 AI 기억', () => {
  it('고른 적 없는 대화는 null, 고르면 남고 다시 켜도 읽는다', () => {
    const file = tmpFile()
    const store = new ChatEngineStore(file)
    expect(store.get(3)).toBeNull()
    store.set(3, 'codex')
    store.setModel('codex', 'gpt-6-luna')
    const again = new ChatEngineStore(file)
    expect(again.get(3)).toBe('codex')
    expect(again.model('codex')).toBe('gpt-6-luna')
    expect(again.model('claude')).toBeNull()
  })
  it('지우면 앱 기본 연결로 돌아간다', () => {
    const store = new ChatEngineStore(tmpFile())
    store.set(4, 'codex')
    store.clear(4)
    expect(store.get(4)).toBeNull()
  })
  it('모르는 값·깨진 파일은 버린다', () => {
    const file = tmpFile()
    writeFileSync(file, JSON.stringify({ chats: { '1': 'gemini', '2': 'codex', x: 'claude' } }))
    const store = new ChatEngineStore(file)
    expect(store.get(1)).toBeNull()
    expect(store.get(2)).toBe('codex')
    writeFileSync(file, '{broken')
    expect(new ChatEngineStore(file).get(2)).toBeNull()
  })
  it('파일에는 대화 번호·AI 이름·모델 이름만 있다', () => {
    const file = tmpFile()
    const store = new ChatEngineStore(file)
    store.set(9, 'claude')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ chats: { '9': 'claude' }, models: {} })
  })
})

describe('AI 계열', () => {
  it('Codex 구독만 codex, 나머지는 claude', () => {
    expect(engineOfProvider('codex_subscription')).toBe('codex')
    expect(engineOfProvider('claude_subscription')).toBe('claude')
    expect(engineOfProvider('api_key')).toBe('claude')
    expect(providerOfEngine('codex')).toBe('codex_subscription')
    expect(isChatEngine('codex')).toBe(true)
    expect(isChatEngine('gpt')).toBe(false)
  })
  it('Codex 기본 모델은 이 PC 의 Codex 모델 목록에 있는 이름이다', () => {
    const listed = taskModelChoices('codex_subscription')
    for (const m of Object.values(DEFAULT_TASK_MODELS.codex_subscription))
      expect(listed).toContain(m)
    expect(listed).not.toContain('gpt-5.6')
  })
})

describe('resolveEngineAuth — 다른 AI 를 고른 대화의 인증 경로', () => {
  const off = { connected: false }
  const on = { connected: true }
  it('Codex 는 연결됐을 때만 쓰고, 아니면 Claude 로 몰래 돌리지 않는다', () => {
    expect(
      resolveEngineAuth({
        engine: 'codex',
        connections: { claude: on, codex: on },
        hasApiKey: true
      })
    ).toEqual({ mode: 'codex_subscription' })
    expect(
      resolveEngineAuth({
        engine: 'codex',
        connections: { claude: on, codex: off },
        hasApiKey: true
      })
    ).toEqual({ mode: 'none', reason: 'not_connected' })
  })
  it('Claude 는 구독 → 내 API 키 순', () => {
    expect(
      resolveEngineAuth({
        engine: 'claude',
        connections: { claude: on, codex: on },
        hasApiKey: true
      })
    ).toEqual({ mode: 'claude_subscription' })
    expect(
      resolveEngineAuth({
        engine: 'claude',
        connections: { claude: off, codex: on },
        hasApiKey: true
      })
    ).toEqual({ mode: 'api_key' })
    expect(
      resolveEngineAuth({
        engine: 'claude',
        connections: { claude: off, codex: on },
        hasApiKey: false
      })
    ).toEqual({ mode: 'none', reason: 'not_connected' })
  })
})

describe('buildCodexArgs — 추론 강도', () => {
  it('고른 강도를 model_reasoning_effort 로 넘긴다', () => {
    const args = buildCodexArgs({ model: 'gpt-6.1-sol', effort: 'high' })
    expect(args.join(' ')).toContain('model_reasoning_effort="high"')
  })
  it('강도를 안 주면 붙이지 않는다', () => {
    expect(buildCodexArgs({ model: 'gpt-6.1-sol' }).join(' ')).not.toContain('reasoning')
  })
})

describe('실행기 — 대화별 AI 분기', () => {
  it('Codex 를 고른 대화는 Codex 로 돌고, 앞 대화를 붙여 맥락을 넘긴다', async () => {
    const { runner, events } = makeRunner()
    runner.setEngineRouting((chatId) =>
      chatId === 7
        ? { engine: 'codex', auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
        : null
    )
    await runner.run('그중 취소는?', 7)
    await tick()
    expect(claudeInputs).toHaveLength(0)
    expect(codexInputs).toHaveLength(1)
    const input = codexInputs[0]
    expect(input.model).toBe('gpt-6.1-sol')
    expect(input.effort).toBe('high')
    expect(input.systemPrompt).toBe(CODEX_CHAT_PROMPT)
    expect(input.prompt).toContain('어제 주문 몇 건이야')
    expect(input.prompt).toContain('12건입니다')
    expect(input.prompt.endsWith('그중 취소는?')).toBe(true)
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)
    expect(texts).toContain('코덱스 답')
  })

  it('고르지 않은 대화는 종전대로 앱 기본 연결(Claude)로 돈다', async () => {
    const { runner } = makeRunner()
    runner.setEngineRouting(() => null)
    await runner.run('안녕', 8)
    await tick()
    expect(codexInputs).toHaveLength(0)
    expect(claudeInputs).toHaveLength(1)
    expect(claudeInputs[0].auth).toEqual({ mode: 'claude_subscription' })
  })

  it('Claude 를 고른 대화는 그 경로·모델을 SDK 호출에 넘긴다', async () => {
    const { runner } = makeRunner()
    runner.setEngineRouting(() => ({
      engine: 'claude',
      auth: { mode: 'api_key' },
      model: 'claude-opus-5-5'
    }))
    await runner.run('화면 읽어줘', 9)
    await tick()
    expect(claudeInputs).toHaveLength(1)
    expect(claudeInputs[0].auth).toEqual({ mode: 'api_key' })
    expect(claudeInputs[0].model).toBe('claude-opus-5-5')
  })

  it('Codex 를 골랐는데 연결이 없으면 실행하지 않고 연결 필요로 끝낸다', async () => {
    const { runner, events } = makeRunner()
    runner.setEngineRouting(() => ({
      engine: 'codex',
      auth: { mode: 'none', reason: 'not_connected' },
      model: 'gpt-6.1-sol'
    }))
    await runner.run('hi', 10)
    await tick()
    expect(codexInputs).toHaveLength(0)
    expect(claudeInputs).toHaveLength(0)
    const last = events.filter((e) => e.type === 'status').pop() as {
      state: string
      message?: string
    }
    expect(last.state).toBe('failed')
    expect(last.message).toBe('auth:notConnected')
  })
})
