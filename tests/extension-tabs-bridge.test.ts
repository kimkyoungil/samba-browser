// 확장 탭·창 다리 — 팝업의 tabs.query({active}) 가 사용자가 보던 탭을, create·update·remove 가 앱 탭을 다룬다

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, WebContents } from 'electron'
import {
  allowedTabUrl,
  matchesQuery,
  openTabFromExtension,
  runTabsOp,
  setExtensionTabsProvider,
  toChromeTab,
  WINDOW_ID,
  type ExtensionTabsProvider
} from '../src/main/extensions/tabs-bridge'

const EXT = 'chjgdkpobojcndfcmondbplekkffknod'
const ses = {} as Session

function fakeWc(id: number, url: string): WebContents {
  return {
    id,
    getURL: () => url,
    getTitle: () => `t${id}`,
    isLoading: () => false,
    loadURL: vi.fn(async () => {})
  } as unknown as WebContents
}

let list: Array<{ wc: WebContents; active: boolean; profile: string }>
let provider: ExtensionTabsProvider

beforeEach(() => {
  list = [
    { wc: fakeWc(11, 'https://www.musinsa.com/products/1'), active: false, profile: 'default' },
    { wc: fakeWc(12, 'https://www.ssg.com/item/2'), active: true, profile: 'default' }
  ]
  provider = {
    tabs: () => list,
    create: vi.fn((url: string, profile: string, active: boolean) => {
      const wc = fakeWc(20, url)
      list.push({ wc, active, profile })
      return wc
    }),
    close: vi.fn(),
    activate: vi.fn(),
    profileOf: () => 'buyer01'
  }
  setExtensionTabsProvider(provider)
})

