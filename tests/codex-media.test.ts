// Codex 대화도 Claude 처럼 — 사진을 붙이고, PDF 글자를 싣고, 스레드를 이어받아 앞 대화를 기억한다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ChatSessionStore } from '../src/main/agent/chat-session'
import {
  buildCodexArgs,
  parseCodexLine,
  type CodexEvent,
  type CodexInput
} from '../src/main/agent/provider-codex'
import { CodexThreadStore } from '../src/main/agent/codex-threads'
import { pdfText, pdfTextBlock } from '../src/main/agent/pdf-text'

// 실행마다 흉내 낼 Codex 사건들(앞에서부터 한 실행씩 꺼낸다)
let codexRuns: CodexEvent[][] = []
const codexInputs: CodexInput[] = []
// 실행 도중에 본 사진 파일(끝난 뒤 지워졌는지 견준다)
const seenImages: { path: string; bytes: string }[] = []

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
      })(),
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      for (const path of input.imagePaths ?? [])
        seenImages.push({ path, bytes: readFileSync(path).toString('base64') })
      const events = codexRuns.shift() ?? [{ type: 'done', ok: true }]
      return (async function* () {
        await new Promise((r) => setTimeout(r, 0))
        for (const e of events) yield e
      })()
    }
  }
})
vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

// 글자 층이 있는 아주 작은 PDF(Helvetica 'Hello noden')
const TINY_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 18 Tf 20 60 Td (Hello noden) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
  'latin1'
).toString('base64')

describe('Codex 실행 인자', () => {
  it('대화 실행은 스레드를 남기고, 한 번짜리 호출은 남기지 않는다', () => {
    expect(buildCodexArgs({ model: 'm', keepThread: true })).not.toContain('--ephemeral')
    expect(buildCodexArgs({ model: 'm' })).toContain('--ephemeral')
  })

  it('사진은 한 장씩 --image= 로, 이어받기는 resume <id> - 꼴로 붙인다(읽기 전용은 설정 값으로)', () => {
    const args = buildCodexArgs({
      model: 'm',
      keepThread: true,
      resume: 'thread-0001',
      imagePaths: ['C:\\t\\1.png', 'C:\\t\\2.jpg']
    })
    expect(args.slice(0, 2)).toEqual(['exec', 'resume'])
    expect(args).not.toContain('--sandbox')
    expect(args).toContain('sandbox_mode="read-only"')
    expect(args).toContain('--image=C:\\t\\1.png')
    expect(args).toContain('--image=C:\\t\\2.jpg')
    expect(args.slice(-2)).toEqual(['thread-0001', '-'])
  })

  it('시작 줄의 스레드 id 를 사건으로 낸다', () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"01a1-thread-7"}')).toEqual([
      { type: 'thread', id: '01a1-thread-7' }
    ])
  })
})

describe('Codex 스레드 저장소', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codex-threads-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('대화마다 남기고 다시 읽으며, 엉뚱한 값은 받지 않는다', () => {
    const file = join(dir, 'codex-threads.json')
    const a = new CodexThreadStore(file)
    a.set(1, '01a176e7-bded-7582-825d-ed373ca1bd6a')
    a.set(2, 'bad id with spaces')
    const b = new CodexThreadStore(file)
    expect(b.get(1)).toBe('01a176e7-bded-7582-825d-ed373ca1bd6a')
    expect(b.get(2)).toBeNull()
    b.clear(1)
    expect(new CodexThreadStore(file).get(1)).toBeNull()
  })
})

describe('PDF 글자', () => {
  it('글자 층이 있으면 뽑고, 깨졌으면 null', async () => {
    expect(await pdfText(TINY_PDF)).toEqual({ text: 'Hello noden', pages: 1, truncated: false })
    expect(await pdfText('JVBERi0x')).toBeNull()
  })

  it('지시문 묶음: 뽑으면 이름·쪽수와 함께 싣고, 못 뽑으면 그렇다고 알린다', async () => {
    const block = await pdfTextBlock([
      { name: '안내.pdf', data: TINY_PDF },
      { name: '스캔.pdf', data: 'JVBERi0x' }
    ])
    expect(block).toContain('[첨부 PDF: 안내.pdf (1쪽)]\nHello noden')
    expect(block).toContain('"스캔.pdf", but no text could be read')
  })
})

