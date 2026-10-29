// 실기 10/29 "이거 왜 새 대화에서 안 되냐" — 새 대화가 빈 답으로 끝난 두 원인
//  1) 화면엔 앞 대화의 Codex 가 보였는데 고른 적이 없다고 대화에 안 남겨, 메인은 기본 AI(Claude)로 돌았다
//  2) 설치판의 Claude 실행 파일(claude.exe)이 app.asar 안에 있어 실행되지 못했다
import { describe, it, expect, vi } from 'vitest'
import { join, sep } from 'node:path'
import type { ChatDto, IpcResult } from '../src/shared/ipc'
import { packagedClaudeExecutable } from '../src/main/agent/provider'

const setChatEngine = vi.fn(async () => ({ ok: true }))
const run = vi.fn(async () => ({ ok: true, data: { started: true } }))
Object.assign(globalThis, {
  window: {
    samba: {
      agent: { run, setChatEngine, stop: vi.fn(), confirmReply: vi.fn(), onEvent: vi.fn() },
      chats: {
        list: vi.fn(async () => ({ ok: true, data: [] })),
        create: vi.fn(async (title: string): Promise<IpcResult<ChatDto>> => ({
          ok: true,
          data: { id: 68, title, createdAt: 1, updatedAt: 1 }
        }))
      },
      ai: {},
      settings: {}
    }
  }
})
const { useChatStore } = await import('../src/renderer/src/stores/chatStore')

describe('새 대화 — 화면에 보이는 AI 로 돈다', () => {
  it('직접 고르지 않았어도 입력줄에 보이던 AI 를 그 대화에 남긴 뒤 실행한다', async () => {
    useChatStore.setState({
      activeChatId: null,
      messages: [],
      runs: {},
      status: 'idle',
      engine: 'codex',
      engineChosen: false
    })
    await useChatStore.getState().send('리뷰 중복 확인해')
    expect(setChatEngine).toHaveBeenCalledWith(68, 'codex')
    expect(setChatEngine.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0])
  })
})

describe('설치판 Claude 실행 파일', () => {
  const inAsar = [
    'C:',
    'app',
    'resources',
    'app.asar',
    'node_modules',
    '@anthropic-ai',
    'x',
    'package.json'
  ].join(sep)
  it.runIf(process.platform === 'win32')(
    'app.asar 안이면 풀어 둔 사본(app.asar.unpacked)의 claude.exe 를 쓴다',
    () => {
      const exe = packagedClaudeExecutable(
        () => inAsar,
        () => true
      )
      expect(exe).toBe(
        join(
          [
            'C:',
            'app',
            'resources',
            'app.asar.unpacked',
            'node_modules',
            '@anthropic-ai',
            'x'
          ].join(sep),
          'claude.exe'
        )
      )
    }
  )
  it('개발판(asar 밖)·풀어 둔 사본이 없거나 패키지를 못 찾으면 SDK 에 맡긴다(undefined)', () => {
    expect(
      packagedClaudeExecutable(
        () => join('C:', 'repo', 'node_modules', 'x', 'package.json'),
        () => true
      )
    ).toBeUndefined()
    expect(
      packagedClaudeExecutable(
        () => inAsar,
        () => false
      )
    ).toBeUndefined()
    expect(
      packagedClaudeExecutable(
        () => {
          throw new Error('not found')
        },
        () => true
      )
    ).toBeUndefined()
  })
})