describe('runTabsOp', () => {
  it('query({active}) 는 팝업이 아니라 지금 보고 있는 앱 탭을 돌려준다', () => {
    const out = runTabsOp('query', { active: true, windowId: -2 }, ses, EXT) as Array<{ id: number; url: string }>
    expect(out.map((t) => t.id)).toEqual([12])
    expect(out[0].url).toBe('https://www.ssg.com/item/2')
  })

  it('create 는 호출한 세션의 프로필로 탭을 연다', () => {
    const tab = runTabsOp('create', { url: 'https://adpick.co.kr/' }, ses, EXT) as { id: number }
    expect(provider.create).toHaveBeenCalledWith('https://adpick.co.kr/', 'buyer01', true)
    expect(tab.id).toBe(20)
  })

  it('웹 주소·자기 확장 문서만 연다(다른 스킴은 거절)', () => {
    expect(runTabsOp('create', { url: 'file:///C:/x' }, ses, EXT)).toBeNull()
    expect(runTabsOp('create', { url: 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x.html' }, ses, EXT)).toBeNull()
    expect(provider.create).not.toHaveBeenCalled()
  })

  it('update 에 tabId 가 없으면 보고 있는 탭을 이동시킨다(적립 링크)', () => {
    runTabsOp('update', { tabId: null, props: { url: 'https://adpick.co.kr/track?x=1' } }, ses, EXT)
    expect(list[1].wc.loadURL).toHaveBeenCalledWith('https://adpick.co.kr/track?x=1')
    expect(list[0].wc.loadURL).not.toHaveBeenCalled()
  })

  it('remove 는 id 로 찾은 탭만 닫는다', () => {
    runTabsOp('remove', { tabIds: [11, 99] }, ses, EXT)
    expect(provider.close).toHaveBeenCalledTimes(1)
    expect(provider.close).toHaveBeenCalledWith(list[0].wc)
  })

  it('windowGet 은 앱 창 하나를 돌려준다(populate 면 탭 포함)', () => {
    const w = runTabsOp('windowGet', { populate: true }, ses, EXT) as { id: number; tabs: unknown[] }
    expect(w.id).toBe(WINDOW_ID)
    expect(w.tabs).toHaveLength(2)
  })

  it('탭 관리자가 없으면 null', () => {
    setExtensionTabsProvider(null)
    expect(runTabsOp('query', {}, ses, EXT)).toBeNull()
  })
})

describe('보조 함수', () => {
  it('matchesQuery 는 url 패턴의 * 를 와일드카드로 본다', () => {
    const t = toChromeTab(fakeWc(1, 'https://www.ssg.com/item/2'), 0, true)
    expect(matchesQuery(t, { url: 'https://*.ssg.com/*' })).toBe(true)
    expect(matchesQuery(t, { url: 'https://*.musinsa.com/*' })).toBe(false)
    expect(matchesQuery(t, { active: false })).toBe(false)
  })

  it('allowedTabUrl', () => {
    expect(allowedTabUrl('https://a.com', EXT)).toBe(true)
    expect(allowedTabUrl(`chrome-extension://${EXT}/index.html`, EXT)).toBe(true)
    expect(allowedTabUrl('javascript:alert(1)', EXT)).toBe(false)
  })
})

describe('openTabFromExtension — 팝업이 연 새 창(로그인 페이지)을 새 탭으로', () => {
  it('웹 주소는 그 세션 프로필의 새 탭으로 연다', () => {
    expect(openTabFromExtension('https://www.shopback.co.kr/login', ses)).toBe(true)
    expect(provider.create).toHaveBeenCalledWith('https://www.shopback.co.kr/login', 'buyer01', true)
  })

  it('웹 주소가 아니면 열지 않는다', () => {
    expect(openTabFromExtension('file:///C:/x', ses)).toBe(false)
    expect(provider.create).not.toHaveBeenCalled()
  })
})

describe('runTabsOp — 범용 안전망(chrome-shim)이 쓰는 op', () => {
  it('duplicate 는 같은 주소로 새 탭을 연다', () => {
    const tab = runTabsOp('duplicate', { tabId: 11 }, ses, EXT) as { url: string }
    expect(provider.create).toHaveBeenCalledWith('https://www.musinsa.com/products/1', 'default', true)
    expect(tab.url).toBe('https://www.musinsa.com/products/1')
  })

  it('goBack 은 지정 탭(없으면 보는 탭)의 이력을 뒤로 돌린다', () => {
    const goBack = vi.fn()
    ;(list[1].wc as unknown as { navigationHistory: unknown }).navigationHistory = { goBack, goForward: vi.fn() }
    expect(runTabsOp('goBack', {}, ses, EXT)).toBe(true)
    expect(goBack).toHaveBeenCalled()
  })

  it('highlight 는 첫 탭을 활성화하고 창 정보를 돌려준다', () => {
    const w = runTabsOp('highlight', { tabIds: [11] }, ses, EXT) as { id: number }
    expect(provider.activate).toHaveBeenCalledWith(list[0].wc)
    expect(w.id).toBe(WINDOW_ID)
  })

  it('captureVisibleTab 은 보는 탭의 그림을 data URL 로 준다', async () => {
    ;(list[1].wc as unknown as { capturePage: unknown }).capturePage = vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,AA==' }))
    await expect(runTabsOp('captureVisibleTab', {}, ses, EXT)).resolves.toBe('data:image/png;base64,AA==')
  })

  it('download 은 웹 주소만 세션 다운로드로 보내고 번호를 돌려준다', () => {
    const downloadURL = vi.fn()
    const s = { downloadURL } as unknown as Session
    expect(runTabsOp('download', { url: 'https://a/x.jpg', id: 3 }, s, EXT)).toBe(3)
    expect(downloadURL).toHaveBeenCalledWith('https://a/x.jpg')
    expect(runTabsOp('download', { url: 'file:///C:/x' }, s, EXT)).toBeNull()
  })

  it('openOptionsPage 는 manifest 의 옵션 문서를 확장 주소로 연다', () => {
    const s = { extensions: { getExtension: () => ({ manifest: { options_ui: { page: 'options.html' } } }) } } as unknown as Session
    const tab = runTabsOp('openOptionsPage', {}, s, EXT) as { url: string }
    expect(tab.url).toBe(`chrome-extension://${EXT}/options.html`)
  })
})
