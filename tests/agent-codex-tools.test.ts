// Codex 대화의 브라우저 도구 — 인프로세스 도구 서버를 실행 동안만 HTTP 로 열어 codex 에 붙인다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { EventEmitter } from 'node:events'
import type { AgentEvent } from '../src/shared/ipc'
import type { TabManager } from '../src/main/browser/tab-manager'
import type { SettingsStore } from '../src/main/settings/store'
import type { ToolContext } from '../src/main/agent/tools'
import {
  buildCodexArgs,
  parseCodexLine,
  runCodex,
  type CodexChild,
  type CodexInput
} from '../src/main/agent/provider-codex'
import { CODEX_TOOL_TOKEN_ENV, openCodexToolServer } from '../src/main/agent/codex-tools'

// 도구 하나짜리 서버(앱의 createSambaTools 와 같은 SDK 함수로 만든다)
function pageServer(
  onCall: (args: { selector?: string }) => string
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'samba',
    version: '0.1.0',
    tools: [
      tool(
        'get_page',
        'Read the current page.',
        { selector: z.string().optional() },
        async (a) => ({
          content: [{ type: 'text' as const, text: onCall(a) }]
        })
      )
    ]
  })
}

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  return client
}

describe('openCodexToolServer — 실행 동안만 여는 도구 통로', () => {
  it('토큰이 맞으면 도구 목록을 보고 도구를 부른다', async () => {
    const seen: Array<{ selector?: string }> = []
    const server = await openCodexToolServer(
      pageServer((a) => {
        seen.push(a)
        return 'PAGE: 네이버'
      })
    )
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const client = await connect(server.url, server.token)
    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name)).toEqual(['get_page'])
    const result = await client.callTool({ name: 'get_page', arguments: { selector: 'main' } })
    expect(result.content).toEqual([{ type: 'text', text: 'PAGE: 네이버' }])
    expect(seen).toEqual([{ selector: 'main' }])
    await client.close()
    await server.close()
  })

  it('토큰이 없거나 틀리면 401 — 같은 PC 의 다른 프로그램은 못 쓴다', async () => {
    const server = await openCodexToolServer(pageServer(() => 'x'))
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    }
    expect((await fetch(server.url, { method: 'POST', body, headers })).status).toBe(401)
    const wrong = { ...headers, authorization: `Bearer ${'0'.repeat(server.token.length)}` }
    expect((await fetch(server.url, { method: 'POST', body, headers: wrong })).status).toBe(401)
    await server.close()
  })

  it('닫은 뒤에는 접속이 안 되고, 두 번 닫아도 된다', async () => {
    const server = await openCodexToolServer(pageServer(() => 'x'))
    await server.close()
    await server.close()
    await expect(connect(server.url, server.token)).rejects.toThrow()
  })
})

describe('buildCodexArgs — HTTP 도구 통로', () => {
  const args = buildCodexArgs({
    model: 'gpt-6.1-sol',
    mcpServer: {
      name: 'samba',
      url: 'http://127.0.0.1:5123/mcp',
      bearerTokenEnvVar: CODEX_TOOL_TOKEN_ENV,
      toolTimeoutSec: 1860
    }
  })
  it('주소·토큰 변수 이름·승인 넘김·제한 시간을 한 줄로 얹는다', () => {
    expect(args).toContain(
      `mcp_servers.samba={url="http://127.0.0.1:5123/mcp",bearer_token_env_var="${CODEX_TOOL_TOKEN_ENV}",default_tools_approval_mode="approve",tool_timeout_sec=1860}`
    )
  })
  it('승인 정책·샌드박스는 그대로 가장 좁게 둔다', () => {
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
    expect(args.join(' ')).not.toContain('dangerously')
  })
})

describe('parseCodexLine — 도구 실패 사유', () => {
  it('실패한 도구 호출은 codex 가 붙인 사유를 라벨에 싣는다', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'mcp_tool_call',
        server: 'samba',
        tool: 'click',
        status: 'failed',
        error: { message: 'tool call timed out' }
      }
    })
    expect(parseCodexLine(line)).toEqual([
      { type: 'step', label: 'samba.click: tool call timed out', ok: false }
    ])
  })
})

describe('runCodex — 토큰은 자식 프로세스 환경 변수로만', () => {
  it('env 를 spawn 에 넘기고 인자에는 값이 없다', async () => {
    let seenEnv: Record<string, string> | undefined
    let seenArgs: string[] = []
    const child = {
      stdout: (async function* () {
        yield '{"type":"turn.completed"}\n'
      })(),
      stdin: { write: () => undefined, end: () => undefined },
      kill: () => true,
      on: new EventEmitter().on
    } as unknown as CodexChild
    const stream = runCodex(
      {
        prompt: 'p',
        systemPrompt: '',
        model: 'm',
        abort: new AbortController(),
        mcpServer: {
          name: 'samba',
          url: 'http://127.0.0.1:1/mcp',
          bearerTokenEnvVar: CODEX_TOOL_TOKEN_ENV
        },
        env: { [CODEX_TOOL_TOKEN_ENV]: 'secret-token' }
      },
      (_cmd, args, _cwd, env) => {
        seenArgs = args
        seenEnv = env
        return child
      }
    )
    for await (const event of stream) void event
    expect(seenEnv).toEqual({ [CODEX_TOOL_TOKEN_ENV]: 'secret-token' })
    expect(seenArgs.join(' ')).not.toContain('secret-token')
  })
})

