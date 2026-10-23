// 지난 대화 검색 — 제목·내용에서 찾고, 지운 것·와일드카드는 거른다
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, type Db } from '../src/main/db/client'
import { ChatRepo, likePattern } from '../src/main/chat/repo'

describe('지난 대화 검색', () => {
  let db: Db
  let repo: ChatRepo
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new ChatRepo(db)
    repo.setWorkspaceScope({ id: 1, isDefault: true })
  })
  afterEach(() => db.close())

  it('제목이나 대화 내용에 든 대화를 최근 순으로 찾는다', () => {
    const a = repo.create('쿠팡 주문 확인', 1000)
    const b = repo.create('점심 메뉴', 2000)
    repo.append({ chatId: b.id, role: 'assistant', content: '쿠팡 로켓배송은 내일 와요' }, 3000)
    repo.create('날씨', 4000)
    expect(repo.search('쿠팡').map((c) => c.id)).toEqual([b.id, a.id])
    expect(repo.search('없는말')).toEqual([])
  })

  it('검색어가 비면 그냥 최근 목록, 개수 상한을 지킨다', () => {
    for (let i = 0; i < 5; i++) repo.create(`대화 ${i}`, 1000 + i)
    expect(repo.search('   ', 3)).toHaveLength(3)
    expect(repo.search('대화', 2)).toHaveLength(2)
  })

  it('지운 대화·지운 메시지는 찾지 않는다', () => {
    const a = repo.create('살아 있음', 1000)
    const b = repo.create('지울 대화', 2000)
    repo.append({ chatId: b.id, role: 'user', content: '비밀 단어' }, 2100)
    repo.remove(b.id, 3000)
    repo.append({ chatId: a.id, role: 'user', content: '보통 말' }, 3100)
    expect(repo.search('비밀')).toEqual([])
    expect(repo.search('지울')).toEqual([])
  })

  it('%·_ 는 와일드카드가 아니라 글자 그대로 찾는다', () => {
    repo.create('할인 50% 쿠폰', 1000)
    repo.create('할인 500원 쿠폰', 2000)
    repo.create('file_name 정리', 3000)
    repo.create('filexname 정리', 4000)
    expect(repo.search('50%').map((c) => c.title)).toEqual(['할인 50% 쿠폰'])
    expect(repo.search('file_name').map((c) => c.title)).toEqual(['file_name 정리'])
    expect(likePattern('a%b_c\\')).toBe('%a\\%b\\_c\\\\%')
  })
})
