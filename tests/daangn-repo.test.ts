// 당근 계정·답변 템플릿 저장소 — PC 로컬 전용(동기화 제외)이고 템플릿 글은 그대로 보존된다
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db/client'
import { DaangnRepo } from '../src/main/daangn/repo'
import { DAANGN_TEMPLATE_MAX } from '../src/shared/daangn'
import { SYNC_TABLES } from '../src/shared/sync'

describe('DaangnRepo 계정', () => {
  let db: Db
  let repo: DaangnRepo
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new DaangnRepo(db)
  })
  afterEach(() => db.close())

  it('계정을 만들면 파티션 이름에 id 가 들어가고 상태는 loading 이다', () => {
    const a = repo.addAccount({ label: '황놀', partitionPrefix: 'persist:ws1-' })
    expect(a.partition).toBe(`persist:ws1-__daangn-${a.id}__`)
    expect(a.label).toBe('황놀')
    expect(a.state).toBe('loading')
  })

  it('별칭이 비어 있으면 "계정 N" 으로 채우고 같은 별칭 둘도 허용한다', () => {
    const a = repo.addAccount({ label: '  ', partitionPrefix: 'persist:ws1-' })
    expect(a.label).toBe(`계정 ${a.id}`)
    const b = repo.addAccount({ label: '같은이름', partitionPrefix: 'persist:ws1-' })
    const c = repo.addAccount({ label: '같은이름', partitionPrefix: 'persist:ws1-' })
    expect(b.label).toBe(c.label)
    expect(b.partition).not.toBe(c.partition)
  })

  it('목록은 id 순이고 별칭·신원·상태를 바꾸고 지울 수 있다', () => {
    const a = repo.addAccount({ label: 'A', partitionPrefix: 'p-' })
    const b = repo.addAccount({ label: 'B', partitionPrefix: 'p-' })
    repo.setLabel(a.id, '새이름')
    repo.setIdentity(b.id, '앙그류', 'https://img/x.webp')
    repo.setState(b.id, 'logged_in', 1234)
    const list = repo.listAccounts()
    expect(list.map((x) => x.id)).toEqual([a.id, b.id])
    expect(list[0].label).toBe('새이름')
    expect(list[1]).toMatchObject({ displayName: '앙그류', profileImage: 'https://img/x.webp', state: 'logged_in', lastSeenAt: 1234 })
    repo.removeAccount(a.id)
    expect(repo.listAccounts().map((x) => x.id)).toEqual([b.id])
  })
})

describe('DaangnRepo 템플릿', () => {
  let db: Db
  let repo: DaangnRepo
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new DaangnRepo(db)
  })
  afterEach(() => db.close())

  it('저장·수정·삭제하고 줄바꿈·이모지·따옴표를 그대로 보존한다', () => {
    const text = '안녕하세요 "네고" 가능해요\n두번째 줄 😀'
    const t = repo.saveTemplate({ text })
    expect(repo.listTemplates()[0].text).toBe(text)
    repo.saveTemplate({ id: t.id, text: '  바뀐 글  ' })
    expect(repo.listTemplates()[0].text).toBe('바뀐 글')
    repo.deleteTemplate(t.id)
    expect(repo.listTemplates()).toEqual([])
  })

  it('빈 글과 상한 초과 글은 거부한다', () => {
    expect(() => repo.saveTemplate({ text: '   ' })).toThrow()
    expect(() => repo.saveTemplate({ text: 'a'.repeat(DAANGN_TEMPLATE_MAX + 1) })).toThrow()
    expect(() => repo.saveTemplate({ text: 'a'.repeat(DAANGN_TEMPLATE_MAX) })).not.toThrow()
  })

  it('순서를 바꾸면 목록 순서가 따라가고 모르는 id 는 건너뛴다', () => {
    const a = repo.saveTemplate({ text: 'A' })
    const b = repo.saveTemplate({ text: 'B' })
    const c = repo.saveTemplate({ text: 'C' })
    repo.reorderTemplates([c.id, a.id, 9999, b.id])
    expect(repo.listTemplates().map((t) => t.text)).toEqual(['C', 'A', 'B'])
  })
})

describe('동기화 제외', () => {
  it('두 테이블은 SYNC_TABLES 에 없다', () => {
    const names = (SYNC_TABLES as readonly unknown[]).map((t) => String(t))
    expect(names).not.toContain('daangn_accounts')
    expect(names).not.toContain('daangn_templates')
  })
})
