// Codex 구독 경로 어댑터. OpenAI Codex CLI 를 백엔드로 써서 프롬프트 1건을 실행한다.
//
// 확인한 사실(이 PC 의 codex-cli 0.150.1 에서 `codex --help` · `codex exec --help` 실행):
//  - 비대화 실행은 `codex exec [PROMPT]`, `--json` 을 주면 이벤트를 JSONL 로 뿜는다
//  - 프롬프트를 인자로 줘도 stdin 을 계속 읽으므로(`Reading additional input from stdin...`)
//    호출부가 stdin 을 반드시 닫아야 한다 — 여기서는 프롬프트를 stdin 으로 넣고 바로 닫는다
//  - 실제 이벤트 봉투: {"type":"thread.started",...} / {"type":"turn.started"} /
//    {"type":"item.completed","item":{...}} / {"type":"turn.completed"|"turn.failed"} /
//    {"type":"error","message":"..."}
//  - item.type 은 agent_message · reasoning · command_execution · file_change ·
//    mcp_tool_call · web_search · todo_list · error
//
// 도구 연동 범위: samba 도구는 Claude Agent SDK 의 **인프로세스** MCP 서버(createSdkMcpServer)라
// 별도 프로세스인 codex 가 바로 붙을 수 없다. 채팅 실행은 그 서버를 실행 동안만 HTTP 로 열어
// (codex-tools.ts) `-c mcp_servers.samba={url=…}` 로 붙이고, 주어진 서버가 없으면 텍스트 응답만 한다.

import { spawn } from 'node:child_process'
import { resolveCliBin } from '../ai/cli-bin'
import type { AgentTodo } from '../../shared/ipc'

/** codex 에 붙일 MCP 서버 — 외부 stdio 프로그램, 또는 앱이 연 HTTP 통로 */
export type CodexMcpServer =
  | { name: string; command: string; args: string[] }
  | {
      name: string
      url: string
      /** bearer 토큰을 담은 환경 변수 이름(값은 CodexInput.env 로 자식 프로세스에만 넘긴다) */
      bearerTokenEnvVar: string
      /** 도구 호출 1건의 제한 시간(초). 확인 카드·사람 넘김을 기다리는 시간보다 길어야 한다 */
      toolTimeoutSec?: number
    }

/** codex 에 넘길 실행 입력 */
export interface CodexInput {
  prompt: string
  systemPrompt: string
  model: string
  /** 도구를 붙일 MCP 서버(없으면 도구 없이 텍스트만) */
  mcpServer?: CodexMcpServer
  /** codex 자식 프로세스에만 더할 환경 변수(도구 통로 토큰) */
  env?: Record<string, string>
  /** 추론 강도(입력줄에서 고른 값). Codex 모델은 low·medium·high 를 다 받는다(~/.codex/models_cache.json) */
  effort?: 'low' | 'medium' | 'high'
  /** 생각 요약을 받을지(대화 화면에 '생각 과정'으로 띄우는 실행만). 번역 같은 짧은 호출은 끈다 */
  thinking?: boolean
  /** 첫 지시에 붙일 사진 파일 경로들(`--image`). 호출부가 임시 파일로 써 두고 끝나면 지운다 */
  imagePaths?: string[]
  /** 이어받을 Codex 스레드 id. 있으면 `codex exec resume <id>` 로 보내 앞 대화를 Codex 가 그대로 기억한다 */
  resume?: string
  /** 스레드를 남겨 다음 말이 이어받게 한다(대화 실행). 끄면 `--ephemeral` — 번역 같은 한 번짜리 호출 */
  keepThread?: boolean
  /**
   * Codex 자기 셸(shell_tool·unified_exec)을 끈다 — 코드 작업 모드. 명령은 노든 code_run(확인 카드)으로만 돈다.
   * 끄면 Codex 는 명령을 돌릴 도구가 아예 없다고 답한다(실기 codex-cli 0.160.1)
   */
  noShell?: boolean
  abort: AbortController
  cwd?: string
}

