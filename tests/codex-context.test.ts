// Codex 스레드 문맥 크기 — 너무 길어진 스레드는 이어받지 않고 앞부분 요약 + 새 스레드로(실기 10/28 워크룸 39만 토큰)
import { describe, it, expect, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  codexContextTooLong,
  codexThreadContext,
  lastTokenCount
} from '../src/main/agent/codex-context'

const tokenLine = (total: number, window = 475_000): string =>
  JSON.stringify({
    timestamp: '2026-10-28T03:02:47.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 64_715_440, total_tokens: 64_891_933 },
        last_token_usage: { input_tokens: total - 100, output_tokens: 100, total_tokens: total },
        model_context_window: window
      }
    }
  })

const home = mkdtempSync(join(tmpdir(), 'noden-codex-home-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('Codex 스레드 문맥 크기', () => {
  it('기록 끝에서 마지막 token_count 의 이번 요청 크기(누적이 아니라)를 읽는다', () => {
    const text = [
      tokenLine(100_000),
      '{"type":"response_item"}',
      tokenLine(389_719),
      '{"x":1}'
    ].join('\n')
    expect(lastTokenCount(text)).toEqual({ used: 389_719, window: 475_000 })
    // 끝에서 잘린 줄·token_count 없는 기록
    expect(lastTokenCount('{"payload":{"type":"token_cou')).toBeNull()
    expect(lastTokenCount('{"type":"response_item"}')).toBeNull()
  })

  it('창의 60%(최대 30만)를 넘으면 갈아탄다 — Claude 세션과 같은 기준', () => {
    expect(codexContextTooLong({ used: 389_719, window: 475_000 })).toBe(true)
    expect(codexContextTooLong({ used: 285_000, window: 475_000 })).toBe(true)
    expect(codexContextTooLong({ used: 284_999, window: 475_000 })).toBe(false)
    expect(codexContextTooLong({ used: 30_847, window: 475_000 })).toBe(false)
    // 1M 창이어도 30만을 넘으면
    expect(codexContextTooLong({ used: 300_000, window: 1_000_000 })).toBe(true)
    expect(codexContextTooLong(null)).toBe(false)
  })

  it('스레드 기록 파일을 날짜 폴더에서 찾아, 끝에 큰 도구 결과가 붙어 있어도 마지막 token_count 를 읽는다', async () => {
    const dir = join(home, 'sessions', '2026', '10', '27')
    mkdirSync(dir, { recursive: true })
    const id = '01a17d68-6fb0-7d52-bdf9-a5dbc25b2779'
    const big = JSON.stringify({ type: 'response_item', payload: { output: 'x'.repeat(600_000) } })
    writeFileSync(
      join(dir, `rollout-2026-10-27T21-49-19-${id}.jsonl`),
      [tokenLine(120_000), tokenLine(389_719), big].join('\n')
    )
    expect(await codexThreadContext(id, home)).toEqual({ used: 389_719, window: 475_000 })
    // 기록이 없는 스레드는 모른다(그대로 이어받는다)
    expect(await codexThreadContext('01a1ffff-0000-0000-0000-000000000000', home)).toBeNull()
  })
})
