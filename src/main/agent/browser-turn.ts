// 브라우저 차례 — 대화방마다 AI 가 따로 돌 때, 브라우저(탭·클릭·입력)와 폰은 한 번에 한 실행만 쓴다.
// AI 둘이 같은 작업 탭을 번갈아 누르면 서로의 화면을 덮어 엉킨다. 그래서 브라우저 도구를 처음 부르는 순간
// 차례를 잡고, 그 실행이 끝날 때까지 쥔다. 다른 실행의 브라우저 도구는 차례가 올 때까지 기다린다(먼저 온 순서).
// 코드·계산·대화처럼 브라우저를 안 쓰는 도구는 차례와 상관없이 바로 돈다

/** 차례를 잡아야 하는 도구(탭을 보거나 조작하는 것, 브라우저 전역 설정, 폰·결제 승인) */
export const BROWSER_TURN_TOOLS: ReadonlySet<string> = new Set([
  'get_page',
  'find_elements',
  'screenshot',
  'navigate',
  'click',
  'type',
  'select',
  'scroll',
  'dismiss_overlay',
  'run_js',
  'upload_file',
  'set_download_dir',
  'wait',
  'new_tab',
  'list_tabs',
  'switch_tab',
  'close_tab',
  'clear_site_cookies',
  'fill_secret',
  'login',
  'run_script'
])

/** 이 도구가 브라우저 차례를 잡아야 하는가(폰 도구·결제 승인·문자 인증도 한 대뿐인 폰이라 같이 잡는다) */
export function needsBrowserTurn(name: string): boolean {
  return BROWSER_TURN_TOOLS.has(name) || name.startsWith('phone_') || name === 'wait_for_sms_code'
}

/** 차례를 쥐는 쪽 — 실행 1건마다 하나. key 는 같은 대화(실행기)인지 가리는 값, label 은 기다리는 쪽에 보일 이름 */
export interface TurnOwner {
  readonly key: unknown
  readonly label: string
}

/** 차례를 새로 잡았을 때 — 바로 앞에 쥐었던 쪽의 key(처음이면 undefined) */
export interface TurnGrant {
  acquired: true
  previousKey: unknown
}

/** 이미 쥐고 있었다(같은 실행의 다음 도구) */
export interface TurnHeld {
  acquired: false
}

interface Waiter {
  owner: TurnOwner
  grant: (g: TurnGrant | TurnHeld) => void
  fail: (e: Error) => void
}

export class BrowserTurn {
  private holder: TurnOwner | null = null
  // 마지막으로 차례를 잡았던 쪽(놓은 뒤에도 남긴다) — 같은 대화가 이어서 잡으면 작업 탭을 그대로 쓴다
  private lastKey: unknown = undefined
  private readonly waiters: Waiter[] = []

  /** 지금 차례를 쥔 쪽(없으면 null) */
  current(): TurnOwner | null {
    return this.holder
  }

  /**
   * 차례를 잡는다. 이미 쥐고 있으면 { acquired: false } 를 바로 돌려준다.
   * 다른 실행이 쥐고 있으면 onWait 로 알리고 차례가 올 때까지 기다린다. signal 이 끊기면 기다림을 접고 던진다
   */
  async acquire(
    owner: TurnOwner,
    signal?: AbortSignal,
    onWait?: (holder: TurnOwner) => void
  ): Promise<TurnGrant | TurnHeld> {
    if (this.holder === owner) return { acquired: false }
    if (signal?.aborted) throw new Error('stopped')
    if (this.holder === null && this.waiters.length === 0) return this.grantTo(owner)
    // 이미 줄 서 있으면 같은 자리를 기다린다(같은 실행이 도구를 동시에 여러 개 불렀을 때)
    const queued = this.waiters.find((w) => w.owner === owner)
    if (!queued && this.holder) onWait?.(this.holder)
    return new Promise<TurnGrant | TurnHeld>((resolve, reject) => {
      const onAbort = (): void => {
        const at = this.waiters.indexOf(waiter)
        if (at >= 0) this.waiters.splice(at, 1)
        reject(new Error('stopped'))
      }
      const waiter: Waiter = {
        owner,
        grant: (g) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(g)
        },
        fail: (e) => {
          signal?.removeEventListener('abort', onAbort)
          reject(e)
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  /** 차례를 놓는다(쥐지 않았으면 줄에서만 뺀다). 다음 줄 선 실행에 넘긴다 */
  release(owner: TurnOwner): void {
    if (this.holder !== owner) {
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].owner === owner) this.waiters.splice(i, 1)[0].fail(new Error('stopped'))
      }
      return
    }
    this.holder = null
    const next = this.waiters.shift()
    if (!next) return
    next.grant(this.grantTo(next.owner))
    // 같은 실행이 동시에 부른 도구들도 한꺼번에 들여보낸다(새로 잡은 건 맨 앞 하나뿐)
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].owner === next.owner)
        this.waiters.splice(i, 1)[0].grant({ acquired: false })
    }
  }

  private grantTo(owner: TurnOwner): TurnGrant {
    const previousKey = this.lastKey
    this.holder = owner
    this.lastKey = owner.key
    return { acquired: true, previousKey }
  }
}
