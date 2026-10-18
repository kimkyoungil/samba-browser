// 확장 chrome.* 범용 안전망 — 서비스워커·확장 문서(팝업·옵션·패널) 프리로드가 함께 쓴다.
//
// 왜: Electron 39 는 크롬 확장 API 의 일부(runtime·storage·tabs 일부·scripting·alarms·action 껍데기 등)만 구현한다.
// 없는 네임스페이스를 확장이 부르면 "Cannot read properties of undefined" 로 서비스워커가 첫 줄에서 죽고,
// 그 뒤 리스너가 하나도 안 걸려 "설치했는데 아무 반응이 없다"가 된다. 지금까지는 확장이 들어올 때마다
// (ADPICK·샵백·삼바웨이브·IG Sorter) 그 확장이 부르는 API 를 하나씩 메웠다(2026-09-26 ~ 10-18).
// 이 파일은 그 땜질을 범용으로 바꾼다:
//   1) 자주 쓰는 네임스페이스는 크롬과 같은 모양(메서드·이벤트)으로 미리 만든다 — 호출은 무해하게 끝나거나 앱 다리로 간다
//   2) 목록에 없는 네임스페이스는 chrome 전역을 Proxy 로 감싸 어떤 이름이든 호출 가능한 스텁을 돌려준다
//   3) 아이콘 클릭(action.onClicked)·탭 추가 동작은 앱 다리(tabs-bridge)로 실제 동작하게 한다
//
// 규칙
// - chromeShim 은 contextBridge.executeInMainWorld 로 **직렬화되어** 메인 월드에서 돈다. 함수 바깥의 어떤 값도
//   참조하면 안 된다(모듈 상수·다른 함수 import 금지). 필요한 것은 전부 인자로 받거나 안에서 만든다
// - 이미 있는(네이티브) API 는 덮지 않는다. 예외: tabs.query 는 앱 탭 의미(사용자가 보는 탭)로 맞추고,
//   action.onClicked 는 앱이 아이콘 클릭을 전달할 수 있게 우리 레지스트리로 바꾼다
// - 콜백·Promise 두 모양을 다 받는다(마지막 인자가 함수면 콜백)
// - 호출이 실패해도 던지지 않는다(undefined 로 끝낸다) — 확장이 죽는 것보다 조용히 비는 편이 낫다

/** 앱 다리 — 메인이 처리하는 탭·창·다운로드 동작(tabs-bridge runTabsOp 의 op 이름) */
export type ChromeShimCall = (op: string, details: unknown) => Promise<unknown>
/** 메인이 보내는 이벤트 구독 — kind: 'actionClicked' | 'activated' | 'committed' … */
export type ChromeShimListen = (fn: (kind: string, details: unknown) => void) => void
/** 메인에 알리기만 하는 것(배지·제목 변경 등) */
export type ChromeShimNotify = (op: string, details: unknown) => void

/** 실행 문맥 — 서비스워커(백그라운드)인지 확장 문서(팝업·옵션·패널)인지 */
export type ChromeShimContext = 'sw' | 'page'

/** 미지 네임스페이스까지 받는 Proxy 안전망을 깔지(테스트에서 끈다) */
export interface ChromeShimOptions {
  context: ChromeShimContext
  proxyFallback?: boolean
}

/**
 * 메인 월드에서 도는 본체. **자급자족 함수** — 바깥 스코프를 쓰지 않는다(위 규칙 참고).
 * 반환값은 테스트 편의용으로, 이벤트 레지스트리에 직접 이벤트를 넣어 볼 수 있다
 */
