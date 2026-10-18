// 확장 chrome.* 범용 안전망 — 없는 API 를 불러도 죽지 않고, 아이콘 클릭·탭 동작은 앱 다리로 간다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chromeShim } from '../src/preload/chrome-shim'

type Dict = Record<string, unknown>

/** Electron 39 가 실제로 주는 모양을 흉내 낸 chrome(2026-10-18 실측 키 일부) */
function electronLikeChrome(): Dict {
  const event = (): Dict => ({ addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn(() => false) })
  return {
    runtime: {
      id: 'faglepdniaalgbkakcbhioblejlfoihn',
      getManifest: () => ({ name: 'IG', version: '1', permissions: ['storage'], host_permissions: ['https://x/*'] }),
      getURL: (p: string) => `chrome-extension://faglepdniaalgbkakcbhioblejlfoihn/${p}`,
      sendMessage: vi.fn(),
      onMessage: event(),
      onInstalled: event()
    },
    storage: { local: { get: vi.fn(), set: vi.fn() }, onChanged: event() },
    tabs: {
      query: vi.fn(async () => [{ id: 99, url: 'native' }]),
      sendMessage: vi.fn(),
      get: vi.fn(),
      reload: vi.fn(),
      update: vi.fn(),
      onUpdated: event()
    },
    action: {
      setIcon: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
      onClicked: event()
    },
    scripting: { executeScript: vi.fn() },
    alarms: { create: vi.fn(), onAlarm: event() },
    offscreen: { createDocument: vi.fn(), hasDocument: vi.fn(async () => false) }
  }
}

let call: ReturnType<typeof vi.fn>
let notify: ReturnType<typeof vi.fn>
let listeners: Array<(kind: string, details: unknown) => void>
let original: unknown
const g = globalThis as unknown as { chrome?: Dict }

function install(opts: { proxyFallback?: boolean } = {}): { chrome: Dict; shim: ReturnType<typeof chromeShim> } {
  const c = electronLikeChrome()
  g.chrome = c
  const shim = chromeShim(
    call as unknown as (op: string, details: unknown) => Promise<unknown>,
    (fn) => listeners.push(fn),
    notify as unknown as (op: string, details: unknown) => void,
    { context: 'sw', ...opts }
  )
  return { chrome: g.chrome as Dict, shim }
}

beforeEach(() => {
  original = g.chrome
  listeners = []
  notify = vi.fn()
  call = vi.fn(async (op: string, d: unknown) => {
    if (op === 'query') return [{ id: 12, url: 'https://www.instagram.com/', active: true }]
    if (op === 'create') return { id: 20, url: (d as { url?: string }).url }
    if (op === 'download') return 7
    return null
  })
})
afterEach(() => {
  if (original === undefined) delete g.chrome
  else g.chrome = original as Dict
})

describe('chromeShim — 없는 네임스페이스를 크롬 모양으로 채운다', () => {
  it('contextMenus.create 는 id 를 돌려주고 onClicked 는 레지스트리다(IG Sorter·구글 번역 패턴)', async () => {
    const { chrome } = install()
    const menus = chrome.contextMenus as Dict
    const created = vi.fn()
    const id = (menus.create as (p: unknown, cb?: () => void) => unknown)({ id: 'tr', title: 'Translate' }, created)
    expect(id).toBe('tr')
    await new Promise((r) => setTimeout(r, 0))
    expect(created).toHaveBeenCalled()
    const fn = vi.fn()
    ;(menus.onClicked as { addListener: (f: unknown) => void }).addListener(fn)
    listeners[0]('contextMenuClicked', { extensionId: 'faglepdniaalgbkakcbhioblejlfoihn', info: { menuItemId: 'tr' }, tab: { id: 1 } })
    expect(fn).toHaveBeenCalledWith({ menuItemId: 'tr' }, { id: 1 })
  })

  it('이미 있는 네이티브 API 는 덮지 않는다(scripting·offscreen·storage.local)', () => {
    const before = electronLikeChrome()
    const { chrome } = install()
    expect((chrome.scripting as Dict).executeScript).toBeTypeOf('function')
    expect(Object.keys(chrome.offscreen as Dict).sort()).toEqual(Object.keys(before.offscreen as Dict).sort())
    expect((chrome.storage as Dict).local).toBe((g.chrome as Dict).storage && ((g.chrome as Dict).storage as Dict).local)
  })

  it('storage.sync·session·managed 가 없으면 local 을 가리킨다', () => {
    const { chrome } = install()
    const s = chrome.storage as Dict
    expect(s.sync).toBe(s.local)
    expect(s.session).toBe(s.local)
    expect(s.managed).toBe(s.local)
  })

  it('콜백·Promise 두 모양을 다 받고 실패해도 던지지 않는다', async () => {
    call.mockRejectedValueOnce(new Error('bridge down'))
    const { chrome } = install()
    const tabs = chrome.tabs as Dict
    const cb = vi.fn()
    ;(tabs.create as (p: unknown, cb: unknown) => void)({ url: 'https://a/' }, cb)
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledWith(undefined)
    const p = (tabs.create as (p: unknown) => Promise<unknown>)({ url: 'https://b/' })
    await expect(p).resolves.toEqual({ id: 20, url: 'https://b/' })
  })
})

