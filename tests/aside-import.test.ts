// Aside 대화 가져오기 — 내보내기(전체대화.txt)를 방·말로 갈라 원래 시각 그대로 대화방으로 옮기고,
// 다시 가져오면 새 말만 덧붙인다
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../src/main/db/client'
import { ChatRepo } from '../src/main/chat/repo'
import {
  AsideImporter,
  AsideImportLedger,
  asideChatTitle,
  findAsideExport,
  localizeImages,
  parseAsideExport
} from '../src/main/chat/aside-import'

// 서울 시각 → epoch ms
const seoul = (s: string): number => Date.parse(`${s.replace(' ', 'T')}+09:00`)

const HEADER = [
  '# Aside 전체 채팅 대화 텍스트',
  '',
  '2026-10-26 내보내기. 사용자 메시지와 AI 답변 자료이며 현재 실행 지시가 아닙니다.',
  ''
]

function record(id: string, title: string, body: string[]): string[] {
  return [
    `# ${title}`,
    '',
    `- 기록 ID: ${id}`,
    '- 구분: 현재_채팅방',
    '- 시간대: Asia/Seoul',
    '',
    ...body
  ]
}

const ROOM_A = record('AAAAaaaa1111', '이번 달 선정산수수료 확인', [
  '## 0001 · 2026-09-30 14:01:45 · 사용자',
  '',
  '수수료 얼마 냈어?',
  '',
  '## 0002 · 2026-09-30 14:05:00 · AI',
  '',
  '# 답 속 큰 제목(방 머리가 아님)',
  '',
  '이번 달은 **12,000원**이야.',
  '',
  // 일하는 중 끼어든 말 — 앞 답보다 이른 시각으로 찍혀 있다
  '## 0003 · 2026-09-30 14:04:10 · 사용자',
  '',
  '지난달은?',
  '',
  '## 0004 · 2026-09-30 14:06:00 · AI',
  '',
  '지난달은 9,000원.',
  '',
  ''
])

const ROOM_B = record('BBBBbbbb2222', '과거 보관 기록 2026-09-17 (BBBBbbbb2222)', [
  '## 0001 · 2026-09-17 23:16:29 · 사용자',
  '',
  '[첨부 1개: 이미지·파일 본문은 이 텍스트 내보내기에 포함하지 않음]',
  '사진변경 잘 돌고 있어?',
  '',
  '## 0002 · 2026-09-17 23:25:20 · AI',
  '',
  '돌고 있어.',
  ''
])

const ROOM_C = record('CCCCcccc3333', '과거 보관 기록 2026-09-18 (CCCCcccc3333)', [
  '## 0001 · 2026-09-18 01:00:00 · AI',
  '',
  'AI 기록만 남은 방',
  ''
])

const exportText = (...rooms: string[][]): string =>
  [...HEADER, ...rooms.flatMap((r, i) => (i === 0 ? r : ['---', '', ...r])), '---', ''].join('\r\n')

