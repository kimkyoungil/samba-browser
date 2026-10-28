// AI 채팅 저장소 — 대화·메시지를 로컬 DB 에 담고, 변경 로그(outbox)를 남긴다.
//
// 비밀값 방어
// - 메시지 본문은 사용자가 친 글과 AI 가 쓴 글뿐이다(평문 저장 — 채팅은 비밀값이 아니다)
// - 진행 로그는 저장 직전 sanitizeSteps 로 label/ok/key 만 남긴다.
//   fill_secret·login 은 라벨에 평문을 넣지 않으므로(도구 쪽 보장) 값이 흘러들 경로가 없다

import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { Db } from '../db/client'
import { chatMessages, chats } from '../db/schema'
import {
  isChatRole,
  sanitizeSteps,
  type AppendMessageInput,
  type ChatDetailDto,
  type ChatDto,
  type ChatMessageDto,
  type ChatRole,
  type ChatStepDto
} from '../../shared/chat'
import type { OutboxRecorder, WorkspaceScope } from '../../shared/sync'

/** 목록 기본 개수(사이드바가 쓰는 값은 shared/chat.ts 의 RECENT_CHAT_LIMIT) */
const DEFAULT_LIST_LIMIT = 50
/** 검색어 상한(글자) — 그보다 긴 값은 자른다 */
export const CHAT_SEARCH_MAX = 100

/** 가져온 말 한 줄 — 원래 앱에서 찍힌 시각을 그대로 쓴다 */
export interface ImportMessageInput {
  role: ChatRole
  content: string
  createdAt: number
}

