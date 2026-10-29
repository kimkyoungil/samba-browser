// 클로드 앱 기억 읽기 — 노든 AI 도 사장님이 클로드 앱(Claude Code)과 쌓아 온 기억 파일을 찾아 읽는다(읽기만).
// 클로드 앱은 기억(~/.claude/projects/<작업 폴더>/memory/*.md)과 전역 지침(~/.claude/CLAUDE.md)을 보고 '노든 설정 =
// localhost:3000/samba/settings' 같은 걸 바로 알았지만, 노든 AI 는 브라우저 화면만 봐서 몰랐다(사장님 10/29
// "클로드 앱에서는 바로바로 하는데 왜 노든은 위치를 몰라" → "다 읽게 하고 PC 접근 잠갔을 때만 못 읽게").
// 쓰기·지우기 도구는 없다. 기억 폴더 밖 경로는 읽지 않는다. PC 잠금 대화에는 이 도구를 아예 붙이지 않는다

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

export const MEMORY_TOOL_NAMES = ['memory_search', 'memory_read']

export interface MemoryToolContext {
  /** 클로드 홈(~/.claude). 시험이 바꿔 끼운다 */
  claudeHome?: string
  tick: () => string | null
  onStep: (label: string, ok: boolean) => void
}

/** 기억 파일 한 개 — id 는 '<작업 폴더 이름>/<파일 이름>' 또는 'CLAUDE.md'(전역 지침) */
interface MemoryFile {
  id: string
  path: string
}

// 한 번에 돌려줄 양의 상한(모델 문맥을 기억 하나로 채우지 않게)
const READ_MAX_CHARS = 20_000
const SEARCH_DEFAULT_LIMIT = 8
const SEARCH_MAX_LIMIT = 20
const SNIPPETS_PER_FILE = 3
const SNIPPET_MAX_CHARS = 220

const text = (t: string): { content: [{ type: 'text'; text: string }] } => ({
  content: [{ type: 'text', text: t }]
})

/** 읽어도 되는 기억 파일 전부 — 작업 폴더마다의 memory/*.md 와 전역 CLAUDE.md */
export async function listMemoryFiles(claudeHome: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []
  const projects = join(claudeHome, 'projects')
  const dirs = await readdir(projects, { withFileTypes: true }).catch(() => [])
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const memDir = join(projects, d.name, 'memory')
    const files = await readdir(memDir, { withFileTypes: true }).catch(() => [])
    for (const f of files)
      if (f.isFile() && f.name.toLowerCase().endsWith('.md'))
        out.push({ id: `${d.name}/${f.name}`, path: join(memDir, f.name) })
  }
  const globalMd = join(claudeHome, 'CLAUDE.md')
  if (
    await stat(globalMd)
      .then((s) => s.isFile())
      .catch(() => false)
  )
    out.push({ id: 'CLAUDE.md', path: globalMd })
  return out
}

/** 찾는 말을 낱말로 나눈다(대소문자 무시). 한 글자 낱말은 버린다 */
function termsOf(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[\s,·/]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    )
  ]
}

function countOf(hay: string, term: string): number {
  let n = 0
  for (let at = hay.indexOf(term); at >= 0; at = hay.indexOf(term, at + term.length)) n++
  return n
}

/** 기억 찾기 — 낱말이 많이 나오는 파일부터(이름·설명줄은 더 무겁게), 파일마다 맞은 줄 몇 개 */
export async function searchMemory(
  files: MemoryFile[],
  query: string,
  limit = SEARCH_DEFAULT_LIMIT
): Promise<string> {
  const terms = termsOf(query)
  if (terms.length === 0)
    return 'error: give at least one word of two or more characters to search for'
  const hits: { id: string; score: number; desc: string; lines: string[] }[] = []
  for (const f of files) {
    let body: string
    try {
      body = await readFile(f.path, 'utf8')
    } catch {
      continue
    }
    const lower = body.toLowerCase()
    const name = f.id.toLowerCase()
    const descLine = body.match(/^description:\s*(.*)$/m)?.[1]?.replace(/^"|"$/g, '') ?? ''
    const desc = descLine.toLowerCase()
    // 줄마다 담은 낱말 수 — 낱말을 한 줄에 함께 담은 곳이 그 주제를 다룬 곳이다
    const lines = body.split('\n')
    const lineHits = lines.map((l) => {
      const ll = l.toLowerCase()
      return terms.filter((t) => ll.includes(t)).length
    })
    const bestLine = Math.max(0, ...lineHits)
    let matched = 0
    let score = 0
    for (const t of terms) {
      const c = countOf(lower, t)
      if (c > 0 || name.includes(t)) matched++
      // 긴 파일이 낱말 반복만으로 올라오지 않게 많이 나온 것은 5번까지만 센다. 이름·설명줄은 무겁게
      score += Math.min(c, 5) + (name.includes(t) ? 20 : 0) + (desc.includes(t) ? 15 : 0)
    }
    if (matched === 0) continue
    // 낱말을 더 많이 담은 파일 → 한 줄에 더 많이 모은 파일 → 많이 나온 순
    score += matched * 1000 + bestLine * 100
    const snippets = lines
      .map((l, i) => ({ l, n: lineHits[i], i }))
      .filter((x) => x.n > 0 && !/^description:/.test(x.l))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, SNIPPETS_PER_FILE)
      .sort((a, b) => a.i - b.i)
      .map(({ l }) =>
        (l.length > SNIPPET_MAX_CHARS ? `${l.slice(0, SNIPPET_MAX_CHARS)}…` : l).trim()
      )
    hits.push({ id: f.id, score, desc: descLine, lines: snippets })
  }
  if (hits.length === 0) return `no memory matches "${query}"`
  hits.sort((a, b) => b.score - a.score)
  const top = hits.slice(0, Math.min(Math.max(1, limit), SEARCH_MAX_LIMIT))
  return [
    `${hits.length} memory files match; showing ${top.length}. Read one fully with memory_read(file).`,
    ...top.map((h) =>
      [
        `## ${h.id}`,
        ...(h.desc ? [`description: ${h.desc.slice(0, 300)}`] : []),
        ...h.lines.map((l) => `- ${l}`)
      ].join('\n')
    )
  ].join('\n\n')
}