export function chromeShim(
  call: ChromeShimCall,
  listen: ChromeShimListen,
  notify: ChromeShimNotify,
  options: ChromeShimOptions
): { dispatch: (kind: string, details: unknown) => void } | undefined {
  type Fn = (...a: unknown[]) => unknown
  type Dict = Record<string, unknown>
  const g = globalThis as unknown as { chrome?: Dict }
  const c = g.chrome
  if (!c) return undefined
  const context = options.context

  // ---- 공통 도우미 ---------------------------------------------------------
  const lastFn = (a: unknown[]): Fn | undefined =>
    typeof a[a.length - 1] === 'function' ? (a[a.length - 1] as Fn) : undefined
  /** Promise 를 콜백/Promise 두 모양으로 돌려준다. 실패는 undefined 로 끝낸다 */
  const reply = (p: Promise<unknown>, cb: Fn | undefined): Promise<unknown> | undefined => {
    const safe = p.catch(() => undefined)
    if (!cb) return safe
    safe.then((v) => {
      try {
        cb(v)
      } catch {
        // 확장 콜백 오류는 삼킨다
      }
    })
    return undefined
  }
  const set = (o: Dict, k: string, v: unknown): void => {
    try {
      o[k] = v
    } catch {
      try {
        Object.defineProperty(o, k, { value: v, configurable: true, writable: true })
      } catch {
        // 못 쓰는 속성은 포기
      }
    }
  }
  const has = (o: Dict | undefined, k: string): boolean => !!o && typeof o[k] === 'function'
  const obj = (v: unknown): Dict => (typeof v === 'object' && v !== null ? (v as Dict) : {})

  /** 고정값(또는 계산값)을 돌려주는 무해한 메서드 */
  const fixed =
    (value?: unknown): Fn =>
    (...a: unknown[]) =>
      reply(
        new Promise((resolve) => resolve(typeof value === 'function' ? (value as Fn)(...a) : value)),
        lastFn(a)
      )
  /** 앱 다리로 가는 메서드. 인자 가공이 필요하면 map 을 준다(마지막 콜백은 빼고 준다) */
  const bridged =
    (op: string, map?: (a: unknown[]) => unknown): Fn =>
    (...a: unknown[]) => {
      const cb = lastFn(a)
      const args = cb ? a.slice(0, -1) : a
      return reply(call(op, map ? map(args) : (args[0] ?? {})), cb)
    }

  /** 크롬 이벤트 모양의 레지스트리. dispatch 로 우리가 쏜다 */
  interface Ev {
    addListener: (fn: Fn, ...rest: unknown[]) => void
    removeListener: (fn: Fn) => void
    hasListener: (fn: Fn) => boolean
    hasListeners: () => boolean
    dispatch: (...args: unknown[]) => void
    // declarativeContent.onPageChanged 가 쓴다
    addRules: Fn
    removeRules: Fn
    getRules: Fn
  }
  const events: Record<string, Ev> = {}
  const ev = (name: string): Ev => {
    const found = events[name]
    if (found) return found
    const listeners: Fn[] = []
    const e: Ev = {
      addListener: (fn) => {
        if (typeof fn === 'function' && !listeners.includes(fn)) listeners.push(fn)
      },
      removeListener: (fn) => {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      },
      hasListener: (fn) => listeners.includes(fn),
      hasListeners: () => listeners.length > 0,
      dispatch: (...args) => {
        for (const l of [...listeners]) {
          try {
            l(...args)
          } catch {
            // 리스너 하나의 오류가 다른 리스너를 막지 않게
          }
        }
      },
      addRules: fixed([]),
      removeRules: fixed(undefined),
      getRules: fixed([])
    }
    events[name] = e
    return e
  }

  /** chrome.privacy·proxy 가 쓰는 ChromeSetting 모양 */
  const setting = (name: string): Dict => ({
    get: fixed({ value: undefined, levelOfControl: 'not_controllable' }),
    set: fixed(undefined),
    clear: fixed(undefined),
    onChange: ev(name + '.onChange')
  })

  /** 이름 목록을 받아 무해한 메서드/이벤트로 채운 네임스페이스를 만든다 */
  const stubNs = (
    ns: string,
    methods: Record<string, unknown>,
    eventNames: string[] = []
  ): Dict => {
    const out: Dict = {}
    for (const k of Object.keys(methods)) {
      const v = methods[k]
      out[k] = typeof v === 'function' ? v : fixed(v)
    }
    for (const e of eventNames) out[e] = ev(ns + '.' + e)
    return out
  }
  /** 없을 때만 만든다 */
  const ensure = (name: string, make: () => Dict): Dict => {
    if (c[name] && typeof c[name] === 'object') return c[name] as Dict
    const made = make()
    set(c, name, made)
    return made
  }

  const runtime = obj(c.runtime)
  const ownId = (): string => (typeof runtime.id === 'string' ? runtime.id : '')

  // ---- tabs: 크롬에 있고 Electron 에 없는 메서드를 앱 탭으로 보충한다 ---------------
  const tabs = ensure('tabs', () => ({}))
  const tabId0 = (a: unknown[]): number | undefined => (typeof a[0] === 'number' ? a[0] : undefined)
  const tabAdds: Record<string, Fn> = {
    create: bridged('create'),
    remove: bridged('remove', (a) => ({ tabIds: a[0] })),
    duplicate: bridged('duplicate', (a) => ({ tabId: tabId0(a) })),
    goBack: bridged('goBack', (a) => ({ tabId: tabId0(a) })),
    goForward: bridged('goForward', (a) => ({ tabId: tabId0(a) })),
    highlight: bridged('highlight', (a) => ({ tabIds: obj(a[0]).tabs })),
    captureVisibleTab: bridged('captureVisibleTab', () => ({})),
    // 아래는 앱에 대응 개념이 없다 — 크롬이 돌려줄 법한 빈 값으로 끝낸다
    move: fixed(null),
    detectLanguage: fixed('und'),
    getCurrent: fixed(undefined),
    discard: fixed(undefined),
    group: fixed(-1),
    ungroup: fixed(undefined),
    getSelected: (...a: unknown[]) =>
      reply(
        call('query', { active: true }).then((r) => (Array.isArray(r) ? r[0] : undefined)),
        lastFn(a)
      ),
    getAllInWindow: bridged('query', () => ({})),
    // MV2 전용 — MV3 scripting 이 있어도 코드 문자열은 못 돌린다. 빈 결과로 끝낸다
    executeScript: fixed([]),
    insertCSS: fixed(undefined),
    removeCSS: fixed(undefined)
  }
  for (const k of Object.keys(tabAdds)) if (!has(tabs, k)) set(tabs, k, tabAdds[k])
  for (const e of ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced', 'onZoomChange', 'onHighlighted'])
    if (!tabs[e]) set(tabs, e, ev('tabs.' + e))
  if (tabs.TAB_ID_NONE === undefined) set(tabs, 'TAB_ID_NONE', -1)
  // query — Electron 네이티브는 세션의 webContents 를 섞어 돌려주고 currentWindow 를 모른다.
  // 앱 탭 목록(사용자가 보는 탭)으로 답하고, 다리가 없을 때만(null) 네이티브로 내려간다
  {
    const native = typeof tabs.query === 'function' ? (tabs.query as Fn).bind(tabs) : null
    set(tabs, 'query', (...a: unknown[]) => {
      const cb = lastFn(a)
      const q = obj(a[0])
      return reply(
        call('query', q).then((r) => {
          if (Array.isArray(r)) return r
          if (!native) return []
          return Promise.resolve(native(q)).then((n) => (Array.isArray(n) ? n : []))
        }),
        cb
      )
    })
  }

  // ---- action / browserAction / pageAction -------------------------------------
  // Electron 은 action 객체를 주지만 아이콘 클릭·배지를 그리지 않는다. onClicked 는 우리 레지스트리로 바꿔
  // 앱이 'actionClicked' 를 보내면 쏜다(팝업 없는 확장의 아이콘 클릭 — 크롬과 같은 경험)
  const clicked = ev('action.onClicked')
  const actionMethods = (): Record<string, unknown> => ({
    setIcon: undefined,
    setTitle: undefined,
    getTitle: '',
    setBadgeText: undefined,
    getBadgeText: '',
    setBadgeBackgroundColor: undefined,
    getBadgeBackgroundColor: [0, 0, 0, 0],
    setBadgeTextColor: undefined,
    getBadgeTextColor: [0, 0, 0, 0],
    setPopup: undefined,
    getPopup: '',
    enable: undefined,
    disable: undefined,
    isEnabled: true,
    openPopup: undefined,
    getUserSettings: { isOnToolbar: true },
    show: undefined,
    hide: undefined
  })
  const action = ensure('action', () => stubNs('action', actionMethods()))
  for (const k of Object.keys(actionMethods())) if (!has(action, k)) set(action, k, fixed(actionMethods()[k]))
  set(action, 'onClicked', clicked)
  if (!action.onUserSettingsChanged) set(action, 'onUserSettingsChanged', ev('action.onUserSettingsChanged'))
  // 배지·제목 변경은 메인에 알린다(툴바가 그릴 수 있게). 네이티브가 있으면 그것도 부른다
  for (const op of ['setBadgeText', 'setBadgeBackgroundColor', 'setTitle', 'setBadgeTextColor']) {
    const orig = typeof action[op] === 'function' ? (action[op] as Fn).bind(action) : null
    set(action, op, (...a: unknown[]) => {
      try {
        notify(op, a[0])
      } catch {
        // 알림 실패 무시
      }
      const cb = lastFn(a)
      if (!orig) return reply(Promise.resolve(undefined), cb)
      try {
        return reply(Promise.resolve(orig(...(cb ? a.slice(0, -1) : a))), cb)
      } catch {
        return reply(Promise.resolve(undefined), cb)
      }
    })
  }
  // MV2 이름은 action 을 그대로 가리킨다(이벤트 객체도 같은 것)
  if (!c.browserAction) set(c, 'browserAction', action)
  if (!c.pageAction) set(c, 'pageAction', action)

  // ---- storage: sync·session·managed 가 없으면 local 로 ----------------------------
  const storage = obj(c.storage)
  if (storage.local) {
    for (const area of ['sync', 'session', 'managed']) if (!storage[area]) set(storage, area, storage.local)
    if (!storage.onChanged) set(storage, 'onChanged', ev('storage.onChanged'))
  }

  // ---- runtime·extension 보충 --------------------------------------------------
  if (c.runtime) {
    if (!has(runtime, 'openOptionsPage'))
      set(runtime, 'openOptionsPage', bridged('openOptionsPage', () => ({})))
    if (!has(runtime, 'setUninstallURL')) set(runtime, 'setUninstallURL', fixed(undefined))
    if (!has(runtime, 'requestUpdateCheck')) set(runtime, 'requestUpdateCheck', fixed({ status: 'no_update' }))
    if (!has(runtime, 'getPlatformInfo'))
      set(runtime, 'getPlatformInfo', fixed({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' }))
    for (const e of ['onUpdateAvailable', 'onStartup', 'onSuspend', 'onSuspendCanceled', 'onMessageExternal', 'onConnectExternal', 'onRestartRequired'])
      if (!runtime[e]) set(runtime, e, ev('runtime.' + e))
  }
  const extension = ensure('extension', () => ({}))
  if (!has(extension, 'getURL') && has(runtime, 'getURL')) set(extension, 'getURL', (p: unknown) => (runtime.getURL as Fn)(p))
  if (!has(extension, 'isAllowedFileSchemeAccess')) set(extension, 'isAllowedFileSchemeAccess', fixed(false))
  if (!has(extension, 'isAllowedIncognitoAccess')) set(extension, 'isAllowedIncognitoAccess', fixed(false))
  if (!has(extension, 'getViews')) set(extension, 'getViews', () => [])
  if (extension.inIncognitoContext === undefined) set(extension, 'inIncognitoContext', false)

  // ---- 자주 쓰이는데 Electron 에 없는 네임스페이스 ------------------------------------
  // 각 메서드는 크롬이 돌려줄 법한 "빈" 값으로 끝낸다. 이벤트는 레지스트리라 나중에 앱이 쏠 수 있다
  let menuSeq = 0
  ensure('contextMenus', () =>
    stubNs(
      'contextMenus',
      {
        create: (...a: unknown[]) => {
          const props = obj(a[0])
          const id = props.id !== undefined ? props.id : ++menuSeq
          // 크롬은 두 번째 인자 콜백을 "만들어졌다" 신호로 부른다
          const cb = lastFn(a)
          if (cb) setTimeout(() => cb(), 0)
          return id
        },
        update: undefined,
        remove: undefined,
        removeAll: undefined,
        ACTION_MENU_TOP_LEVEL_LIMIT: 6
      },
      ['onClicked']
    )
  )
  ensure('commands', () => stubNs('commands', { getAll: [] }, ['onCommand']))
  let downloadSeq = 0
  ensure('downloads', () =>
    stubNs(
      'downloads',
      {
        download: (...a: unknown[]) => {
          const cb = lastFn(a)
          const id = ++downloadSeq
          return reply(
            call('download', { ...obj(a[0]), id }).then((r) => (typeof r === 'number' ? r : id)),
            cb
          )
        },
        search: [],
        pause: undefined,
        resume: undefined,
        cancel: undefined,
        erase: [],
        removeFile: undefined,
        acceptDanger: undefined,
        open: undefined,
        show: undefined,
        showDefaultFolder: undefined,
        getFileIcon: '',
        setUiOptions: undefined,
        setShelfEnabled: undefined
      },
      ['onCreated', 'onChanged', 'onErased', 'onDeterminingFilename']
    )
  )
  ensure('notifications', () =>
    stubNs(
      'notifications',
      {
        create: (...a: unknown[]) =>
          reply(Promise.resolve(typeof a[0] === 'string' ? a[0] : 'samba-note-' + Date.now()), lastFn(a)),
        update: false,
        clear: true,
        getAll: {},
        getPermissionLevel: 'granted'
      },
      ['onClicked', 'onClosed', 'onButtonClicked', 'onPermissionLevelChanged', 'onShowSettings']
    )
  )
  ensure('permissions', () =>
    stubNs(
      'permissions',
      {
        contains: true,
        request: true,
        remove: true,
        getAll: () => {
          const m = obj(has(runtime, 'getManifest') ? (runtime.getManifest as Fn)() : {})
          return {
            permissions: Array.isArray(m.permissions) ? m.permissions : [],
            origins: Array.isArray(m.host_permissions) ? m.host_permissions : []
          }
        }
      },
      ['onAdded', 'onRemoved']
    )
  )
  ensure('identity', () =>
    stubNs('identity', {
      getProfileUserInfo: { email: '', id: '' },
      getAuthToken: undefined,
      removeCachedAuthToken: undefined,
      clearAllCachedAuthTokens: undefined,
      getRedirectURL: '',
      launchWebAuthFlow: undefined,
      getAccounts: []
    }, ['onSignInChanged'])
  )
  ensure('sidePanel', () =>
    stubNs('sidePanel', {
      setPanelBehavior: undefined,
      getPanelBehavior: { openPanelOnActionClick: true },
      setOptions: undefined,
      getOptions: { enabled: true },
      open: undefined
    })
  )
  ensure('bookmarks', () =>
    stubNs(
      'bookmarks',
      { get: [], getChildren: [], getRecent: [], getTree: [], getSubTree: [], search: [], create: {}, move: {}, update: {}, remove: undefined, removeTree: undefined },
      ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded']
    )
  )
  ensure('history', () =>
    stubNs(
      'history',
      { search: [], getVisits: [], addUrl: undefined, deleteUrl: undefined, deleteRange: undefined, deleteAll: undefined },
      ['onVisited', 'onVisitRemoved']
    )
  )
  ensure('topSites', () => stubNs('topSites', { get: [] }))
  ensure('sessions', () =>
    stubNs('sessions', { getRecentlyClosed: [], getDevices: [], restore: undefined, MAX_SESSION_RESULTS: 25 }, ['onChanged'])
  )
  ensure('tabGroups', () =>
    stubNs('tabGroups', { get: null, query: [], update: null, move: null, TAB_GROUP_ID_NONE: -1 }, ['onCreated', 'onUpdated', 'onMoved', 'onRemoved'])
  )
  ensure('fontSettings', () => {
    const ns = stubNs(
      'fontSettings',
      { getFontList: [], clearFont: undefined, getFont: { fontId: '', levelOfControl: 'not_controllable' }, setFont: undefined },
      ['onFontChanged']
    )
    for (const k of ['DefaultFontSize', 'DefaultFixedFontSize', 'MinimumFontSize']) {
      ns['get' + k] = fixed({ pixelSize: 16, levelOfControl: 'not_controllable' })
      ns['set' + k] = fixed(undefined)
      ns['clear' + k] = fixed(undefined)
      ns['on' + k + 'Changed'] = ev('fontSettings.on' + k + 'Changed')
    }
    return ns
  })
  ensure('privacy', () => ({
    network: { networkPredictionEnabled: setting('privacy.network.networkPredictionEnabled'), webRTCIPHandlingPolicy: setting('privacy.network.webRTCIPHandlingPolicy') },
    services: {
      alternateErrorPagesEnabled: setting('privacy.services.alternateErrorPagesEnabled'),
      autofillEnabled: setting('privacy.services.autofillEnabled'),
      autofillAddressEnabled: setting('privacy.services.autofillAddressEnabled'),
      autofillCreditCardEnabled: setting('privacy.services.autofillCreditCardEnabled'),
      passwordSavingEnabled: setting('privacy.services.passwordSavingEnabled'),
      safeBrowsingEnabled: setting('privacy.services.safeBrowsingEnabled'),
      searchSuggestEnabled: setting('privacy.services.searchSuggestEnabled'),
      spellingServiceEnabled: setting('privacy.services.spellingServiceEnabled'),
      translationServiceEnabled: setting('privacy.services.translationServiceEnabled')
    },
    websites: {
      thirdPartyCookiesAllowed: setting('privacy.websites.thirdPartyCookiesAllowed'),
      hyperlinkAuditingEnabled: setting('privacy.websites.hyperlinkAuditingEnabled'),
      referrersEnabled: setting('privacy.websites.referrersEnabled'),
      doNotTrackEnabled: setting('privacy.websites.doNotTrackEnabled'),
      protectedContentEnabled: setting('privacy.websites.protectedContentEnabled'),
      topicsEnabled: setting('privacy.websites.topicsEnabled'),
      fledgeEnabled: setting('privacy.websites.fledgeEnabled'),
      adMeasurementEnabled: setting('privacy.websites.adMeasurementEnabled')
    }
  }))
  ensure('proxy', () => ({ settings: setting('proxy.settings'), onProxyError: ev('proxy.onProxyError') }))
  ensure('system', () => ({
    cpu: stubNs('system.cpu', { getInfo: { numOfProcessors: 4, archName: 'x86_64', modelName: '', features: [], processors: [] } }),
    memory: stubNs('system.memory', { getInfo: { capacity: 0, availableCapacity: 0 } }),
    display: stubNs('system.display', { getInfo: [] }, ['onDisplayChanged']),
    storage: stubNs('system.storage', { getInfo: [], ejectDevice: 'failure', getAvailableCapacity: { id: '', availableCapacity: 0 } }, ['onAttached', 'onDetached'])
  }))
  ensure('tts', () =>
    stubNs('tts', { speak: undefined, stop: undefined, pause: undefined, resume: undefined, isSpeaking: false, getVoices: [] }, ['onEvent', 'onVoicesChanged'])
  )
  ensure('ttsEngine', () => stubNs('ttsEngine', { updateVoices: undefined, sendTtsEvent: undefined }, ['onSpeak', 'onStop', 'onPause', 'onResume']))
  ensure('omnibox', () =>
    stubNs('omnibox', { setDefaultSuggestion: undefined }, ['onInputStarted', 'onInputChanged', 'onInputEntered', 'onInputCancelled', 'onDeleteSuggestion'])
  )
  ensure('declarativeContent', () => {
    // 규칙 생성자들은 받은 값을 그대로 담는 객체로 — new 로 불리므로 함수여야 한다
    const ctor = function (this: Dict, v: unknown) {
      Object.assign(this, obj(v))
    }
    return {
      onPageChanged: ev('declarativeContent.onPageChanged'),
      PageStateMatcher: ctor,
      ShowAction: ctor,
      ShowPageAction: ctor,
      SetIcon: ctor,
      RequestContentScript: ctor
    }
  })
  ensure('userScripts', () =>
    stubNs('userScripts', { register: undefined, update: undefined, unregister: undefined, getScripts: [], configureWorld: undefined, resetWorldConfiguration: undefined, getWorldConfigurations: [] })
  )
  ensure('power', () => stubNs('power', { requestKeepAwake: undefined, releaseKeepAwake: undefined, reportActivity: undefined }))
  ensure('search', () => stubNs('search', { query: undefined }))
  ensure('readingList', () =>
    stubNs('readingList', { addEntry: undefined, removeEntry: undefined, updateEntry: undefined, query: [] }, ['onEntryAdded', 'onEntryRemoved', 'onEntryUpdated'])
  )
  ensure('browsingData', () => {
    const ns = stubNs('browsingData', { remove: undefined, settings: { options: {}, dataToRemove: {}, dataRemovalPermitted: {} } })
    for (const k of ['Appcache', 'Cache', 'CacheStorage', 'Cookies', 'Downloads', 'FileSystems', 'FormData', 'History', 'IndexedDB', 'LocalStorage', 'PluginData', 'Passwords', 'ServiceWorkers', 'WebSQL'])
      ns['remove' + k] = fixed(undefined)
    return ns
  })
  ensure('webRequest', () =>
    stubNs(
      'webRequest',
      { handlerBehaviorChanged: undefined, MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES: 20 },
      ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onAuthRequired', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred', 'onActionIgnored']
    )
  )
  ensure('webNavigation', () =>
    stubNs(
      'webNavigation',
      { getFrame: null, getAllFrames: [] },
      ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated', 'onHistoryStateUpdated', 'onTabReplaced']
    )
  )
  ensure('tabCapture', () => stubNs('tabCapture', { capture: null, getCapturedTabs: [], getMediaStreamId: '' }, ['onStatusChanged']))
  ensure('desktopCapture', () => stubNs('desktopCapture', { chooseDesktopMedia: 0, cancelChooseDesktopMedia: undefined }))
  ensure('pageCapture', () => stubNs('pageCapture', { saveAsMHTML: null }))
  ensure('gcm', () => stubNs('gcm', { register: '', unregister: undefined, send: '', MAX_MESSAGE_SIZE: 4096 }, ['onMessage', 'onMessagesDeleted', 'onSendError']))
  ensure('instanceID', () =>
    stubNs('instanceID', { getID: '', getCreationTime: 0, getToken: '', deleteToken: undefined, deleteID: undefined }, ['onTokenRefresh'])
  )
  ensure('idle', () => stubNs('idle', { queryState: 'active', setDetectionInterval: undefined, getAutoLockDelay: 0 }, ['onStateChanged']))
  ensure('alarms', () => {
    // 워커 타이머로 흉내 — extension-sw 의 기존 구현이 먼저 깔리면 여기는 돌지 않는다
    type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number }
    const alarms = new Map<string, { alarm: Alarm; timer: ReturnType<typeof setTimeout> }>()
    const onAlarm = ev('alarms.onAlarm')
    const fire = (name: string): void => {
      const entry = alarms.get(name)
      if (!entry) return
      const { alarm } = entry
      if (alarm.periodInMinutes && alarm.periodInMinutes > 0) {
        alarm.scheduledTime = Date.now() + alarm.periodInMinutes * 60000
        entry.timer = setTimeout(() => fire(name), alarm.periodInMinutes * 60000)
      } else alarms.delete(name)
      onAlarm.dispatch({ ...alarm })
    }
    return {
      create: (...a: unknown[]) => {
        const name = typeof a[0] === 'string' ? a[0] : ''
        const info = obj(typeof a[0] === 'string' ? a[1] : a[0]) as { when?: number; delayInMinutes?: number; periodInMinutes?: number }
        const old = alarms.get(name)
        if (old) clearTimeout(old.timer)
        const delayMs =
          typeof info.when === 'number'
            ? Math.max(0, info.when - Date.now())
            : typeof info.delayInMinutes === 'number'
              ? info.delayInMinutes * 60000
              : (info.periodInMinutes ?? 1) * 60000
        const alarm: Alarm = { name, scheduledTime: Date.now() + delayMs, periodInMinutes: info.periodInMinutes }
        alarms.set(name, { alarm, timer: setTimeout(() => fire(name), delayMs) })
        return reply(Promise.resolve(undefined), lastFn(a))
      },
      get: (...a: unknown[]) => reply(Promise.resolve(alarms.get(typeof a[0] === 'string' ? a[0] : '')?.alarm), lastFn(a)),
      getAll: (...a: unknown[]) => reply(Promise.resolve([...alarms.values()].map((e) => ({ ...e.alarm }))), lastFn(a)),
      clear: (...a: unknown[]) => {
        const name = typeof a[0] === 'string' ? a[0] : ''
        const e = alarms.get(name)
        if (e) clearTimeout(e.timer)
        return reply(Promise.resolve(alarms.delete(name)), lastFn(a))
      },
      clearAll: (...a: unknown[]) => {
        for (const e of alarms.values()) clearTimeout(e.timer)
        alarms.clear()
        return reply(Promise.resolve(true), lastFn(a))
      },
      onAlarm
    }
  })
  ensure('offscreen', () =>
    stubNs('offscreen', { createDocument: undefined, closeDocument: undefined, hasDocument: false, Reason: {} })
  )
  ensure('management', () =>
    stubNs(
      'management',
      {
        getAll: [],
        get: null,
        getSelf: () => {
          const m = obj(has(runtime, 'getManifest') ? (runtime.getManifest as Fn)() : {})
          return { id: ownId(), name: m.name ?? '', version: m.version ?? '', enabled: true, type: 'extension', installType: 'normal', mayDisable: true }
        },
        getPermissionWarningsById: [],
        getPermissionWarningsByManifest: [],
        setEnabled: undefined,
        uninstall: undefined,
        uninstallSelf: undefined,
        launchApp: undefined
      },
      ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled']
    )
  )
  // uBlock 등이 닫힌 shadow root 를 열어 볼 때 쓴다 — 열린 것만 돌려준다
  ensure('dom', () => ({
    openOrClosedShadowRoot: (el: unknown) => (obj(el).shadowRoot as unknown) ?? null
  }))
  if (!c.windows) {
    const win = bridged('windowGet', (a) => obj(typeof a[0] === 'number' ? a[1] : a[0]))
    set(c, 'windows', {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      get: win,
      getCurrent: win,
      getLastFocused: win,
      getAll: (...a: unknown[]) => reply(call('windowGet', obj(a[0])).then((w) => [w]), lastFn(a)),
      // 새 창 대신 새 탭으로 연다(앱은 창 하나)
      create: (...a: unknown[]) => {
        const url = obj(a[0]).url
        const first = Array.isArray(url) ? url[0] : url
        return reply(
          call('create', { url: typeof first === 'string' ? first : undefined }).then(() => call('windowGet', {})),
          lastFn(a)
        )
      },
      update: (...a: unknown[]) => reply(call('windowGet', {}), lastFn(a)),
      remove: fixed(undefined),
      onCreated: ev('windows.onCreated'),
      onRemoved: ev('windows.onRemoved'),
      onFocusChanged: ev('windows.onFocusChanged'),
      onBoundsChanged: ev('windows.onBoundsChanged')
    })
  }

  // ---- 메인에서 오는 이벤트 → 레지스트리 ---------------------------------------
  const dispatch = (kind: string, details: unknown): void => {
    const d = obj(details)
    if (kind === 'actionClicked') {
      // 다른 확장 몫은 무시한다(메인은 세션의 모든 워커에 보낸다)
      if (typeof d.extensionId === 'string' && d.extensionId !== ownId()) return
      clicked.dispatch(d.tab ?? d)
      return
    }
    if (kind === 'commandFired') {
      if (typeof d.extensionId === 'string' && d.extensionId !== ownId()) return
      ev('commands.onCommand').dispatch(d.command, d.tab)
      return
    }
    if (kind === 'contextMenuClicked') {
      if (typeof d.extensionId === 'string' && d.extensionId !== ownId()) return
      ev('contextMenus.onClicked').dispatch(d.info, d.tab)
    }
  }
  try {
    listen(dispatch)
  } catch {
    // 구독 실패해도 나머지는 유효하다
  }

  // ---- 미지 네임스페이스 안전망: chrome 전역을 Proxy 로 감싼다 -----------------------
  // 목록에 없는 이름(chrome.enterprise.x 등)을 불러도 TypeError 대신 무해한 함수/이벤트가 나온다.
  // `in` 검사·열거는 원본대로라 기능 감지 코드는 "없다"고 보고, 직접 호출만 조용히 통과한다
  if (options.proxyFallback !== false) {
    const generic = new Map<string, Dict>()
    const genericNs = (name: string): Dict => {
      const found = generic.get(name)
      if (found) return found
      const members = new Map<string, unknown>()
      const ns = new Proxy({} as Dict, {
        get: (_t, k) => {
          if (typeof k !== 'string' || k === 'then' || k === 'toJSON' || k === 'constructor') return undefined
          const m = members.get(k)
          if (m) return m
          const v = /^on[A-Z]/.test(k) ? ev(name + '.' + k) : fixed(undefined)
          members.set(k, v)
          return v
        }
      })
      generic.set(name, ns)
      return ns
    }
    try {
      const proxied = new Proxy(c, {
        get: (t, k, r) => {
          if (k in t) return Reflect.get(t, k, r)
          if (typeof k !== 'string' || k === 'then' || k === 'toJSON' || k === 'constructor') return undefined
          return genericNs(k)
        }
      })
      Object.defineProperty(g, 'chrome', { value: proxied, configurable: true, writable: true, enumerable: true })
    } catch {
      // 전역을 못 바꾸면 큐레이션 목록만으로 간다
    }
  }

  void context
  return { dispatch }
}