/** LIKE 의 와일드카드(% _)와 탈출 문자를 글자 그대로 찾게 바꾼다 */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export class ChatRepo {
  // 동기화 변경 로그 훅. 주입하지 않으면 아무 일도 하지 않는다(동기화를 끈 상태)
  private outbox: OutboxRecorder | null = null

  // 현재 작업공간. null 이면 범위 제한 없이 전부 본다
  private scope: WorkspaceScope | null = null

  constructor(private readonly db: Db) {}

  private get d(): Db['drizzle'] {
    return this.db.drizzle
  }

  setOutboxRecorder(recorder: OutboxRecorder | null): void {
    this.outbox = recorder
  }

  setWorkspaceScope(scope: WorkspaceScope | null): void {
    this.scope = scope
  }

  /** 새 대화에 붙일 작업공간 id */
  private get scopeId(): number | null {
    return this.scope ? this.scope.id : null
  }

  /** 기본 작업공간에서는 작업공간이 없던 시절의 대화(NULL)도 함께 보인다 */
  private scopeWhere(): SQL | undefined {
    if (!this.scope) return undefined
    if (this.scope.isDefault)
      return or(isNull(chats.workspaceId), eq(chats.workspaceId, this.scope.id))
    return eq(chats.workspaceId, this.scope.id)
  }

  /** 조회 조건 = 작업공간 범위 + 살아 있는 행(tombstone 제외) */
  private visibleWhere(): SQL {
    const scope = this.scopeWhere()
    const alive = isNull(chats.deletedAt)
    return scope ? (and(scope, alive) as SQL) : alive
  }

  private record(table: 'chats' | 'chat_messages', id: number, op: 'upsert' | 'delete'): void {
    this.outbox?.(table, String(id), op)
  }

  // --- 대화 -----------------------------------------------------------------

  /** 대화 목록 — 고정한 대화를 먼저(최근에 고정한 순), 나머지는 최근에 고친 순 */
  list(limit: number = DEFAULT_LIST_LIMIT): ChatDto[] {
    return this.d
      .select()
      .from(chats)
      .where(this.visibleWhere())
      .orderBy(sql`${chats.pinnedAt} IS NULL`, desc(chats.pinnedAt), desc(chats.updatedAt))
      .limit(Math.max(1, limit))
      .all()
      .map(toChatDto)
  }

  /**
   * 제목이나 메시지 내용에 검색어가 든 대화를 최근 순으로. 검색어가 비면 그냥 목록.
   * 지운 대화·지운 메시지와 다른 작업공간의 대화는 찾지 않는다
   */
  search(query: string, limit: number = DEFAULT_LIST_LIMIT): ChatDto[] {
    const q = query.trim().slice(0, CHAT_SEARCH_MAX)
    if (!q) return this.list(limit)
    const pattern = likePattern(q)
    const matches = (col: typeof chats.title | typeof chatMessages.content): SQL =>
      sql`${col} LIKE ${pattern} ESCAPE '\\'`
    const inMessages = this.d
      .select({ id: chatMessages.chatId })
      .from(chatMessages)
      .where(and(isNull(chatMessages.deletedAt), matches(chatMessages.content)))
    return this.d
      .select()
      .from(chats)
      .where(and(this.visibleWhere(), or(matches(chats.title), inArray(chats.id, inMessages))))
      .orderBy(desc(chats.updatedAt))
      .limit(Math.max(1, limit))
      .all()
      .map(toChatDto)
  }

  /** 대화를 새로 만든다. 제목이 비어 있으면 호출부가 준 기본 문구를 그대로 쓴다 */
  create(title: string, now: number = Date.now()): ChatDto {
    const inserted = this.d
      .insert(chats)
      .values({
        title,
        workspaceId: this.scopeId,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .all()
    this.db.scheduleSave()
    const row = inserted[0]
    this.record('chats', row.id, 'upsert')
    return toChatDto(row)
  }

  /** 대화 한 건 + 메시지 전체. 없거나 지워졌으면 null */
  get(chatId: number): ChatDetailDto | null {
    const chat = this.findVisible(chatId)
    if (!chat) return null
    return { chat: toChatDto(chat), messages: this.messages(chatId) }
  }

  /** 대화 제목(메시지는 읽지 않는다). 없거나 지워졌으면 null */
  title(chatId: number): string | null {
    return this.findVisible(chatId)?.title ?? null
  }

  /** 대화가 (이 작업공간에) 살아 있는가 — 메시지는 읽지 않는다 */
  exists(chatId: number): boolean {
    return this.findVisible(chatId) !== null
  }

  /** 대화의 메시지를 시간순으로 돌려준다(지워진 메시지는 빼고) */
  messages(chatId: number): ChatMessageDto[] {
    return this.d
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), isNull(chatMessages.deletedAt)))
      .all()
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
      .map(toMessageDto)
  }

  rename(chatId: number, title: string, now: number = Date.now()): ChatDto | null {
    const chat = this.findVisible(chatId)
    if (!chat) return null
    this.d.update(chats).set({ title, updatedAt: now }).where(eq(chats.id, chatId)).run()
    this.db.scheduleSave()
    this.record('chats', chatId, 'upsert')
    return { ...toChatDto(chat), title, updatedAt: now }
  }

  /**
   * 대화를 사이드바 맨 위에 고정하거나 푼다. 대화의 수정 시각은 건드리지 않는다(풀면 원래 자리로 간다).
   * 이 PC 에만 남는 칸이라 변경 로그를 남기지 않는다. 대화가 없으면 null
   */
  setPinned(chatId: number, pinned: boolean, now: number = Date.now()): ChatDto | null {
    const chat = this.findVisible(chatId)
    if (!chat) return null
    const pinnedAt = pinned ? now : null
    this.d.update(chats).set({ pinnedAt }).where(eq(chats.id, chatId)).run()
    this.db.scheduleSave()
    return toChatDto({ ...chat, pinnedAt })
  }

  /**
   * 대화를 지운다 — 물리 삭제가 아니라 삭제 표식(tombstone)을 찍는다.
   * 딸린 메시지도 함께 표식을 받아야 다른 PC 에서도 사라진다.
   * 변경 로그는 **표식을 찍기 전에** 남겨야 스냅샷을 뜰 수 있다
   */
  remove(chatId: number, now: number = Date.now()): boolean {
    const chat = this.findVisible(chatId)
    if (!chat) return false
    const rows = this.d
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), isNull(chatMessages.deletedAt)))
      .all()
    for (const row of rows) {
      this.record('chat_messages', row.id, 'delete')
      this.d
        .update(chatMessages)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(chatMessages.id, row.id))
        .run()
    }
    this.record('chats', chatId, 'delete')
    this.d.update(chats).set({ deletedAt: now, updatedAt: now }).where(eq(chats.id, chatId)).run()
    this.db.scheduleSave()
    return true
  }

  /**
   * 한 메시지부터 대화 끝까지 지운다(보낸 말 고쳐 다시 보내기·답 다시 받기). 순서는 messages() 와 같은
   * 시간순이다 — 다른 PC 에서 동기화로 들어온 줄도 같은 줄 세우기로 자른다. remove 처럼 삭제 표식을 찍고,
   * 변경 로그는 표식 전에 남긴다. 지운 줄 수(대화나 그 메시지가 없으면 0)
   */
  truncateFrom(chatId: number, messageId: number, now: number = Date.now()): number {
    if (!this.findVisible(chatId)) return 0
    const rows = this.messages(chatId)
    const at = rows.findIndex((row) => row.id === messageId)
    if (at < 0) return 0
    const gone = rows.slice(at)
    for (const row of gone) {
      this.record('chat_messages', row.id, 'delete')
      this.d
        .update(chatMessages)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(chatMessages.id, row.id))
        .run()
    }
    this.d.update(chats).set({ updatedAt: now }).where(eq(chats.id, chatId)).run()
    this.record('chats', chatId, 'upsert')
    this.db.scheduleSave()
    return gone.length
  }

  // --- 메시지 ---------------------------------------------------------------

  /** 메시지를 덧붙이고 대화의 수정 시각을 올린다. 대화가 없으면 null */
  append(input: AppendMessageInput, now: number = Date.now()): ChatMessageDto | null {
    if (!isChatRole(input.role)) throw new Error('알 수 없는 메시지 역할입니다')
    const chat = this.findVisible(input.chatId)
    if (!chat) return null
    const steps = sanitizeSteps(input.steps)
    const inserted = this.d
      .insert(chatMessages)
      .values({
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        // 빈 배열도 "스텝이 없었다"는 사실이라 그대로 남긴다. 아예 없으면 NULL
        steps: steps === null ? null : JSON.stringify(steps),
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .all()
    this.d.update(chats).set({ updatedAt: now }).where(eq(chats.id, input.chatId)).run()
    this.db.scheduleSave()
    const row = inserted[0]
    this.record('chat_messages', row.id, 'upsert')
    this.record('chats', input.chatId, 'upsert')
    return toMessageDto(row)
  }

  // --- 가져오기(다른 앱의 대화) ------------------------------------------------

  /**
   * 다른 앱에서 가져온 대화를 원래 시각 그대로 만든다 — 대화의 만든·고친 시각은 첫·마지막 말 시각이라
   * 목록에서 실제 날짜 자리에 선다. 말은 시각순으로 와야 한다(같은 시각은 넣은 순서로 선다)
   */
  importChat(title: string, messages: ImportMessageInput[], now: number = Date.now()): ChatDto {
    const first = messages[0]?.createdAt ?? now
    const last = messages[messages.length - 1]?.createdAt ?? now
    const row = this.d
      .insert(chats)
      .values({ title, workspaceId: this.scopeId, createdAt: first, updatedAt: last })
      .returning()
      .all()[0]
    this.insertImported(row.id, messages)
    this.record('chats', row.id, 'upsert')
    this.db.scheduleSave()
    return toChatDto(row)
  }

  /**
   * 이미 있는 대화에 가져온 말을 원래 시각으로 덧붙인다. 대화의 고친 시각은 더 늦을 때만 올린다.
   * 넣은 줄 수(대화가 없으면 0)
   */
  importMessages(chatId: number, messages: ImportMessageInput[]): number {
    const chat = this.findVisible(chatId)
    if (!chat || messages.length === 0) return 0
    this.insertImported(chatId, messages)
    const last = messages[messages.length - 1].createdAt
    if (last > chat.updatedAt)
      this.d.update(chats).set({ updatedAt: last }).where(eq(chats.id, chatId)).run()
    this.record('chats', chatId, 'upsert')
    this.db.scheduleSave()
    return messages.length
  }

  private insertImported(chatId: number, messages: ImportMessageInput[]): void {
    for (const m of messages) {
      if (!isChatRole(m.role)) throw new Error('알 수 없는 메시지 역할입니다')
      const row = this.d
        .insert(chatMessages)
        .values({
          chatId,
          role: m.role,
          content: m.content,
          steps: null,
          createdAt: m.createdAt,
          updatedAt: m.createdAt
        })
        .returning({ id: chatMessages.id })
        .all()[0]
      this.record('chat_messages', row.id, 'upsert')
    }
  }

  // --- 내부 -----------------------------------------------------------------

  private findVisible(chatId: number): typeof chats.$inferSelect | null {
    const row = this.d
      .select()
      .from(chats)
      .where(and(eq(chats.id, chatId), this.visibleWhere()))
      .get()
    return row ?? null
  }
}

function toChatDto(row: typeof chats.$inferSelect): ChatDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pinned: row.pinnedAt !== null
  }
}

function toMessageDto(row: typeof chatMessages.$inferSelect): ChatMessageDto {
  return {
    id: row.id,
    chatId: row.chatId,
    role: isChatRole(row.role) ? row.role : 'system',
    content: row.content,
    steps: parseSteps(row.steps),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** 저장된 진행 로그 JSON 을 읽는다. 깨져 있으면 없는 것으로 본다 */
export function parseSteps(raw: string | null): ChatStepDto[] | null {
  if (!raw) return null
  try {
    return sanitizeSteps(JSON.parse(raw))
  } catch {
    return null
  }
}
