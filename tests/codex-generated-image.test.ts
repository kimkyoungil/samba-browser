// Codex 가 그린 그림 — 파일로만 남는 그림을 모아 답 글에 싣고, 화면은 노든 이름 꼴만 읽는다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { CodexEvent, CodexInput } from '../src/main/agent/provider-codex'
import {
  generatedImageMarkdown,
  generatedImageName,
  isGeneratedImageName
} from '../src/shared/generated-image'
import { collectGeneratedImages, readGeneratedImage } from '../src/main/agent/codex-images'
import { safeMarkdownUrl } from '../src/renderer/src/lib/safe-href'

const NAME = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d.png'
let codexRuns: CodexEvent[][] = []
// 실행 도중 그림 파일을 만들 자리(테스트가 정한다)
let drawDuring: (() => void) | null = null

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runCodexQuery: (_input: CodexInput) => {
      const events = codexRuns.shift() ?? []
      return (async function* () {
        await new Promise((r) => setTimeout(r, 5))
        for (const e of events) {
          if (e.type === 'done') drawDuring?.()
          yield e
        }
      })()
    }
  }
})
vi.mock('../src/main/agent/tools', () => ({
  createSambaTools: () => ({}),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner } = await import('../src/main/agent/runner')

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-gen-'))
  codexRuns = []
  drawDuring = null
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('그림 주소', () => {
  it('노든이 붙인 이름 꼴만 그림으로 읽는다(경로 넘기기·다른 주소는 막는다)', () => {
    expect(isGeneratedImageName(NAME)).toBe(true)
    expect(generatedImageName(`noden-image://${NAME}`)).toBe(NAME)
    expect(generatedImageName('noden-image://../secret.png')).toBeNull()
    expect(generatedImageName('noden-image://C:\\Windows\\a.png')).toBeNull()
    expect(generatedImageName(`file://${NAME}`)).toBeNull()
    expect(generatedImageMarkdown(NAME)).toBe(`![생성한 그림](noden-image://${NAME})`)
  })

  it('답 글 주소 거르개: 그림 주소와 http(s) 만 남긴다', () => {
    expect(safeMarkdownUrl(`noden-image://${NAME}`)).toBe(`noden-image://${NAME}`)
    expect(safeMarkdownUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(safeMarkdownUrl('noden-image://../x.png')).toBe('')
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('')
  })
})

describe('그린 그림 모으기', () => {
  it('그 스레드에서 이번 실행 뒤에 생긴 그림만 앱 폴더로 옮긴다', async () => {
    const home = join(root, 'codex')
    const dir = join(home, 'generated_images', 'thread-0001')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'old.png'), 'old')
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'old.png'), past, past)
    writeFileSync(join(dir, 'note.txt'), 'x')
    const since = Date.now()
    writeFileSync(join(dir, 'exec-new.png'), 'new')
    const dest = join(root, 'generated-images')
    const names = await collectGeneratedImages('thread-0001', since, dest, home)
    expect(names).toHaveLength(1)
    expect(isGeneratedImageName(names[0])).toBe(true)
    expect(readdirSync(dest)).toEqual(names)
    expect(await readGeneratedImage(dest, names[0])).toBe(
      `data:image/png;base64,${Buffer.from('new').toString('base64')}`
    )
    // 꼴이 다른 이름·없는 폴더·이상한 스레드 id
    expect(await readGeneratedImage(dest, '../old.png')).toBeNull()
    expect(await collectGeneratedImages('thread-none', since, dest, home)).toEqual([])
    expect(await collectGeneratedImages('../../x', since, dest, home)).toEqual([])
  })
})

describe('러너 — Codex 가 그린 그림', () => {
  it('실행 중에 생긴 그림을 끝 상태보다 먼저 답 글에 싣는다', async () => {
    const home = join(root, 'codex')
    vi.stubEnv('CODEX_HOME', home)
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
      engine: 'codex',
      auth: { mode: 'codex_subscription' },
      model: 'gpt-6-sol'
    }))
    runner.setGeneratedImagesDir(join(root, 'generated-images'))
    drawDuring = () => {
      const dir = join(home, 'generated_images', 'thread-0002')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'exec-apple.png'), 'apple')
    }
    codexRuns = [
      [
        { type: 'thread', id: 'thread-0002' },
        { type: 'text', text: '사과를 그렸어요' },
        { type: 'done', ok: true }
      ]
    ]
    await runner.run('사과 그려줘', 9)
    vi.unstubAllEnvs()
    const kinds = events.map((e) =>
      e.type === 'text'
        ? `text:${e.text.slice(0, 20)}`
        : e.type === 'status'
          ? `status:${e.state}`
          : e.type
    )
    const img = kinds.findIndex((k) => k.startsWith('text:![생성한 그림]'))
    const done = kinds.indexOf('status:done')
    expect(img).toBeGreaterThan(-1)
    expect(done).toBeGreaterThan(img)
  })
})
