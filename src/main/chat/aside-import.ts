// Aside 대화 내보내기를 노든 대화방으로 옮긴다.
//
// 내보내기 꼴(Aside 가 만든 전체대화.txt·채팅방별/*.md):
//   # 방 제목
//   - 기록 ID: 7qgDWkPxFvyfXRtV            ← 방 머리(제목 바로 아래 몇 줄 안에 기록 ID)
//   ## 0001 · 2026-09-17 23:16:29 · 사용자   ← 말 머리(시각은 Asia/Seoul, 역할은 사용자·AI 둘뿐)
//   ---                                     ← 방 사이 구분선
//
// 순서: 일하는 중에 끼어들어 보낸 말은 앞 답보다 이른 시각으로 찍혀 있다(답은 끝난 시각으로 찍힌다).
// 노든은 말을 시각순으로 세우므로, 기록 순서를 지키게 앞 말보다 이른 시각은 앞 말 시각으로 끌어올린다
// (같은 시각은 넣은 순서로 선다).
//
// 다시 가져오기: 가져온 방은 장부(aside-imports.json)에 Aside 기록 ID → 노든 대화 번호·옮긴 말 수로 남긴다.
// 다시 가져오면 그 뒤에 생긴 말만 덧붙인다(방을 지웠으면 새로 만든다)

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { titleFromMessage, type ChatImportPreview, type ChatImportResult } from '../../shared/chat'
import { generatedImageMarkdown } from '../../shared/generated-image'
import { GENERATED_IMAGE_MAX_BYTES } from '../agent/codex-images'
import { tr } from '../i18n'
import type { ChatRepo, ImportMessageInput } from './repo'

/** 가져온 방 하나 */
export interface AsideRecord {
  /** Aside 기록 ID(다시 가져올 때 같은 방을 알아보는 열쇠) */
  id: string
  /** 내보내기에 적힌 제목 */
  title: string
  messages: ImportMessageInput[]
}

const RECORD_ID_RE = /^- 기록 ID: ([0-9A-Za-z_-]{4,64})\s*$/
// '# 제목' 아래 이 줄 수 안에 기록 ID 가 있어야 방 머리다(AI 답 속 '# 제목' 줄과 가른다)
const RECORD_ID_LOOKAHEAD = 4
const MESSAGE_HEAD_RE =
  /^## \d{1,6} · (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) · (사용자|AI)\s*$/
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000
const BOM = 0xfeff

/** 내보내기 글을 방·말로 가른다. 말이 하나도 없는 방은 뺀다 */
export function parseAsideExport(text: string): AsideRecord[] {
  // 파일 첫 BOM 은 떼고 줄바꿈은 \n 하나로
  const body = text.charCodeAt(0) === BOM ? text.slice(1) : text
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const records: AsideRecord[] = []
  const seen = new Set<string>()
  let record: AsideRecord | null = null
  let message: { role: 'user' | 'assistant'; at: number; body: string[] } | null = null
  const flushMessage = (): void => {
    if (record && message) {
      const content = cleanBody(message.body)
      if (content) record.messages.push({ role: message.role, content, createdAt: message.at })
    }
    message = null
  }
  const flushRecord = (): void => {
    flushMessage()
    // 같은 방이 두 번 들어 있으면 처음 것만 쓴다
    if (record && record.messages.length > 0 && !seen.has(record.id)) {
      seen.add(record.id)
      records.push(record)
    }
    record = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('# ')) {
      const id = recordIdBelow(lines, i)
      if (id) {
        flushRecord()
        record = { id, title: line.slice(2).trim(), messages: [] }
        continue
      }
    }
    const head = record ? MESSAGE_HEAD_RE.exec(line) : null
    if (head) {
      flushMessage()
      const [y, mo, d, h, mi, s] = head.slice(1, 7).map(Number)
      message = {
        role: head[7] === '사용자' ? 'user' : 'assistant',
        at: Date.UTC(y, mo - 1, d, h, mi, s) - SEOUL_OFFSET_MS,
        body: []
      }
      continue
    }
    // 방 머리의 '- 기록 ID'·'- 구분' 같은 줄은 말 머리 전이라 버려진다
    if (message) message.body.push(line)
  }
  flushRecord()
  for (const r of records) {
    let prev = -Infinity
    for (const m of r.messages) {
      if (m.createdAt < prev) m.createdAt = prev
      prev = m.createdAt
    }
  }
  return records
}

function recordIdBelow(lines: string[], at: number): string | null {
  for (let j = at + 1; j <= at + RECORD_ID_LOOKAHEAD && j < lines.length; j++) {
    const m = RECORD_ID_RE.exec(lines[j])
    if (m) return m[1]
  }
  return null
}

