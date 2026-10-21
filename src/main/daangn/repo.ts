// 당근 계정·답변 템플릿 저장소. 전부 PC 로컬 전용이라 동기화하지 않는다
// (SYNC_TABLES 에 넣지 않는다 — tests/daangn-repo.test.ts 에서 단언).
// 로그인 세션(쿠키)은 여기 없고 계정의 파티션 폴더에만 있다. 여기에는 파티션 이름만 남긴다

import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { daangnAccounts, daangnTemplates } from '../db/schema'
import {
  DAANGN_ACCOUNT_STATES,
  DAANGN_TEMPLATE_MAX,
  type DaangnAccountState,
  type DaangnTemplateDto
} from '../../shared/daangn'

export interface DaangnAccountRow {
  id: number
  label: string
  partition: string
  displayName: string
  profileImage: string | null
  state: DaangnAccountState
  lastSeenAt: number
  createdAt: number
}

function toState(raw: string): DaangnAccountState {
  return (DAANGN_ACCOUNT_STATES as readonly string[]).includes(raw)
    ? (raw as DaangnAccountState)
    : 'loading'
}

function toAccountRow(r: typeof daangnAccounts.$inferSelect): DaangnAccountRow {
  return {
    id: r.id,
    label: r.label,
    partition: r.partition,
    displayName: r.displayName,
    profileImage: r.profileImage,
    state: toState(r.state),
    lastSeenAt: r.lastSeenAt,
    createdAt: r.createdAt
  }
}

export class DaangnRepo {
  constructor(private readonly db: Db) {}

  private get d(): Db['drizzle'] {
    return this.db.drizzle
  }

  // --- 계정 -----------------------------------------------------------------

  /**
   * 계정을 만든다. 파티션 이름은 id 가 정해진 뒤 `${partitionPrefix}__daangn-${id}__` 로 채운다 —
   * `__…__` 는 내부용 프로필 규칙이라 사용자 프로필 목록에 보이지 않는다.
   * 별칭이 비면 `계정 N`, 같은 별칭은 막지 않는다
   */
  addAccount(input: { label: string; partitionPrefix: string }): DaangnAccountRow {
    const now = Date.now()
    // 파티션은 unique 라 id 를 알기 전에는 임시 값으로 넣고 바로 바꾼다
    const temp = `__pending-${now}-${Math.random().toString(36).slice(2)}`
    const inserted = this.d
      .insert(daangnAccounts)
      .values({ label: input.label.trim(), partition: temp, createdAt: now })
      .returning()
      .all()[0]
    const label = input.label.trim() || `계정 ${inserted.id}`
    const partition = `${input.partitionPrefix}__daangn-${inserted.id}__`
    this.d
      .update(daangnAccounts)
      .set({ label, partition })
      .where(eq(daangnAccounts.id, inserted.id))
      .run()
    this.db.scheduleSave()
    return toAccountRow({ ...inserted, label, partition })
  }

  listAccounts(): DaangnAccountRow[] {
    return this.d.select().from(daangnAccounts).orderBy(asc(daangnAccounts.id)).all().map(toAccountRow)
  }

  setLabel(id: number, label: string): void {
    this.d.update(daangnAccounts).set({ label: label.trim() || `계정 ${id}` }).where(eq(daangnAccounts.id, id)).run()
    this.db.scheduleSave()
  }

  setIdentity(id: number, displayName: string, profileImage: string | null): void {
    this.d
      .update(daangnAccounts)
      .set({ displayName, profileImage })
      .where(eq(daangnAccounts.id, id))
      .run()
    this.db.scheduleSave()
  }

  setState(id: number, state: DaangnAccountState, at: number): void {
    this.d.update(daangnAccounts).set({ state, lastSeenAt: at }).where(eq(daangnAccounts.id, id)).run()
    this.db.scheduleSave()
  }

  removeAccount(id: number): void {
    this.d.delete(daangnAccounts).where(eq(daangnAccounts.id, id)).run()
    this.db.scheduleSave()
  }

  // --- 템플릿 ---------------------------------------------------------------

  listTemplates(): DaangnTemplateDto[] {
    return this.d
      .select()
      .from(daangnTemplates)
      .orderBy(asc(daangnTemplates.sortOrder), asc(daangnTemplates.id))
      .all()
      .map((r) => ({ id: r.id, text: r.text, sortOrder: r.sortOrder }))
  }

  /** 새로 만들거나(id 없음) 글을 고친다. 앞뒤 공백은 지우고 줄바꿈·이모지는 그대로 둔다 */
  saveTemplate(input: { id?: number; text: string }): DaangnTemplateDto {
    const text = input.text.trim()
    if (!text) throw new Error('템플릿 글이 비어 있어요')
    if (text.length > DAANGN_TEMPLATE_MAX) {
      throw new Error(`템플릿은 ${DAANGN_TEMPLATE_MAX}자까지예요`)
    }
    if (input.id !== undefined) {
      this.d.update(daangnTemplates).set({ text }).where(eq(daangnTemplates.id, input.id)).run()
      this.db.scheduleSave()
      const row = this.d.select().from(daangnTemplates).where(eq(daangnTemplates.id, input.id)).get()
      if (!row) throw new Error('없는 템플릿이에요')
      return { id: row.id, text: row.text, sortOrder: row.sortOrder }
    }
    const last = this.listTemplates().reduce((m, t) => Math.max(m, t.sortOrder), 0)
    const row = this.d
      .insert(daangnTemplates)
      .values({ text, sortOrder: last + 1, createdAt: Date.now() })
      .returning()
      .all()[0]
    this.db.scheduleSave()
    return { id: row.id, text: row.text, sortOrder: row.sortOrder }
  }

  deleteTemplate(id: number): void {
    this.d.delete(daangnTemplates).where(eq(daangnTemplates.id, id)).run()
    this.db.scheduleSave()
  }

  /** 주어진 id 순서대로 sortOrder 를 다시 매긴다. 모르는 id 는 건너뛰고 빠진 템플릿은 뒤에 붙는다 */
  reorderTemplates(ids: readonly number[]): void {
    const known = new Set(this.listTemplates().map((t) => t.id))
    const order = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i)
    for (const t of this.listTemplates()) if (!order.includes(t.id)) order.push(t.id)
    order.forEach((id, i) => {
      this.d.update(daangnTemplates).set({ sortOrder: i + 1 }).where(eq(daangnTemplates.id, id)).run()
    })
    this.db.scheduleSave()
  }
}
