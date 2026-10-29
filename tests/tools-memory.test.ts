// 클로드 앱 기억 읽기 도구 — 기억 폴더 안의 .md 만 찾고 읽는다(쓰기 없음)
import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => ({ name, description, schema, handler }),
  createSdkMcpServer: (o: unknown) => o
}))

const { createMemoryTools, listMemoryFiles, readMemory, searchMemory } =
  await import('../src/main/agent/tools-memory')

const home = mkdtempSync(join(tmpdir(), 'noden-claude-home-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))
const main = join(home, 'projects', 'C--Users-KKI-workspace', 'memory')
const other = join(home, 'projects', 'C--Users-KKI-workspace-samba-wave', 'memory')
mkdirSync(main, { recursive: true })
mkdirSync(other, { recursive: true })
writeFileSync(
  join(main, 'MEMORY.md'),
  '# Memory Index\n- [프런트 운영모드](frontend-production-mode.md) — 3000\n'
)
writeFileSync(
  join(main, 'frontend-production-mode.md'),
  '---\nname: frontend-production-mode\ndescription: "삼바 프런트(3000)는 운영모드"\n---\n노든 웹은 http://localhost:3000/samba 이다.\n설정은 /samba/settings.\n'
)
writeFileSync(
  join(main, 'coupang-ops.md'),
  '---\ndescription: 쿠팡 운영\n---\n쿠팡 계정 6개. 정산은 주정산.\n'
)
writeFileSync(join(other, 'MEMORY.md'), '# 다른 폴더 색인\n')
writeFileSync(join(main, 'notes.txt'), '읽으면 안 되는 txt')
writeFileSync(join(home, 'CLAUDE.md'), '## 언어\n- 기본 응답 언어: 한국어\n')
writeFileSync(join(home, 'secret.md'), '기억 폴더 밖')

describe('클로드 앱 기억 읽기', () => {
  it('작업 폴더마다의 memory/*.md 와 전역 CLAUDE.md 만 목록에 든다(txt·폴더 밖은 빼고)', async () => {
    const ids = (await listMemoryFiles(home)).map((f) => f.id).sort()
    expect(ids).toEqual([
      'C--Users-KKI-workspace-samba-wave/MEMORY.md',
      'C--Users-KKI-workspace/MEMORY.md',
      'C--Users-KKI-workspace/coupang-ops.md',
      'C--Users-KKI-workspace/frontend-production-mode.md',
      'CLAUDE.md'
    ])
  })

  it('찾기는 낱말을 많이 담은 파일부터, 설명줄과 맞은 줄을 보여 준다', async () => {
    const r = await searchMemory(await listMemoryFiles(home), '노든 설정 3000')
    const first = r.split('\n\n')[1]
    expect(first).toContain('## C--Users-KKI-workspace/frontend-production-mode.md')
    expect(first).toContain('description: 삼바 프런트(3000)는 운영모드')
    expect(first).toContain('- 노든 웹은 http://localhost:3000/samba 이다.')
    expect(await searchMemory(await listMemoryFiles(home), '없는낱말')).toMatch(
      /^no memory matches/
    )
    expect(await searchMemory(await listMemoryFiles(home), 'a')).toMatch(/^error/)
  })

  it('읽기는 목록의 id 만 — 이름만 주면 하나뿐일 때, 색인은 기본 작업 폴더 것', async () => {
    const files = await listMemoryFiles(home)
    expect((await readMemory(files, 'C--Users-KKI-workspace/coupang-ops.md')).result).toContain(
      '쿠팡 계정 6개'
    )
    expect((await readMemory(files, 'coupang-ops.md')).ok).toBe(true)
    expect((await readMemory(files, 'MEMORY.md')).result).toContain('# Memory Index')
    // 기억 폴더 밖·지어낸 경로는 읽지 않는다
    for (const bad of ['../secret.md', join(home, 'secret.md'), 'C--Users-KKI-workspace/notes.txt'])
      expect((await readMemory(files, bad)).ok).toBe(false)
  })

  it('긴 파일은 끊어 읽고 다음 위치를 알려 준다', async () => {
    writeFileSync(join(main, 'long.md'), 'x'.repeat(25_000))
    const files = await listMemoryFiles(home)
    const first = await readMemory(files, 'long.md')
    expect(first.result).toMatch(/call memory_read with offset 20000/)
    const second = await readMemory(files, 'long.md', 20_000)
    expect(second.result).toContain('(from char 20000)')
    expect(second.result).not.toMatch(/more chars/)
  })

  it('도구 두 개(찾기·읽기)만 — 쓰기 도구는 없고, 호출은 상한(tick)을 센다', async () => {
    const tick = vi.fn(() => null)
    const onStep = vi.fn()
    const tools = createMemoryTools({ claudeHome: home, tick, onStep }) as unknown as {
      name: string
      handler: (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>
    }[]
    expect(tools.map((t) => t.name)).toEqual(['memory_search', 'memory_read'])
    const r = await tools[0].handler({ query: '쿠팡' })
    expect(r.content[0].text).toContain('coupang-ops.md')
    expect(tick).toHaveBeenCalledTimes(1)
    expect(onStep).toHaveBeenCalledWith('기억 찾기: 쿠팡', true)
  })
})
