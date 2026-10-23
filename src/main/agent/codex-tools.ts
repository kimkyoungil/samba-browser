// Codex 대화에 브라우저 도구를 붙이는 통로.
//
// samba 도구는 Claude Agent SDK 의 인프로세스 MCP 서버(createSdkMcpServer)라 별도 프로세스인 codex 가
// 그대로는 붙지 못한다. 그래서 Codex 실행 1건 동안만 같은 서버 인스턴스를 127.0.0.1 의 빈 포트에
// MCP Streamable HTTP 로 열고, codex 에는 주소와 토큰을 담을 환경 변수 이름만 넘긴다.
// 토큰 값은 codex 자식 프로세스의 환경 변수로만 건너간다(명령줄·설정 파일에 남지 않는다).
//
// 확인한 사실(이 PC 의 codex-cli 0.160.1, 2026-10-23 실험):
//  - url 서버에 bearer_token_env_var 를 주면 그 값을 Authorization: Bearer 로 붙여 온다
//  - 세션 하나로 POST(initialize·tools/call)·GET(알림 스트림)·DELETE(끝) 를 보낸다
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'

/** codex 가 bearer 토큰을 읽을 환경 변수 이름 */
export const CODEX_TOOL_TOKEN_ENV = 'NODEN_CODEX_TOOLS_TOKEN'

/** Codex 실행 1건 동안 열린 도구 통로 */
export interface CodexToolServer {
  /** codex 에 넘길 MCP 주소 */
  url: string
  /** 이 실행에서만 쓰는 토큰 — codex 자식 프로세스의 CODEX_TOOL_TOKEN_ENV 로만 넘긴다 */
  token: string
  /** 통로를 닫는다. 여러 번 불러도 된다 */
  close: () => Promise<void>
}

/**
 * 도구 서버(createSambaTools 가 만든 것)를 127.0.0.1 의 빈 포트에 HTTP 로 연다.
 * 토큰이 맞지 않는 요청은 401 — 같은 PC 의 다른 프로그램도 이 통로로 브라우저를 움직일 수 없다
 */
export async function openCodexToolServer(
  sdk: McpSdkServerConfigWithInstance
): Promise<CodexToolServer> {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
  await sdk.instance.connect(transport)
  const http = createServer((req, res) => {
    const given = Buffer.from(req.headers.authorization ?? '')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(401).end()
      return
    }
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    void transport.handleRequest(req, res).catch((e: unknown) => {
      console.error('Codex 도구 통로 오류', e instanceof Error ? e.message : String(e))
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  // 도구 호출은 확인 카드(최대 30분)·사람 넘김을 기다리며 응답을 오래 붙잡는다 — 요청 제한 시간을 끈다
  http.requestTimeout = 0
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    // 서버를 닫으면 붙은 전송(열린 응답 스트림 포함)도 같이 닫힌다
    await sdk.instance.close().catch(() => undefined)
    await new Promise<void>((resolve) => {
      http.close(() => resolve())
      // keep-alive·알림 스트림 소켓이 남아 있으면 close 콜백이 안 온다 — 바로 끊는다
      http.closeAllConnections()
    })
  }
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', () => {
        http.off('error', reject)
        resolve()
      })
    })
  } catch (e) {
    await close()
    throw e
  }
  const address = http.address()
  const port = address && typeof address === 'object' ? address.port : 0
  return { url: `http://127.0.0.1:${port}/mcp`, token, close }
}
