// 대화 상태 저장소 — 생각 과정·할 일 목록은 지금 쓰는 AI 말풍선에 갈아 끼운다
import { describe, it, expect, beforeEach } from 'vitest'

Object.assign(globalThis, {
  window: { samba: { agent: {}, chats: {} } }
})

const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

beforeEach(() => {
  useChatStore.setState({
    messages: [
      { id: 'u', role: 'user', text: '해줘' },
      { id: 'a', role: 'ai', text: '', steps: [] }
    ],
    status: 'running'
  })
})

describe('생각 과정·할 일 목록', () => {
  it('매번 온 전체로 마지막 AI 말풍선을 갈아 끼운다', () => {
    const { handleEvent } = useChatStore.getState()
    handleEvent({ type: 'thinking', text: '먼저' })
    handleEvent({ type: 'thinking', text: '먼저 본다' })
    handleEvent({ type: 'todos', items: [{ text: '열기', status: 'in_progress' }] })
    handleEvent({ type: 'todos', items: [{ text: '열기', status: 'done' }] })
    const ai = useChatStore.getState().messages[1]
    expect(ai.thinking).toBe('먼저 본다')
    expect(ai.todos).toEqual([{ text: '열기', status: 'done' }])
  })

  it('마지막이 사용자 말이면 붙이지 않는다', () => {
    useChatStore.setState({ messages: [{ id: 'u', role: 'user', text: '해줘' }] })
    useChatStore.getState().handleEvent({ type: 'thinking', text: '생각' })
    expect(useChatStore.getState().messages[0].thinking).toBeUndefined()
  })
})