// ── 실행기: Codex 대화가 실제로 도구 통로를 열어 넘기고, 도구 호출이 화면 진행 줄·호출 수로 이어지는가 ──

const codexInputs: CodexInput[] = []
// 가짜 codex: 받은 주소·토큰으로 실제 MCP 클라이언트를 붙여 get_page 를 한 번 부르고, codex 의 흔적 줄도 흉내 낸다
let fakeCodexCall: ((input: CodexInput) => Promise<string>) | null = null

vi.mock('../src/main/agent/provider', async () => {
  const actual = await vi.importActual<typeof import('../src/main/agent/provider')>(
    '../src/main/agent/provider'
  )
  return {
    ...actual,
    runCodexQuery: (input: CodexInput) => {
      codexInputs.push(input)
      return (async function* () {
        const text = fakeCodexCall ? await fakeCodexCall(input) : '도구 없음'
        yield { type: 'step', label: 'samba.get_page', ok: true }
        yield { type: 'text', text }
        yield { type: 'done', ok: true }
      })()
    }
  }
})

vi.mock('../src/main/agent/tools', () => ({
  // 앱의 도구 서버처럼 문맥의 tick·onStep 을 거친다
  createSambaTools: (ctx: ToolContext) =>
    pageServer(() => {
      ctx.tick()
      ctx.onStep('페이지 읽기', true)
      return 'PAGE: 쿠팡 주문목록'
    }),
  SAMBA_TOOL_NAMES: []
}))

const { AgentRunner, CODEX_TOOLS_NOTE, CODEX_CHAT_PROMPT } =
  await import('../src/main/agent/runner')

function makeRunner(): { runner: InstanceType<typeof AgentRunner>; events: AgentEvent[] } {
  const events: AgentEvent[] = []
  const settings = {
    get: () => ({
      model: 'sonnet',
      language: 'ko',
      panelWidth: 380,
      lastUrl: '',
      dangerWords: [],
      maxToolCalls: 40,
      agentEffort: 'high',
      permissionMode: 'guard'
    })
  }
  const runner = new AgentRunner(
    {} as unknown as TabManager,
    settings as unknown as SettingsStore,
    (e) => events.push(e)
  )
  runner.setEngineRouting(() => ({
    engine: 'codex',
    auth: { mode: 'codex_subscription' },
    model: 'gpt-6.1-sol'
  }))
  return { runner, events }
}

beforeEach(() => {
  codexInputs.length = 0
  fakeCodexCall = null
})

describe('실행기 — Codex 대화에 브라우저 도구', () => {
  it('통로를 열어 주소·토큰을 넘기고, 도구 호출이 진행 줄과 호출 수로 남는다', async () => {
    let url = ''
    fakeCodexCall = async (input) => {
      const server = input.mcpServer
      if (!server || !('url' in server)) throw new Error('통로 없음')
      url = server.url
      const token = input.env?.[server.bearerTokenEnvVar] ?? ''
      const client = await connect(server.url, token)
      const r = await client.callTool({ name: 'get_page', arguments: {} })
      await client.close()
      return (r.content as Array<{ text: string }>)[0].text
    }
    const { runner, events } = makeRunner()
    await runner.run('쿠팡 주문목록 읽어줘', 3)
    await new Promise((r) => setTimeout(r, 30))
    expect(codexInputs).toHaveLength(1)
    const input = codexInputs[0]
    expect(input.systemPrompt).toContain('TOOL USE PRINCIPLES')
    expect(input.systemPrompt).toContain(CODEX_TOOLS_NOTE)
    expect(input.env?.[CODEX_TOOL_TOKEN_ENV]).toMatch(/^[0-9a-f]{64}$/)
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)
    expect(texts).toContain('PAGE: 쿠팡 주문목록')
    // 도구가 스스로 올린 진행 줄만 남고, codex 의 같은 흔적(samba.get_page)은 겹쳐 올리지 않는다
    const steps = events.filter((e) => e.type === 'step').map((e) => (e as { label: string }).label)
    expect(steps).toEqual(['페이지 읽기'])
    const last = events.filter((e) => e.type === 'status').pop() as {
      state: string
      toolCalls: number
    }
    expect(last).toMatchObject({ state: 'done', toolCalls: 1 })
    // 실행이 끝나면 통로는 닫혀 더 붙을 수 없다
    await expect(connect(url, input.env?.[CODEX_TOOL_TOKEN_ENV] ?? '')).rejects.toThrow()
  })

  it('도구 통로를 못 열면 도구 없다고 아는 지시문으로 답만 한다', async () => {
    const tools = await import('../src/main/agent/codex-tools')
    const spy = vi.spyOn(tools, 'openCodexToolServer').mockRejectedValueOnce(new Error('포트 없음'))
    const { runner } = makeRunner()
    await runner.run('안녕', 4)
    await new Promise((r) => setTimeout(r, 30))
    expect(codexInputs[0].systemPrompt).toBe(CODEX_CHAT_PROMPT)
    expect(codexInputs[0].mcpServer).toBeUndefined()
    spy.mockRestore()
  })
})