// 말 본문 앞뒤의 빈 줄과 방 끝 구분선('---')을 뗀다
function cleanBody(body: string[]): string {
  const lines = [...body]
  while (lines.length > 0 && ['', '---'].includes(lines[lines.length - 1].trim())) lines.pop()
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  return lines.join('\n')
}

// 제목 없이 남은 보관 기록('과거 보관 기록 2026-09-17 (ID)')은 첫 사용자 말로 이름을 짓는다
const ARCHIVE_TITLE_RE = /^과거 보관 기록 \d{4}-\d{2}-\d{2}/
const ATTACHMENT_LINE_RE = /^\[첨부 \d+개:[^\]]*\]$/
const RECORD_TITLE_MAX = 100

/** 노든 대화방 제목 */
export function asideChatTitle(record: AsideRecord): string {
  const own = record.title.trim()
  if (own && !ARCHIVE_TITLE_RE.test(own)) return own.slice(0, RECORD_TITLE_MAX)
  const firstUser = record.messages.find((m) => m.role === 'user')
  // 첨부 표시 줄('[첨부 1개: …]')은 제목감이 아니다
  const text = (firstUser?.content ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '' && !ATTACHMENT_LINE_RE.test(l.trim()))
    .join('\n')
  return titleFromMessage(text) || own.replace(/\s*\([0-9A-Za-z_-]+\)$/, '') || 'Aside'
}

// 답 글 속 이 PC 그림 경로(Aside 가 찍은 화면 등). 노든 화면은 로컬 경로를 열지 않는다
const LOCAL_IMAGE_RE = /!\[([^\]\n]*)\]\(<?([A-Za-z]:[\\/][^)\n<>]*?\.(?:png|jpe?g|webp))>?\)/gi

/**
 * 답 글 속 로컬 그림을 노든 그림 폴더로 옮기고 noden-image:// 주소로 바꾼다(Codex 가 그린 그림과 같은 자리).
 * 옮기지 못한 그림(파일이 없거나 너무 큼)은 그대로 둔다 — 화면은 설명 글자만 보인다
 */
export async function localizeImages(
  content: string,
  copy: (path: string) => Promise<string | null>
): Promise<{ content: string; images: number }> {
  const found = [...content.matchAll(LOCAL_IMAGE_RE)]
  if (found.length === 0) return { content, images: 0 }
  let out = ''
  let at = 0
  let images = 0
  for (const m of found) {
    const name = await copy(m[2])
    out += content.slice(at, m.index)
    if (name) {
      out += generatedImageMarkdown(name, m[1].trim() || '그림')
      images++
    } else out += m[0]
    at = (m.index ?? 0) + m[0].length
  }
  return { content: out + content.slice(at), images }
}

/** 그림 한 장을 노든 이름 꼴(UUID)로 옮기는 함수. 같은 그림은 한 번만 옮긴다 */
export function imageCopier(destDir: string): (src: string) => Promise<string | null> {
  const done = new Map<string, string | null>()
  return async (src) => {
    const key = src.replace(/\//g, '\\').toLowerCase()
    if (done.has(key)) return done.get(key) ?? null
    let name: string | null = null
    try {
      const info = await stat(src)
      if (info.isFile() && info.size <= GENERATED_IMAGE_MAX_BYTES) {
        name = `${randomUUID()}${extname(src).toLowerCase()}`
        await mkdir(destDir, { recursive: true })
        await copyFile(src, join(destDir, name))
      }
    } catch {
      name = null
    }
    done.set(key, name)
    return name
  }
}

const LEDGER_ID_RE = /^[0-9A-Za-z_-]{4,64}$/

/** 가져온 방 장부 — Aside 기록 ID → 노든 대화 번호·옮긴 말 수. 이 PC 에만 남는다 */
export class AsideImportLedger {
  private entries: Record<string, { chatId: number; count: number }> = {}

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const e = v as { chatId?: unknown; count?: unknown } | null
        if (
          LEDGER_ID_RE.test(k) &&
          e &&
          Number.isInteger(e.chatId) &&
          Number.isInteger(e.count) &&
          (e.count as number) >= 0
        )
          this.entries[k] = { chatId: e.chatId as number, count: e.count as number }
      }
    } catch {
      // 깨진 장부는 없는 것으로 본다 — 다음 가져오기는 방을 새로 만든다
      this.entries = {}
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.entries, null, 1))
    } catch (e: unknown) {
      console.error('Aside 가져오기 장부 저장 실패', e instanceof Error ? e.message : String(e))
    }
  }

  get(recordId: string): { chatId: number; count: number } | null {
    return this.entries[recordId] ?? null
  }

  set(recordId: string, chatId: number, count: number): void {
    this.entries[recordId] = { chatId, count }
    this.save()
  }
}