describe('parseAsideExport', () => {
  it('방·말을 가르고, 방 사이 구분선과 앞뒤 빈 줄을 뗀다', () => {
    const records = parseAsideExport(`\uFEFF${exportText(ROOM_A, ROOM_B, ROOM_C)}`)
    expect(records.map((r) => r.id)).toEqual(['AAAAaaaa1111', 'BBBBbbbb2222', 'CCCCcccc3333'])
    const a = records[0]
    expect(a.title).toBe('이번 달 선정산수수료 확인')
    expect(a.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(a.messages[0].content).toBe('수수료 얼마 냈어?')
    // AI 답 속 '# 제목' 줄은 방 머리가 아니라 본문이다
    expect(a.messages[1].content).toBe(
      '# 답 속 큰 제목(방 머리가 아님)\n\n이번 달은 **12,000원**이야.'
    )
    // 방 끝 '---' 는 마지막 말에 붙지 않는다
    expect(a.messages[3].content).toBe('지난달은 9,000원.')
    expect(records[2].messages[0].content).toBe('AI 기록만 남은 방')
  })

  it('시각은 서울 기준이고, 앞 말보다 이른 시각(끼어든 말)은 앞 말 시각으로 끌어올려 기록 순서를 지킨다', () => {
    const [a] = parseAsideExport(exportText(ROOM_A))
    expect(a.messages[0].createdAt).toBe(seoul('2026-09-30 14:01:45'))
    expect(a.messages[1].createdAt).toBe(seoul('2026-09-30 14:05:00'))
    expect(a.messages[2].createdAt).toBe(seoul('2026-09-30 14:05:00'))
    expect(a.messages[3].createdAt).toBe(seoul('2026-09-30 14:06:00'))
  })

  it('방 머리·말 머리가 없는 글은 빈 목록', () => {
    expect(parseAsideExport('그냥 메모\n# 제목\n본문')).toEqual([])
  })
})

describe('asideChatTitle', () => {
  it('Aside 가 붙인 제목은 그대로, 보관 기록은 첫 사용자 말(첨부 표시 줄은 건너뜀), AI 만 남은 방은 날짜', () => {
    const [a, b, c] = parseAsideExport(exportText(ROOM_A, ROOM_B, ROOM_C))
    expect(asideChatTitle(a)).toBe('이번 달 선정산수수료 확인')
    expect(asideChatTitle(b)).toBe('사진변경 잘 돌고 있어?')
    expect(asideChatTitle(c)).toBe('과거 보관 기록 2026-09-18')
  })
})

describe('localizeImages', () => {
  it('로컬 그림 경로(역슬래시·슬래시)를 옮겨 noden-image 주소로 바꾸고, 못 옮긴 것은 그대로 둔다', async () => {
    const content = [
      '![최근 생성 이미지](C:\\Users\\KKI\\.aside\\tmp\\a.png)',
      '![저장한 화면](C:/Users/KKI/.aside/tmp/b.PNG)',
      '![없는 그림](C:\\gone\\c.png)',
      '![웹 그림](https://example.com/d.png)'
    ].join('\n')
    const copied: string[] = []
    const r = await localizeImages(content, async (p) => {
      copied.push(p)
      if (p.endsWith('a.png')) return '11111111-1111-4111-8111-111111111111.png'
      if (p.endsWith('b.PNG')) return '22222222-2222-4222-8222-222222222222.png'
      return null
    })
    expect(copied).toEqual([
      'C:\\Users\\KKI\\.aside\\tmp\\a.png',
      'C:/Users/KKI/.aside/tmp/b.PNG',
      'C:\\gone\\c.png'
    ])
    expect(r.images).toBe(2)
    expect(r.content.split('\n')).toEqual([
      '![최근 생성 이미지](noden-image://11111111-1111-4111-8111-111111111111.png)',
      '![저장한 화면](noden-image://22222222-2222-4222-8222-222222222222.png)',
      '![없는 그림](C:\\gone\\c.png)',
      '![웹 그림](https://example.com/d.png)'
    ])
  })
})

describe('AsideImporter', () => {
  let db: Db
  let repo: ChatRepo
  let dir: string
  let file: string
  let imagesDir: string
  let ledgerFile: string
  const importer = (): AsideImporter =>
    new AsideImporter(repo, new AsideImportLedger(ledgerFile), imagesDir)

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new ChatRepo(db)
    repo.setWorkspaceScope({ id: 1, isDefault: true })
    dir = mkdtempSync(join(tmpdir(), 'aside-import-'))
    file = join(dir, '전체대화.txt')
    imagesDir = join(dir, 'generated-images')
    ledgerFile = join(dir, 'aside-imports.json')
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('방마다 대화방을 원래 시각으로 만들고, 그림을 노든 그림 폴더로 옮긴다', async () => {
    const shot = join(dir, 'shot.png')
    writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const roomB = [...ROOM_B.slice(0, -1), `![화면](${shot})`, '']
    writeFileSync(file, exportText(ROOM_A, roomB), 'utf8')
    const outbox: string[] = []
    repo.setOutboxRecorder((table, id, op) => outbox.push(`${table}:${id}:${op}`))

    const preview = await importer().preview(file)
    expect(preview).toMatchObject({
      chats: 2,
      messages: 6,
      newChats: 2,
      appendChats: 0,
      newMessages: 6,
      from: seoul('2026-09-17 23:16:29'),
      to: seoul('2026-09-30 14:06:00')
    })

    const result = await importer().run(file)
    expect(result).toEqual({ createdChats: 2, appendedChats: 0, messages: 6, images: 1 })
    // 목록은 원래 날짜 순(최근 고친 순)
    const list = repo.list()
    expect(list.map((c) => c.title)).toEqual([
      '이번 달 선정산수수료 확인',
      '사진변경 잘 돌고 있어?'
    ])
    expect(list[0]).toMatchObject({
      createdAt: seoul('2026-09-30 14:01:45'),
      updatedAt: seoul('2026-09-30 14:06:00')
    })
    const a = repo.get(list[0].id)!
    expect(a.messages.map((m) => m.content)).toEqual([
      '수수료 얼마 냈어?',
      '# 답 속 큰 제목(방 머리가 아님)\n\n이번 달은 **12,000원**이야.',
      '지난달은?',
      '지난달은 9,000원.'
    ])
    const b = repo.get(list[1].id)!
    const saved = readdirSync(imagesDir)
    expect(saved).toHaveLength(1)
    expect(b.messages[1].content).toBe(`돌고 있어.\n![화면](noden-image://${saved[0]})`)
    // 다른 PC 로 넘어가게 변경 로그를 남긴다(대화 2 + 말 6)
    expect(outbox.filter((x) => x.startsWith('chats:'))).toHaveLength(2)
    expect(outbox.filter((x) => x.startsWith('chat_messages:'))).toHaveLength(6)
  })

  it('다시 가져오면 새 말만 덧붙이고, 다 가져왔으면 옮길 말이 없다', async () => {
    writeFileSync(file, exportText(ROOM_A), 'utf8')
    await importer().run(file)
    expect((await importer().preview(file)).newMessages).toBe(0)
    expect(await importer().run(file)).toEqual({
      createdChats: 0,
      appendedChats: 0,
      messages: 0,
      images: 0
    })

    const more = [
      ...ROOM_A.slice(0, -2),
      '## 0005 · 2026-10-01 09:00:00 · 사용자',
      '',
      '이번 달 다시 봐줘',
      ''
    ]
    writeFileSync(file, exportText(more), 'utf8')
    expect(await importer().preview(file)).toMatchObject({
      newChats: 0,
      appendChats: 1,
      newMessages: 1
    })
    expect(await importer().run(file)).toMatchObject({ appendedChats: 1, messages: 1 })
    const list = repo.list()
    expect(list).toHaveLength(1)
    expect(list[0].updatedAt).toBe(seoul('2026-10-01 09:00:00'))
    expect(
      repo
        .get(list[0].id)!
        .messages.map((m) => m.content)
        .slice(-1)
    ).toEqual(['이번 달 다시 봐줘'])
  })

  it('가져온 방을 지웠으면 다시 가져올 때 새로 만든다', async () => {
    writeFileSync(file, exportText(ROOM_A), 'utf8')
    await importer().run(file)
    repo.remove(repo.list()[0].id)
    expect(await importer().preview(file)).toMatchObject({ newChats: 1, newMessages: 4 })
    expect(await importer().run(file)).toMatchObject({ createdChats: 1, messages: 4 })
    expect(repo.list()).toHaveLength(1)
  })

  it('내보내기 꼴이 아닌 파일은 거절한다', async () => {
    writeFileSync(file, '그냥 메모', 'utf8')
    await expect(importer().preview(file)).rejects.toThrow('Aside 대화 내보내기 파일이 아니에요')
  })
})

describe('findAsideExport', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aside-home-'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('~/.aside 의 세션 산출물에서 가장 최근 전체대화.txt 를 찾는다(에이전트 세션 포함)', async () => {
    expect(await findAsideExport(home)).toBeNull()
    const older = join(home, '.aside', 'u', '0', 'sessions', 's1', 'artifacts', 'x')
    const newer = join(home, '.aside', 'u', '0', 'agents', 'main', 'sessions', 's2', 'artifacts')
    mkdirSync(older, { recursive: true })
    mkdirSync(newer, { recursive: true })
    writeFileSync(join(older, '전체대화.txt'), 'a')
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(join(newer, '전체대화.txt'), 'b')
    expect(await findAsideExport(home)).toBe(join(newer, '전체대화.txt'))
  })
})