describe('러너 — Codex 대화', () => {
  let dir: string
  beforeEach(() => {
    codexRuns = []
    codexInputs.length = 0
    seenImages.length = 0
    dir = mkdtempSync(join(tmpdir(), 'codex-run-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeRunner(engine: 'claude' | 'codex'): {
    runner: InstanceType<typeof AgentRunner>
    events: AgentEvent[]
    threads: CodexThreadStore
    sessions: { clear: ReturnType<typeof vi.fn> }
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
    let route = engine
    runner.setEngineRouting(() =>
      route === 'codex'
        ? { engine: 'codex', auth: { mode: 'codex_subscription' }, model: 'gpt-6.1-sol' }
        : { engine: 'claude', auth: { mode: 'claude_subscription' }, model: 'claude-sonnet-5-5' }
    )
    ;(runner as unknown as { switchTo: (e: 'claude' | 'codex') => void }).switchTo = (e) => {
      route = e
    }
    const threads = new CodexThreadStore(join(dir, 'codex-threads.json'))
    runner.setCodexThreads(threads)
    const sessions = { clear: vi.fn(), get: () => null, note: vi.fn() }
    runner.setChatSessions(sessions as unknown as ChatSessionStore, () => [
      { role: 'user', content: '앞선 말' },
      { role: 'assistant', content: '앞선 답' }
    ])
    return { runner, events, threads, sessions }
  }

  it('첫 말은 지시문·앞부분 요약과 함께 새로 열고, 다음 말은 그 스레드를 이어받아 이번 말만 보낸다', async () => {
    const { runner, threads } = makeRunner('codex')
    codexRuns = [
      [
        { type: 'thread', id: 'thread-0001' },
        { type: 'text', text: '받았어' },
        { type: 'done', ok: true }
      ],
      [
        { type: 'thread', id: 'thread-0001' },
        { type: 'text', text: '포도 4729' },
        { type: 'done', ok: true }
      ]
    ]
    await runner.run('이 그림 기억해', 7)
    expect(codexInputs[0].resume).toBeUndefined()
    expect(codexInputs[0].keepThread).toBe(true)
    expect(codexInputs[0].systemPrompt).not.toBe('')
    expect(codexInputs[0].prompt).toContain('앞선 말')
    expect(threads.get(7)).toBe('thread-0001')
    await runner.run('아까 그림에 뭐라고 적혀 있었지?', 7)
    expect(codexInputs[1].resume).toBe('thread-0001')
    expect(codexInputs[1].systemPrompt).toBe('')
    expect(codexInputs[1].prompt).toBe('아까 그림에 뭐라고 적혀 있었지?')
  })

  it('이어받기가 아무 답도 못 내고 실패하면 새 스레드로 한 번 다시 돈다(실패를 알리지 않는다)', async () => {
    const { runner, events, threads } = makeRunner('codex')
    threads.set(7, 'thread-gone')
    codexRuns = [
      [{ type: 'done', ok: false, message: 'no rollout found for thread id thread-gone' }],
      [
        { type: 'thread', id: 'thread-0002' },
        { type: 'text', text: '다시 시작' },
        { type: 'done', ok: true }
      ]
    ]
    await runner.run('계속해', 7)
    expect(codexInputs.map((i) => i.resume)).toEqual(['thread-gone', undefined])
    expect(threads.get(7)).toBe('thread-0002')
    expect(events.filter((e) => e.type === 'status' && e.state !== 'running')).toEqual([
      { type: 'status', state: 'done', toolCalls: 0 }
    ])
  })

  it('사진은 임시 파일로 붙였다가 실행이 끝나면 지운다', async () => {
    const { runner } = makeRunner('codex')
    const img = { mediaType: 'image/png' as const, data: 'aGk=' }
    await runner.run('이 캡처 봐줘', 7, undefined, [img])
    expect(seenImages).toHaveLength(1)
    expect(seenImages[0].path.endsWith('.png')).toBe(true)
    expect(seenImages[0].bytes).toBe('aGk=')
    expect(existsSync(seenImages[0].path)).toBe(false)
    // 사진을 못 본다는 옛 안내는 붙지 않는다
    expect(codexInputs[0].prompt).not.toContain('cannot see images')
  })

  it('AI 를 바꾸면 상대 쪽 세션을 버린다(그 세션에는 이 말이 없다)', async () => {
    const { runner, threads, sessions } = makeRunner('codex')
    codexRuns = [
      [
        { type: 'thread', id: 'thread-0003' },
        { type: 'done', ok: true }
      ]
    ]
    await runner.run('코덱스로', 7)
    expect(sessions.clear).toHaveBeenCalledWith(7)
    expect(threads.get(7)).toBe('thread-0003')
    ;(runner as unknown as { switchTo: (e: 'claude' | 'codex') => void }).switchTo('claude')
    await runner.run('클로드로', 7)
    expect(threads.get(7)).toBeNull()
  })
})
