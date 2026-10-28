// Codex 스레드의 문맥 크기 — 이어받기 전에 너무 길어졌는지 본다.
// Claude 대화는 문맥이 창의 60%(최대 30만)를 넘으면 앞부분 요약 + 새 세션으로 갈아탔지만(chat-session.ts)
// Codex 스레드는 그런 장치가 없어 한 대화가 끝없이 이어받았다. 워크룸 대화가 말 한 번에 39만 토큰(창 47.5만의
// 82%)을 보내다가, 모델이 붐비는 때에 일을 시작만 하고 답 없이 멈췄다(실기 10/28, 같은 때 4만 토큰 대화는 바로 답함).
// exec 의 JSON 출력에는 요청마다의 문맥 크기가 없어, Codex 가 남기는 스레드 기록(rollout)의 마지막 token_count 를 읽는다

import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { codexHome } from './codex-images'
import { ROTATE_CONTEXT_MAX, ROTATE_CONTEXT_RATIO } from './chat-session'

export interface CodexContext {
  /** 마지막 요청이 실은 토큰(앞 대화 전체 + 그 답) */
  used: number
  /** 모델 문맥 창(모르면 0) */
  window: number
}

// 끝에서부터 이만큼씩 늘려 읽는다 — 마지막 token_count 뒤에 큰 도구 결과가 붙어 있을 수 있다
const TAIL_STEPS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024]
// 스레드 기록 파일 위치(찾은 것만 기억 — 날짜 폴더를 매번 다 뒤지지 않게)
const rolloutPaths = new Map<string, string>()

/** 그 스레드의 기록 파일. sessions/YYYY/MM/DD/rollout-…-<스레드 id>.jsonl — 최근 날짜부터 찾는다 */
async function findRollout(threadId: string, home: string): Promise<string | null> {
  const known = rolloutPaths.get(threadId)
  if (known) return known
  const suffix = `-${threadId}.jsonl`
  const root = join(home, 'sessions')
  const desc = async (dir: string): Promise<string[]> =>
    (await readdir(dir).catch(() => [] as string[])).sort().reverse()
  for (const y of await desc(root))
    for (const m of await desc(join(root, y)))
      for (const d of await desc(join(root, y, m))) {
        const dir = join(root, y, m, d)
        const hit = (await desc(dir)).find((f) => f.endsWith(suffix))
        if (hit) {
          const path = join(dir, hit)
          rolloutPaths.set(threadId, path)
          return path
        }
      }
  return null
}

/** 기록 파일 끝부분에서 마지막 token_count 를 찾는다 */
export function lastTokenCount(text: string): CodexContext | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"token_count"')) continue
    try {
      const info = (JSON.parse(line) as { payload?: { type?: string; info?: unknown } }).payload
      if (info?.type !== 'token_count' || !info.info || typeof info.info !== 'object') continue
      const o = info.info as {
        last_token_usage?: { total_tokens?: unknown; input_tokens?: unknown }
        model_context_window?: unknown
      }
      const last = o.last_token_usage
      const used =
        typeof last?.total_tokens === 'number'
          ? last.total_tokens
          : typeof last?.input_tokens === 'number'
            ? last.input_tokens
            : 0
      if (used <= 0) continue
      const window = typeof o.model_context_window === 'number' ? o.model_context_window : 0
      return { used, window }
    } catch {
      // 끝에서 잘린 첫 줄 등 — 다음 줄을 본다
    }
  }
  return null
}

/** 그 스레드가 지금 쓰는 문맥. 기록을 못 찾거나 못 읽으면 null(그대로 이어받는다) */
export async function codexThreadContext(
  threadId: string,
  home = codexHome()
): Promise<CodexContext | null> {
  try {
    const path = await findRollout(threadId, home)
    if (!path) return null
    const size = (await stat(path)).size
    const fh = await open(path, 'r')
    try {
      for (const step of TAIL_STEPS) {
        const len = Math.min(step, size)
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, size - len)
        const found = lastTokenCount(buf.toString('utf8'))
        if (found || len === size) return found
      }
      return null
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

/** 이 문맥이면 이어받지 말고 앞부분 요약 + 새 스레드로 갈아탈지(Claude 세션과 같은 기준) */
export function codexContextTooLong(ctx: CodexContext | null): boolean {
  if (!ctx || ctx.used <= 0) return false
  const window = ctx.window > 0 ? ctx.window : ROTATE_CONTEXT_MAX / ROTATE_CONTEXT_RATIO
  return ctx.used >= Math.min(window * ROTATE_CONTEXT_RATIO, ROTATE_CONTEXT_MAX)
}