describe('chromeShim — 탭 동작은 앱 다리로 간다', () => {
  it('tabs.query 는 앱 탭(사용자가 보는 탭)으로 답하고, 다리가 null 이면 네이티브로 내려간다', async () => {
    const { chrome } = install()
    const tabs = chrome.tabs as Dict
    await expect((tabs.query as (q: unknown) => Promise<unknown>)({ active: true, currentWindow: true })).resolves.toEqual([
      { id: 12, url: 'https://www.instagram.com/', active: true }
    ])
    call.mockResolvedValueOnce(null)
    await expect((tabs.query as (q: unknown) => Promise<unknown>)({})).resolves.toEqual([{ id: 99, url: 'native' }])
  })

  it('create·remove·duplicate·goBack·captureVisibleTab 이 op 이름 그대로 다리에 간다', async () => {
    const { chrome } = install()
    const tabs = chrome.tabs as Dict
    await (tabs.create as (p: unknown) => Promise<unknown>)({ url: 'https://a/' })
    await (tabs.remove as (p: unknown) => Promise<unknown>)([1, 2])
    await (tabs.duplicate as (p: unknown) => Promise<unknown>)(5)
    await (tabs.goBack as (p?: unknown) => Promise<unknown>)()
    await (tabs.captureVisibleTab as (p?: unknown) => Promise<unknown>)(0, { format: 'png' })
    const ops = call.mock.calls.map((c) => [c[0], c[1]])
    expect(ops).toContainEqual(['create', { url: 'https://a/' }])
    expect(ops).toContainEqual(['remove', { tabIds: [1, 2] }])
    expect(ops).toContainEqual(['duplicate', { tabId: 5 }])
    expect(ops).toContainEqual(['goBack', { tabId: undefined }])
    expect(ops).toContainEqual(['captureVisibleTab', {}])
  })

  it('downloads.download 은 다리의 번호를 돌려준다', async () => {
    const { chrome } = install()
    const dl = chrome.downloads as Dict
    await expect((dl.download as (p: unknown) => Promise<unknown>)({ url: 'https://a/x.jpg' })).resolves.toBe(7)
    expect(call).toHaveBeenCalledWith('download', { url: 'https://a/x.jpg', id: 1 })
  })
})

describe('chromeShim — 아이콘 클릭·배지', () => {
  it("메인의 'actionClicked' 는 자기 확장 몫만 action.onClicked 로 쏜다(browserAction 도 같은 이벤트)", () => {
    const { chrome } = install()
    const fn = vi.fn()
    ;((chrome.browserAction as Dict).onClicked as { addListener: (f: unknown) => void }).addListener(fn)
    listeners[0]('actionClicked', { extensionId: 'otherotherotherotherotherotherot', tab: { id: 1 } })
    expect(fn).not.toHaveBeenCalled()
    listeners[0]('actionClicked', { extensionId: 'faglepdniaalgbkakcbhioblejlfoihn', tab: { id: 12, url: 'https://www.instagram.com/' } })
    expect(fn).toHaveBeenCalledWith({ id: 12, url: 'https://www.instagram.com/' })
  })

  it('setBadgeText 는 메인에 알리고 네이티브도 부른다', async () => {
    const { chrome } = install()
    const action = chrome.action as Dict
    await (action.setBadgeText as (d: unknown) => Promise<unknown>)({ text: '3' })
    expect(notify).toHaveBeenCalledWith('setBadgeText', { text: '3' })
  })
})

describe('chromeShim — Proxy 안전망', () => {
  it('목록에 없는 네임스페이스도 호출 가능한 스텁을 돌려준다(enterprise.x 등)', async () => {
    const { chrome } = install()
    const ent = (chrome as Dict).enterprise as Dict
    expect(ent).toBeTruthy()
    await expect(((ent.platformKeys as Dict) ? ent.getDeviceAttributes : ent.getDeviceAttributes) as unknown).toBeTypeOf('function')
    await expect((ent.getDeviceAttributes as () => Promise<unknown>)()).resolves.toBeUndefined()
    const ev = ent.onSomething as { addListener: (f: unknown) => void; hasListener: (f: unknown) => boolean }
    const f = (): void => {}
    ev.addListener(f)
    expect(ev.hasListener(f)).toBe(true)
  })

  it("기능 감지('x' in chrome)는 원본대로 거짓이라 확장의 대체 경로가 살아 있다", () => {
    const { chrome } = install()
    expect('enterprise' in chrome).toBe(false)
    expect('contextMenus' in chrome).toBe(true)
  })

  it('proxyFallback 을 끄면 미지 네임스페이스는 undefined 다', () => {
    const { chrome } = install({ proxyFallback: false })
    expect((chrome as Dict).enterprise).toBeUndefined()
  })
})

describe('chromeShim — 자급자족 함수여야 한다(executeInMainWorld 로 직렬화된다)', () => {
  it('함수 본문이 모듈 바깥 식별자를 참조하지 않는다', () => {
    const src = chromeShim.toString()
    // 번들러가 붙이는 헬퍼(__spreadArray 등)나 import 식별자가 끼면 메인 월드에서 ReferenceError 가 난다
    expect(src).not.toMatch(/__spread|__assign|__awaiter|__generator|require\(|import\(/)
  })
})
