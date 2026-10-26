// 대화마다 이어받을 Codex 스레드 id. 다음 말은 `codex exec resume <id>` 로 보내 앞 대화(붙인 사진 포함)를
// Codex 가 그대로 기억한다 — Claude 대화가 SDK 세션을 이어받는 것과 같은 자리다. 이 PC 에만 남는다

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Codex 스레드 id 꼴(UUID 또는 이름). 파일이 깨졌을 때 엉뚱한 값을 인자로 넘기지 않게 거른다
const THREAD_ID_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{7,79}$/

export class CodexThreadStore {
  private threads: Record<string, string> = {}

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
    } catch {
      // 깨진 파일은 없는 것으로 본다 — 다음 말은 새 스레드 + 앞부분 요약으로 시작한다
      this.threads = {}
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.threads, null, 1))
    } catch (e: unknown) {
      console.error('Codex 스레드 저장 실패', e instanceof Error ? e.message : String(e))
    }
  }

  /** 그 대화가 이어받을 스레드. 없으면 null(새 스레드로 시작) */
  get(chatId: number): string | null {
    return this.threads[String(chatId)] ?? null
  }

  set(chatId: number, threadId: string): void {
    if (!THREAD_ID_RE.test(threadId) || this.threads[String(chatId)] === threadId) return
    this.threads[String(chatId)] = threadId
    this.save()
  }

  clear(chatId: number): void {
    if (!(String(chatId) in this.threads)) return
    delete this.threads[String(chatId)]
    this.save()
  }
}