/** 어댑터가 밖으로 내보내는 정규화된 사건 */
export type CodexEvent =
  | { type: 'text'; text: string }
  | { type: 'step'; label: string; ok: boolean }
  // 생각 요약 한 덩어리(reasoning 항목). 앞 덩어리에 이어 붙여 보여 준다
  | { type: 'thinking'; text: string }
  // codex 가 세운 계획(todo_list 항목, 매번 전체)
  | { type: 'todos'; items: AgentTodo[] }
  // 이 실행의 Codex 스레드 id(thread.started). 다음 말이 이어받는다
  | { type: 'thread'; id: string }
  | { type: 'error'; message: string }
  | { type: 'done'; ok: boolean; message?: string }

/** 자식 프로세스 최소 모양(테스트에서 가짜 프로세스를 주입한다) */
export interface CodexChild {
  stdout: AsyncIterable<string | Buffer> | NodeJS.ReadableStream
  stderr?: NodeJS.ReadableStream
  stdin?: { write: (chunk: string) => void; end: () => void } | null
  kill: (signal?: NodeJS.Signals) => boolean
  on: (event: 'close' | 'error', listener: (arg: never) => void) => unknown
}

export type CodexSpawn = (
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>
) => CodexChild

export const CODEX_BIN = 'codex'

/**
 * `codex exec` 인자. 승인·샌드박스는 가장 좁게 잡는다 —
 * 브라우저 조작은 samba 도구가 하고, codex 쪽 셸 실행은 읽기 전용으로 묶어 둔다
 */