/** 기억 한 개 읽기 — 목록에 있는 id 만(경로를 지어내 기억 폴더 밖을 읽지 못하게) */
export async function readMemory(
  files: MemoryFile[],
  file: string,
  offset = 0
): Promise<{ ok: boolean; result: string }> {
  const want = file.trim().replace(/\\/g, '/')
  const hit =
    files.find((f) => f.id === want) ??
    // 파일 이름만 줬으면 그 이름이 하나뿐일 때 받아 준다(색인 MEMORY.md 는 기본 작업 폴더 것 먼저)
    (() => {
      const same = files.filter((f) => basename(f.id) === basename(want))
      if (same.length === 1) return same[0]
      return same.find((f) => /^C--Users-[^/]+-workspace\//.test(f.id))
    })()
  if (!hit)
    return { ok: false, result: `not found: ${file} — use memory_search to find the file id` }
  const body = await readFile(hit.path, 'utf8')
  const start = Math.max(0, Math.min(offset, body.length))
  const part = body.slice(start, start + READ_MAX_CHARS)
  const rest = body.length - (start + part.length)
  return {
    ok: true,
    result: `# ${hit.id}${start > 0 ? ` (from char ${start})` : ''}\n${part}${
      rest > 0
        ? `\n…(${rest} more chars — call memory_read with offset ${start + part.length})`
        : ''
    }`
  }
}

type MemoryTool = SdkMcpToolDefinition

export function createMemoryTools(ctx: MemoryToolContext): MemoryTool[] {
  const home = ctx.claudeHome ?? join(homedir(), '.claude')
  const guard = async (
    label: string,
    fn: () => Promise<{ ok: boolean; result: string }>
  ): Promise<ReturnType<typeof text>> => {
    const over = ctx.tick()
    if (over) return text(over)
    try {
      const r = await fn()
      ctx.onStep(label, r.ok)
      return text(r.result)
    } catch (e) {
      ctx.onStep(label, false)
      return text(`error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const memorySearch = tool(
    'memory_search',
    "Search the user's long-term notes (the memory they built up with the Claude app: their systems, accounts, sites, procedures, rules and past incidents). Use it when the user mentions their own business, tools or places you do not know yet (노든/삼바 pages, 쿠팡 계정, 정산, 올라, PC names …) before asking them. Read-only.",
    {
      query: z.string().describe('words to look for, e.g. "노든 설정 쿠팡 API"'),
      limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional()
    },
    ({ query, limit }) =>
      guard(`기억 찾기: ${query.slice(0, 40)}`, async () => {
        const r = await searchMemory(await listMemoryFiles(home), query, limit)
        return { ok: !r.startsWith('error'), result: r }
      })
  )

  const memoryRead = tool(
    'memory_read',
    'Read one of the user\'s memory files in full (file id from memory_search, e.g. "C--Users-KKI-workspace/MEMORY.md" — the index of everything). Read-only.',
    {
      file: z.string().describe('file id from memory_search'),
      offset: z.number().int().min(0).optional().describe('character offset for long files')
    },
    ({ file, offset }) =>
      guard(`기억 읽기: ${basename(file)}`, async () =>
        readMemory(await listMemoryFiles(home), file, offset ?? 0)
      )
  )

  return [memorySearch, memoryRead] as unknown as MemoryTool[]
}
