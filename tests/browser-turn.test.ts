// 브라우저 차례 — 대화방마다 AI 가 따로 돌 때 브라우저·폰 도구만 한 번에 한 실행이 쓴다
import { describe, it, expect, vi } from 'vitest'
import { BrowserTurn, needsBrowserTurn, type TurnOwner } from '../src/main/agent/browser-turn'

const owner = (key: string): TurnOwner => ({ key, label: `${key} 대화` })
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('브라우저 차례', () => {
  it('비어 있으면 바로 잡고, 이미 쥔 실행은 다시 기다리지 않는다', async () => {
    const turn = new BrowserTurn()
    const a = owner('a')
    expect(await turn.acquire(a)).toEqual({ acquired: true, previousKey: undefined })
    expect(await turn.acquire(a)).toEqual({ acquired: false })
    expect(turn.current()).toBe(a)
  })

  it('다른 실행이 쥐고 있으면 누가 쓰는지 알리고, 놓을 때까지 기다렸다가 먼저 온 순서로 받는다', async () => {
    const turn = new BrowserTurn()
    const a = owner('a')
    const b = owner('b')
    const c = owner('c')
    await turn.acquire(a)
    const onWait = vi.fn()
    let bGot: unknown = null
    let cGot: unknown = null
    void turn.acquire(b, undefined, onWait).then((g) => (bGot = g))
    void turn.acquire(c).then((g) => (cGot = g))
    await tick()
    expect(onWait).toHaveBeenCalledWith(a)
    expect(bGot).toBeNull()
    turn.release(a)
    await tick()
    // 바로 앞에 쥐었던 쪽(a)을 알려 준다 — 실행기는 다른 대화가 썼으면 작업 탭 표식을 지운다
    expect(bGot).toEqual({ acquired: true, previousKey: 'a' })
    expect(cGot).toBeNull()
    turn.release(b)
    await tick()
    expect(cGot).toEqual({ acquired: true, previousKey: 'b' })
  })

  it('기다리던 실행을 멈추면 줄에서 빠지고 던진다', async () => {
    const turn = new BrowserTurn()
    const a = owner('a')
    const b = owner('b')
    await turn.acquire(a)
    const ctl = new AbortController()
    const waiting = turn.acquire(b, ctl.signal)
    ctl.abort()
    await expect(waiting).rejects.toThrow('stopped')
    turn.release(a)
    expect(turn.current()).toBeNull()
  })

  it('쥐지 않은 실행이 놓으면 기다리던 자리만 접는다', async () => {
    const turn = new BrowserTurn()
    const a = owner('a')
    const b = owner('b')
    await turn.acquire(a)
    const waiting = turn.acquire(b)
    turn.release(b)
    await expect(waiting).rejects.toThrow('stopped')
    expect(turn.current()).toBe(a)
  })

  it('같은 실행이 동시에 부른 도구들은 함께 들어가고 새로 잡은 건 하나뿐이다', async () => {
    const turn = new BrowserTurn()
    const a = owner('a')
    const b = owner('b')
    await turn.acquire(a)
    const got: unknown[] = []
    void turn.acquire(b).then((g) => got.push(g))
    void turn.acquire(b).then((g) => got.push(g))
    turn.release(a)
    await tick()
    expect(got).toContainEqual({ acquired: true, previousKey: 'a' })
    expect(got).toContainEqual({ acquired: false })
  })

  it('브라우저·폰 도구만 차례를 잡는다(코드·계산·기록 도구는 아니다)', () => {
    for (const name of ['navigate', 'click', 'get_page', 'run_js', 'login', 'phone_tap'])
      expect(needsBrowserTurn(name)).toBe(true)
    expect(needsBrowserTurn('phone_approve_payment')).toBe(true)
    expect(needsBrowserTurn('wait_for_sms_code')).toBe(true)
    for (const name of [
      'code_read',
      'code_run',
      'done',
      'update_todos',
      'fetch_url',
      'list_accounts'
    ])
      expect(needsBrowserTurn(name)).toBe(false)
  })
})