export function buildCodexArgs(
  input: Pick<
    CodexInput,
    | 'model'
    | 'mcpServer'
    | 'effort'
    | 'thinking'
    | 'imagePaths'
    | 'resume'
    | 'keepThread'
    | 'noShell'
  >
): string[] {
  const args = [
    'exec',
    ...(input.resume ? ['resume'] : []),
    '--json',
    '--skip-git-repo-check',
    // 사용자/프로젝트 config.toml 의 훅·MCP 를 상속하지 않는다(우리 설정만 쓴다)
    '--ignore-user-config'
  ]
  // 대화 실행은 스레드를 남겨 다음 말이 이어받는다. 한 번짜리 호출(번역 등)은 남기지 않는다
  if (!input.resume && input.keepThread !== true) args.push('--ephemeral')
  // 이어받기 명령에는 --sandbox 가 없다 — 같은 읽기 전용 제한을 설정 값으로 건다(실기 codex-cli 0.160.1)
  if (input.resume) args.push('-c', 'sandbox_mode="read-only"')
  else args.push('--sandbox', 'read-only')
  // 코드 작업 모드 — Codex 셸을 끈다(이어받기에도 같은 설정 값으로)
  if (input.noShell === true)
    args.push('-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false')
  if (input.model.trim()) args.push('-m', input.model.trim())
  if (input.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(input.effort)}`)
  // 생각 요약을 켠다 — 끄면(기본) reasoning 항목이 아예 오지 않는다(실기 2026-10-24 확인)
  if (input.thinking === true) args.push('-c', 'model_reasoning_summary="detailed"')
  const server = input.mcpServer
  if (server && 'url' in server) {
    // TOML 인라인 테이블로 HTTP 서버 하나를 얹는다(-c mcp_servers.<name>={url=…})
    const fields = [
      `url=${JSON.stringify(server.url)}`,
      `bearer_token_env_var=${JSON.stringify(server.bearerTokenEnvVar)}`,
      // codex exec 는 승인 정책이 never 라 MCP 도구를 "requires approval" 로 전부 거절한다(0.160.1 실측).
      // 위험한 동작은 앱의 권한 모드·확인 카드가 막으므로 codex 쪽 승인은 넘긴다
      'default_tools_approval_mode="approve"',
      ...(server.toolTimeoutSec ? [`tool_timeout_sec=${server.toolTimeoutSec}`] : [])
    ]
    args.push('-c', `mcp_servers.${server.name}={${fields.join(',')}}`)
  } else if (server) {
    const { name, command, args: serverArgs } = server
    // TOML 인라인 테이블로 서버 하나를 얹는다(-c mcp_servers.<name>={...})
    const toml = `{command=${JSON.stringify(command)},args=[${serverArgs
      .map((a) => JSON.stringify(a))
      .join(',')}]}`
    args.push('-c', `mcp_servers.${name}=${toml}`)
  }
  // 사진은 한 장씩 `--image=경로` 로 붙인다(`-i a b` 꼴은 뒤의 인자까지 사진으로 먹을 수 있다)
  for (const path of input.imagePaths ?? []) args.push(`--image=${path}`)
  // 이어받기: 스레드 id 다음의 '-' 는 지시를 stdin 에서 읽으라는 뜻이다
  if (input.resume) args.push(input.resume, '-')
  return args
}

/**
 * codex 에는 시스템 프롬프트를 따로 넘기는 안정된 통로가 없어(설정 키에 의존하지 않는다)
 * 지시문을 프롬프트 앞머리에 붙여 stdin 으로 한 번에 넣는다
 */
export function composeCodexPrompt(systemPrompt: string, prompt: string): string {
  const head = systemPrompt.trim()
  return head ? `${head}\n\n---\n\n${prompt}` : prompt
}

/** JSONL 한 줄 → 정규화된 사건들(모르는 줄은 조용히 버린다) */
export function parseCodexLine(line: string): CodexEvent[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return []
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object') return []
  const event = raw as Record<string, unknown>
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'error') {
    return [{ type: 'error', message: str(event.message) || 'codex error' }]
  }
  if (type === 'turn.failed') {
    const error = event.error
    const message =
      error && typeof error === 'object' ? str((error as Record<string, unknown>).message) : ''
    return [{ type: 'done', ok: false, message: message || 'turn.failed' }]
  }
  if (type === 'turn.completed') return [{ type: 'done', ok: true }]
  if (type === 'thread.started') {
    const id = str(event.thread_id)
    return id ? [{ type: 'thread', id }] : []
  }
  if (type === 'item.completed') return itemEvents(event.item)
  // 계획(todo_list)은 세울 때·고칠 때마다 started/updated 로 다시 온다 — 그때마다 화면 목록을 바꾼다
  if (type === 'item.started' || type === 'item.updated') {
    const todos = todoEvent(event.item)
    return todos ? [todos] : []
  }
  return []
}

/** todo_list 항목 → 할 일 목록 사건. codex 는 끝남 여부만 알려 준다(하는 중 표시는 없다) */
function todoEvent(item: unknown): CodexEvent | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  if (str(record.type) !== 'todo_list' || !Array.isArray(record.items)) return null
  const items: AgentTodo[] = []
  for (const raw of record.items) {
    if (!raw || typeof raw !== 'object') continue
    const todo = raw as Record<string, unknown>
    const text = str(todo.text).trim()
    if (text) items.push({ text, status: todo.completed === true ? 'done' : 'pending' })
  }
  return items.length > 0 ? { type: 'todos', items } : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// item.completed 하나를 화면 사건으로 바꾼다. 추론(reasoning)은 접힌 '생각 과정'으로만 올린다
function itemEvents(item: unknown): CodexEvent[] {
  if (!item || typeof item !== 'object') return []
  const record = item as Record<string, unknown>
  const type = str(record.type)
  if (type === 'agent_message') {
    const text = str(record.text) || str(record.message)
    return text ? [{ type: 'text', text }] : []
  }
  if (type === 'reasoning') {
    const text = str(record.text).trim()
    return text ? [{ type: 'thinking', text }] : []
  }
  if (type === 'todo_list') {
    const todos = todoEvent(item)
    return todos ? [todos] : []
  }
  if (type === 'error') {
    return [{ type: 'error', message: str(record.message) || 'codex item error' }]
  }
  if (type === 'mcp_tool_call') {
    const label = [str(record.server), str(record.tool)].filter(Boolean).join('.') || 'tool'
    const ok = str(record.status) !== 'failed'
    // 실패하면 codex 가 붙인 사유(승인 거절·시간 초과 등)를 라벨 뒤에 짧게 붙인다
    const error = record.error && typeof record.error === 'object' ? record.error : null
    const reason = ok || !error ? '' : str((error as Record<string, unknown>).message).slice(0, 120)
    return [{ type: 'step', label: reason ? `${label}: ${reason}` : label, ok }]
  }
  if (type === 'command_execution') {
    const label = str(record.command) || 'command'
    return [{ type: 'step', label, ok: str(record.status) !== 'failed' }]
  }
  if (type === 'web_search') {
    return [{ type: 'step', label: str(record.query) || 'web_search', ok: true }]
  }
  return []
}

/** 버퍼에 쌓인 텍스트를 줄 단위로 끊는다(마지막 조각은 다음 청크를 기다린다) */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.map((l) => l.replace(/\r$/, '')), rest }
}

function defaultSpawn(
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>
): CodexChild {
  // Windows 의 npm 셔틀(codex.cmd)은 spawn 이름만으로는 못 돌리므로 실제 실행 파일(node + .js)로 푼다
  const cli = resolveCliBin(command)
  const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
    cwd,
    ...(env ? { env: { ...process.env, ...env } } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  return child as unknown as CodexChild
}

/**
 * Codex CLI 로 프롬프트 1건을 실행하고 사건을 순서대로 흘려보낸다.
 * 중단(abort)되면 자식 프로세스를 죽이고 스트림을 끝낸다
 */
export async function* runCodex(
  input: CodexInput,
  spawnImpl: CodexSpawn = defaultSpawn
): AsyncGenerator<CodexEvent> {
  const args = buildCodexArgs(input)
  let child: CodexChild
  try {
    child = spawnImpl(CODEX_BIN, args, input.cwd, input.env)
  } catch (e) {
    yield { type: 'done', ok: false, message: e instanceof Error ? e.message : String(e) }
    return
  }
  const onAbort = (): void => {
    try {
      child.kill()
    } catch {
      // 이미 끝난 프로세스는 무시한다
    }
  }
  // 이미 중단된 뒤에 들어온 실행이면 리스너가 불리지 않으므로 여기서 바로 정리한다
  if (input.abort.signal.aborted) onAbort()
  else input.abort.signal.addEventListener('abort', onAbort, { once: true })
  // 프롬프트는 stdin 으로 넣고 곧바로 닫는다 — 닫지 않으면 codex 가 입력을 계속 기다린다
  try {
    child.stdin?.write(composeCodexPrompt(input.systemPrompt, input.prompt))
    child.stdin?.end()
  } catch {
    // stdin 이 이미 닫혀 있으면 인자 프롬프트가 없으므로 실패로 끝난다
  }
  let buffer = ''
  let settled = false
  try {
    for await (const chunk of child.stdout as AsyncIterable<string | Buffer>) {
      if (input.abort.signal.aborted) break
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const { lines, rest } = splitLines(buffer)
      buffer = rest
      for (const line of lines) {
        for (const event of parseCodexLine(line)) {
          if (event.type === 'done') settled = true
          yield event
        }
      }
    }
    for (const event of parseCodexLine(buffer)) {
      if (event.type === 'done') settled = true
      yield event
    }
  } finally {
    input.abort.signal.removeEventListener('abort', onAbort)
  }
  // turn.completed/turn.failed 없이 끊긴 경우(프로세스 사망)도 한 번은 끝을 알린다
  if (!settled && !input.abort.signal.aborted) {
    yield { type: 'done', ok: false, message: 'codex_stream_closed' }
  }
}
