// 끝 보고 — AI 가 일하며 쓴 중간 말은 단계 기록으로 옮기고, 답 글에는 마지막 단계 뒤의 끝 보고만 남긴다
// (사장님 10/29 "업무가 끝나면 끝났습니다 하고 보고를 해야 되잖아" — 노든은 중간 말과 끝 보고를 한 말풍선에 이어 붙였다)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { foldNoteBeforeStep, restoreFinalNote, sanitizeSteps } from '../src/shared/chat'
import { buildSystemPrompt } from '../src/main/agent/prompt'

Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run: vi.fn(), stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: { list: vi.fn(async () => ({ ok: true, data: [] })) },
      ai: {},
      settings: {}
    }
  }
})
const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

describe('중간 말 접기(공용)', () => {
  it('도구 단계 앞에서 쓴 글은 중간 말로 옮기고 답 글을 비운다', () => {
    const r = foldNoteBeforeStep('자료를 확인할게요.', [{ label: '페이지 읽기', ok: true }])
    expect(r.text).toBe('')
    expect(r.steps).toEqual([
      { label: '페이지 읽기', ok: true },
      { label: '자료를 확인할게요.', ok: true, note: true }
    ])
    // 빈 글은 옮기지 않는다
    expect(foldNoteBeforeStep('  ', [])).toEqual({ text: '  ', steps: [] })
  })

  it('끝 보고가 비었으면(도구로 끝냄) 마지막 중간 말을 답 글로 되돌린다', () => {
    const steps = [
      { label: '처음 말', ok: true, note: true },
      { label: '이동', ok: true },
      { label: '마지막 말', ok: true, note: true },
      { label: '완료: 요약', ok: true }
    ]
    expect(restoreFinalNote('', steps)).toEqual({
      text: '마지막 말',
      steps: [steps[0], steps[1], steps[3]]
    })
    expect(restoreFinalNote('끝났습니다', steps).text).toBe('끝났습니다')
  })

  it('저장할 때 중간 말 표시(note)는 남긴다', () => {
    expect(sanitizeSteps([{ label: '말', ok: true, note: true, extra: 1 }])).toEqual([
      { label: '말', ok: true, note: true }
    ])
  })
})

describe('화면 — 말풍선에는 끝 보고만', () => {
  beforeEach(() => {
    useChatStore.setState({
      activeChatId: 1,
      runs: {},
      status: 'running',
      queue: [],
      injecting: [],
      messages: [
        { id: 'u', role: 'user', text: '일해' },
        { id: 'a', role: 'ai', text: '', steps: [] }
      ]
    })
  })

  it('일하며 쓴 말은 단계 기록으로 가고, 마지막 단계 뒤 글만 답으로 남는다', () => {
    const fire = useChatStore.getState().handleEvent
    fire({ type: 'text', text: '계속 진행 중입니다.' })
    fire({ type: 'step', label: '코드 읽기: a.ts', ok: true })
    fire({ type: 'text', text: '고친 뒤 시험을 돌릴게요.' })
    fire({ type: 'step', label: '명령 실행', ok: true })
    fire({ type: 'text', text: '끝났습니다 — 고치고 시험 3개 통과.' })
    fire({ type: 'status', state: 'done', toolCalls: 2 })
    const ai = useChatStore.getState().messages[1]
    expect(ai.text).toBe('끝났습니다 — 고치고 시험 3개 통과.')
    expect(ai.steps).toEqual([
      { label: '계속 진행 중입니다.', ok: true, note: true },
      { label: '코드 읽기: a.ts', ok: true },
      { label: '고친 뒤 시험을 돌릴게요.', ok: true, note: true },
      { label: '명령 실행', ok: true }
    ])
  })

  it('도구로 끝나 끝 보고가 없으면 마지막 중간 말을 답으로 보인다', () => {
    const fire = useChatStore.getState().handleEvent
    fire({ type: 'text', text: '로그인 화면에서 기다리는 중이에요.' })
    fire({ type: 'step', label: '완료: 로그인 대기', ok: true })
    fire({ type: 'status', state: 'done', toolCalls: 1 })
    const ai = useChatStore.getState().messages[1]
    expect(ai.text).toBe('로그인 화면에서 기다리는 중이에요.')
    expect(ai.steps).toEqual([{ label: '완료: 로그인 대기', ok: true }])
  })
})

describe('지시문 — 끝 보고 꼴', () => {
  it('끝나면 결과를 첫 줄에 밝히는 보고 하나로 맺고, 진행 말은 쓰지 않는다', () => {
    const p = buildSystemPrompt('ko', 'guard')
    expect(p).toContain('FINAL REPORT')
    expect(p).toContain('끝났습니다 / 일부만 끝났습니다 / 못 끝냈습니다 / 확인이 필요합니다')
    expect(p).toMatch(/never write "계속 진행 중입니다"/)
  })
})

describe('화면 — 자동 학습 차례는 끝 보고를 덮지 않는다', () => {
  it('진행 기록 한 줄(note)은 끝 보고 글을 그대로 두고 단계 기록에만 붙는다', () => {
    useChatStore.setState({
      activeChatId: 1,
      runs: {},
      status: 'running',
      toolCalls: 0,
      messages: [
        { id: 'u', role: 'user', text: '일해' },
        { id: 'a', role: 'ai', text: '', steps: [] }
      ]
    })
    const fire = useChatStore.getState().handleEvent
    fire({ type: 'step', label: '이동', ok: true })
    fire({ type: 'text', text: '끝났습니다 — 두 쪽 제목 확인.' })
    fire({ type: 'step', label: '(절차 저장)', ok: true, note: true })
    fire({ type: 'step', label: '스크립트 저장: read_titles', ok: true, note: true })
    fire({ type: 'step', label: '스크립트를 저장했습니다.', ok: true, note: true })
    const ai = useChatStore.getState().messages[1]
    expect(ai.text).toBe('끝났습니다 — 두 쪽 제목 확인.')
    expect(ai.steps?.filter((s) => s.note).map((s) => s.label)).toEqual([
      '(절차 저장)',
      '스크립트 저장: read_titles',
      '스크립트를 저장했습니다.'
    ])
    // 진행 기록은 도구 호출 수에 세지 않는다
    expect(useChatStore.getState().toolCalls).toBe(1)
  })
})