type ImportRepo = Pick<ChatRepo, 'importChat' | 'importMessages' | 'exists'>

/** 방마다 할 일 — 새로 만들지(chatId null), 이미 있는 방에 몇 번째 말부터 덧붙일지 */
interface ImportStep {
  record: AsideRecord
  chatId: number | null
  from: number
}

export class AsideImporter {
  private running = false

  constructor(
    private readonly repo: ImportRepo,
    private readonly ledger: AsideImportLedger,
    private readonly imagesDir: string
  ) {}

  /** 파일을 읽어 방·말로 가른다. 내보내기 꼴이 아니면 던진다 */
  async read(path: string): Promise<AsideRecord[]> {
    const records = parseAsideExport(await readFile(path, 'utf8'))
    if (records.length === 0) throw new Error(tr('ipc.chatImportNotAside'))
    return records
  }

  private plan(records: AsideRecord[]): ImportStep[] {
    return records.map((record) => {
      const e = this.ledger.get(record.id)
      if (e && this.repo.exists(e.chatId))
        return { record, chatId: e.chatId, from: Math.min(e.count, record.messages.length) }
      return { record, chatId: null, from: 0 }
    })
  }

  async preview(path: string): Promise<ChatImportPreview> {
    const records = await this.read(path)
    const steps = this.plan(records)
    const times = records.flatMap((r) => r.messages.map((m) => m.createdAt))
    return {
      path,
      chats: records.length,
      messages: records.reduce((n, r) => n + r.messages.length, 0),
      newChats: steps.filter((s) => s.chatId === null).length,
      appendChats: steps.filter((s) => s.chatId !== null && s.from < s.record.messages.length)
        .length,
      newMessages: steps.reduce((n, s) => n + s.record.messages.length - s.from, 0),
      from: times.length > 0 ? Math.min(...times) : null,
      to: times.length > 0 ? Math.max(...times) : null
    }
  }

  async run(path: string): Promise<ChatImportResult> {
    if (this.running) throw new Error(tr('ipc.chatImportBusy'))
    this.running = true
    try {
      const copy = imageCopier(this.imagesDir)
      const result: ChatImportResult = { createdChats: 0, appendedChats: 0, messages: 0, images: 0 }
      for (const step of this.plan(await this.read(path))) {
        const { record } = step
        const fresh = record.messages.slice(step.from)
        if (fresh.length === 0) continue
        const messages: ImportMessageInput[] = []
        for (const m of fresh) {
          const local = await localizeImages(m.content, copy)
          result.images += local.images
          messages.push({ ...m, content: local.content })
        }
        if (step.chatId === null) {
          const chat = this.repo.importChat(asideChatTitle(record), messages)
          this.ledger.set(record.id, chat.id, record.messages.length)
          result.createdChats++
        } else {
          this.repo.importMessages(step.chatId, messages)
          this.ledger.set(record.id, step.chatId, record.messages.length)
          result.appendedChats++
        }
        result.messages += messages.length
      }
      return result
    } finally {
      this.running = false
    }
  }
}

const EXPORT_NAME = '전체대화.txt'

/**
 * Aside 가 만든 대화 내보내기(전체대화.txt)를 찾는다 — ~/.aside/u/<사용자>/[agents/<에이전트>/]sessions/
 * <세션>/artifacts/[<폴더>/] 아래. 여럿이면 가장 최근 것. 없으면 null
 */
export async function findAsideExport(home: string): Promise<string | null> {
  const root = join(home, '.aside', 'u')
  const sessionRoots: string[] = []
  for (const u of await subdirs(root)) {
    sessionRoots.push(join(root, u, 'sessions'))
    for (const a of await subdirs(join(root, u, 'agents')))
      sessionRoots.push(join(root, u, 'agents', a, 'sessions'))
  }
  let best: { path: string; mtime: number } | null = null
  for (const sessions of sessionRoots) {
    for (const s of await subdirs(sessions)) {
      const artifacts = join(sessions, s, 'artifacts')
      const candidates = [
        join(artifacts, EXPORT_NAME),
        ...(await subdirs(artifacts)).map((d) => join(artifacts, d, EXPORT_NAME))
      ]
      for (const path of candidates) {
        const info = await stat(path).catch(() => null)
        if (info?.isFile() && (!best || info.mtimeMs > best.mtime))
          best = { path, mtime: info.mtimeMs }
      }
    }
  }
  return best?.path ?? null
}

async function subdirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}
