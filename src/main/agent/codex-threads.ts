// 대화마다 이어받을 Codex 스레드 id. 다음 말은 `codex exec resume <id>` 로 보내 앞 대화(붙인 사진 포함)를
// Codex 가 그대로 기억한다 — Claude 대화가 SDK 세션을 이어받는 것과 같은 자리다. 이 PC 에만 남는다
//
// 스레드를 연 개발자 지시의 지문도 함께 둔다 — 개발자 지시(`-c developer_instructions`)는 스레드를 처음 열 때만
// 실리고 이어받기에는 실리지 않는다(실측 codex-cli 0.160.1). 지시가 바뀐 대화(코드 모드를 켜거나 끔·폴더 바꿈)는
// 옛 스레드를 이어받지 않고 새로 열어야 새 지시가 닿는다

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Codex 스레드 id 꼴(UUID 또는 이름). 파일이 깨졌을 때 엉뚱한 값을 인자로 넘기지 않게 거른다
const THREAD_ID_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{7,79}$/
// 파일 안 지문 묶음의 열쇠(대화 번호 열쇠와 겹치지 않는다 — 옛 판은 숫자 열쇠만 읽어 이 칸을 건너뛴다)
const NOTES_KEY = '_notes'

/** 개발자 지시의 지문. 지시가 없으면 빈 문자열 */
export function developerNoteKey(note: string | undefined): string {
  const text = (note ?? '').trim()
  return text === '' ? '' : createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export class CodexThreadStore {
  private threads: Record<string, string> = {}
  private notes: Record<string, string> = {}

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
        if (/^[0-9]+$/.test(k) && typeof v === 'string' && THREAD_ID_RE.test(v)) this.threads[k] = v
      const notes = (parsed as Record<string, unknown>)[NOTES_KEY]
      if (notes && typeof notes === 'object')
        for (const [k, v] of Object.entries(notes as Record<string, unknown>))
          if (/^[0-9]+$/.test(k) && typeof v === 'string' && /^[0-9a-f]{16}$/.test(v))
            this.notes[k] = v
    } catch {
      // 깨진 파일은 없는 것으로 본다 — 다음 말은 새 스레드 + 앞부분 요약으로 시작한다
      this.threads = {}
      this.notes = {}
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(
        this.file,
        JSON.stringify({ ...this.threads, [NOTES_KEY]: this.notes }, null, 1)
      )
    } catch (e: unknown) {
      console.error('Codex 스레드 저장 실패', e instanceof Error ? e.message : String(e))
    }
  }

  /** 그 대화가 이어받을 스레드. 없으면 null(새 스레드로 시작) */
  get(chatId: number): string | null {
    return this.threads[String(chatId)] ?? null
  }

  /** 그 대화 스레드를 연 개발자 지시의 지문(developerNoteKey). 지시 없이 열었으면 빈 문자열 */
  noteOf(chatId: number): string {
    return this.notes[String(chatId)] ?? ''
  }

  set(chatId: number, threadId: string, noteKey = ''): void {
    const id = String(chatId)
    if (!THREAD_ID_RE.test(threadId)) return
    if (this.threads[id] === threadId && (this.notes[id] ?? '') === noteKey) return
    this.threads[id] = threadId
    if (noteKey) this.notes[id] = noteKey
    else delete this.notes[id]
    this.save()
  }

  clear(chatId: number): void {
    const id = String(chatId)
    if (!(id in this.threads) && !(id in this.notes)) return
    delete this.threads[id]
    delete this.notes[id]
    this.save()
  }
}
