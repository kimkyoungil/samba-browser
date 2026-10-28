// 도구 묶음의 브라우저 차례 — 브라우저 도구는 차례를 잡은 뒤에 돌고, 다른 도구는 기다리지 않는다
import { describe, it, expect, vi } from 'vitest'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { ToolContext } from '../src/main/agent/tools'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => ({ name, description, schema, handler }),
  createSdkMcpServer: (o: unknown) => o
}))
vi.mock('../src/main/browser/page-bridge', () => ({ pageBridge: {} }))

const { createSambaTools } = await import('../src/main/agent/tools')

interface ToolStub {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>
}

const tabsStub = { active: () => null, create: vi.fn(), list: () => [] }
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function build(browserTurn?: () => Promise<void>): ToolStub[] {
  const ctx: ToolContext = {
    tabs: tabsStub as unknown as TabManager,
    dangerWords: [],
    mode: 'guard',
    finalConfirm: false,
    confirm: async () => true,
    tick: () => null,
    onStep: () => {},
    ...(browserTurn ? { browserTurn } : {})
  }
  return (createSambaTools(ctx) as unknown as { tools: ToolStub[] }).tools
}
const toolOf = (tools: ToolStub[], name: string): ToolStub => tools.find((t) => t.name === name)!

describe('브라우저 차례 — 도구 묶음', () => {
  it('브라우저 도구는 차례가 올 때까지 기다렸다가 돈다', async () => {
    let open: () => void = () => {}
    const browserTurn = vi.fn(() => new Promise<void>((r) => (open = r)))
    const tools = build(browserTurn)
    let finished = false
    const call = toolOf(tools, 'list_tabs')
      .handler({})
      .then(() => (finished = true))
    await tick()
    expect(browserTurn).toHaveBeenCalledTimes(1)
    expect(finished).toBe(false)
    open()
    await call
    expect(finished).toBe(true)
  })

  it('브라우저를 안 쓰는 도구는 차례를 잡지 않는다', async () => {
    const browserTurn = vi.fn(async () => {})
    const tools = build(browserTurn)
    const r = await toolOf(tools, 'done').handler({ summary: '끝' })
    expect(r.content[0].text).toContain('DONE')
    expect(browserTurn).not.toHaveBeenCalled()
  })

  it('기다리는 사이 멈추면 도구를 돌리지 않고 멈췄다고 답한다', async () => {
    const tools = build(async () => {
      throw new Error('stopped')
    })
    const r = await toolOf(tools, 'list_tabs').handler({})
    expect(r.content[0].text).toContain('stopped')
  })

  it('차례가 없는 묶음(브릿지·하나만 도는 앱)은 그대로 돈다', async () => {
    const tools = build()
    const r = await toolOf(tools, 'list_tabs').handler({})
    expect(r.content[0].text).not.toContain('stopped')
  })
})
