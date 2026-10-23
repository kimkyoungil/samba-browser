// update_todos 도구 — AI 가 세운 계획을 화면 체크리스트로 보낸다(도구 호출 수에 넣지 않는다)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { ToolContext } from '../src/main/agent/tools'
import type { AgentTodo } from '../src/shared/ipc'

// SDK 의 tool()/createSdkMcpServer() 를 얇게 대체해 도구 핸들러를 직접 부른다
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => ({ name, description, schema, handler }),
  createSdkMcpServer: (o: unknown) => o
}))

const { pageBridge } = vi.hoisted(() => ({
  pageBridge: {
    snapshot: vi.fn(),
    textOf: vi.fn(async () => ''),
    waitForLoad: vi.fn(async () => {})
  }
}))
vi.mock('../src/main/browser/page-bridge', () => ({ pageBridge }))

const { createSambaTools, SAMBA_TOOL_NAMES, cleanTodos, TODOS_INVALID } =
  await import('../src/main/agent/tools')

interface ToolStub {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>
}

let reported: AgentTodo[][]
let ticks: number
let updateTodos: ToolStub

beforeEach(() => {
  reported = []
  ticks = 0
  const tabs = { active: () => null, list: () => [] } as unknown as TabManager
  const ctx: ToolContext = {
    tabs,
    dangerWords: [],
    mode: 'guard',
    finalConfirm: false,
    confirm: async () => true,
    tick: () => {
      ticks += 1
      return null
    },
    onStep: () => {},
    onTodos: (items) => reported.push(items)
  }
  const server = createSambaTools(ctx) as unknown as { tools: ToolStub[] }
  const found = server.tools.find((t) => t.name === 'update_todos')
  if (!found) throw new Error('update_todos 도구가 등록되지 않았습니다')
  updateTodos = found
})

describe('update_todos 도구', () => {
  it('목록 전체를 화면으로 보내고, 도구 호출 수에는 넣지 않는다', async () => {
    const items = [
      { text: '주문서 열기', status: 'done' },
      { text: '가격 읽기', status: 'in_progress' },
      { text: '보고', status: 'pending' }
    ]
    const r = await updateTodos.handler({ items })
    expect(r.content[0].text).toBe('ok: 1/3 done')
    expect(reported).toEqual([items])
    expect(ticks).toBe(0)
  })

  it('빈 줄은 버리고 긴 줄은 자른다', () => {
    const out = cleanTodos([
      { text: '  열기  ', status: 'pending' },
      { text: '   ', status: 'pending' },
      { text: '가'.repeat(300), status: 'done' }
    ])
    expect(out?.map((t) => t.text.length)).toEqual([2, 120])
    expect(out?.[0].text).toBe('열기')
  })

  it('쓸 줄이 없거나 너무 많으면 거부한다', async () => {
    const r = await updateTodos.handler({ items: [{ text: ' ', status: 'pending' }] })
    expect(r.content[0].text).toBe(TODOS_INVALID)
    const many = Array.from({ length: 21 }, (_, i) => ({
      text: `${i}`,
      status: 'pending' as const
    }))
    expect(cleanTodos(many)).toBeNull()
    expect(reported).toHaveLength(0)
  })

  it('허용 목록에 이름이 있다', () => {
    expect(SAMBA_TOOL_NAMES).toContain('mcp__samba__update_todos')
  })
})
