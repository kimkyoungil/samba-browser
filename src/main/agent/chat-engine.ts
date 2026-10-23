// 대화마다 고른 AI(Claude / Codex)와, 앱 기본 연결과 다른 AI 를 고른 대화가 쓸 모델.
//
// 왜 로컬 파일인가 — 대화 세션 연결(chat-session.ts)과 같은 이유다. 어느 AI 로 이어 갈지는 이 PC 의
// 로그인·연결 상태에 묶여 있어 다른 PC 로 동기화하지 않는다. userData 의 파일 하나로 둔다
//
// 비밀값 방어: 여기에는 대화 번호·AI 이름·모델 이름뿐이다

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { isChatEngine, type ChatEngine } from '../../shared/ai'

interface FileShape {
  chats: Record<string, ChatEngine>
  models: Partial<Record<ChatEngine, string>>
}

export class ChatEngineStore {
  private data: FileShape = { chats: {}, models: {} }

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return
      const raw = parsed as { chats?: unknown; models?: unknown }
      if (raw.chats && typeof raw.chats === 'object')
        for (const [k, v] of Object.entries(raw.chats as Record<string, unknown>))
          if (/^[0-9]+$/.test(k) && isChatEngine(v)) this.data.chats[k] = v
      if (raw.models && typeof raw.models === 'object')
        for (const [k, v] of Object.entries(raw.models as Record<string, unknown>))
          if (isChatEngine(k) && typeof v === 'string' && v.trim()) this.data.models[k] = v.trim()
    } catch {
      // 깨진 파일은 없는 것으로 본다 — 대화는 앱 기본 연결을 따른다
      this.data = { chats: {}, models: {} }
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 1))
    } catch (e: unknown) {
      console.error('대화별 AI 저장 실패', e instanceof Error ? e.message : String(e))
    }
  }

  /** 그 대화에서 고른 AI. 고른 적이 없으면 null(앱 기본 연결을 따른다) */
  get(chatId: number): ChatEngine | null {
    return this.data.chats[String(chatId)] ?? null
  }

  set(chatId: number, engine: ChatEngine): void {
    if (this.data.chats[String(chatId)] === engine) return
    this.data.chats[String(chatId)] = engine
    this.save()
  }

  clear(chatId: number): void {
    if (!(String(chatId) in this.data.chats)) return
    delete this.data.chats[String(chatId)]
    this.save()
  }

  /** 앱 기본 연결과 다른 AI 를 고른 대화가 쓸 모델(입력줄 모델 메뉴에서 고른 값). 없으면 null */
  model(engine: ChatEngine): string | null {
    return this.data.models[engine] ?? null
  }

  setModel(engine: ChatEngine, model: string): void {
    const v = model.trim()
    if (!v || this.data.models[engine] === v) return
    this.data.models[engine] = v
    this.save()
  }
}
