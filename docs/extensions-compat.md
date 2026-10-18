# 크롬 확장 호환 — 구조와 "새 확장이 안 될 때 보는 순서"

작성 2026-10-18. 관련 코드: `src/preload/chrome-shim.ts`(범용 안전망), `src/preload/extension-sw.ts`(서비스워커),
`src/preload/extension-page.ts`(팝업·옵션·패널 문서), `src/main/extensions/tabs-bridge.ts`(탭·창·다운로드 다리),
`src/main/extensions/cookies-bridge.ts`(쿠키·이동 알림·워커 깨우기), `src/main/extensions/action.ts`·`popup-view.ts`(아이콘 클릭·팝업).

## 왜 이런 구조인가

Electron 39 는 크롬 확장 API 를 일부만 구현한다(2026-10-18 실측, 권한을 다 준 MV3 확장 기준):

| 있음(네이티브) | 없음 |
|---|---|
| runtime(메시지·getManifest·openOptionsPage…), storage(local·sync·session·managed), tabs(get·query 일부·update 일부·sendMessage·reload·zoom·이벤트 껍데기), scripting 전부, alarms, action 껍데기(배지·onClicked 는 안 그리고 안 쏨), i18n, idle, management, offscreen, declarativeNetRequest, extension.inIncognitoContext | cookies, windows, contextMenus, notifications, downloads, webNavigation, sidePanel, commands, permissions, identity, bookmarks, history, topSites, sessions, tabGroups, fontSettings, privacy, proxy, system.*, tts, omnibox, declarativeContent, userScripts, power, webRequest(확장용), dom, tabs.create/remove/duplicate/captureVisibleTab… |

없는 것을 확장이 부르면 `Cannot read properties of undefined` 로 **서비스워커가 첫 줄에서 죽고 뒤의 리스너가 하나도 안 걸린다**.
"설치했는데 아무 반응이 없다"는 거의 전부 이 증상이었다(ADPICK 9/26, 샵백 9/27, 삼바웨이브 9/28, IG Sorter 10/18).

또 크롬 쪽 UI 가 없다: 아이콘 클릭(onClicked)·팝업·사이드 패널·배지는 앱이 manifest 를 읽어 대신 그린다.
`electron-chrome-extensions` 라이브러리는 이걸 대신해 주지만 GPL-3 라 비공개 저장소·SaaS 에는 못 쓴다 → 자체 구현.

## 층 구조(위에서 아래로)

1. **확장별 보충(옛 땜질)** — `extension-sw.ts`·`extension-page.ts` 의 cookies·tabs.update·webNavigation 이벤트·alarms·setIcon 알림.
   실제 동작이 필요한 것들이라 남겨 둔다. 먼저 깔린다.
2. **범용 안전망 `chromeShim`** — 그 뒤에 깔린다. 없는 네임스페이스를 크롬 모양(메서드·이벤트 레지스트리)으로 채우고,
   tabs 의 빠진 메서드를 앱 다리로 보내며, `action.onClicked` 를 우리 레지스트리로 바꿔 아이콘 클릭을 전달한다.
   마지막으로 `chrome` 전역을 Proxy 로 감싸 **목록에도 없는 이름**(chrome.enterprise.x 등)까지 무해한 스텁으로 받는다.
   - 네이티브 API 는 덮지 않는다(예외: tabs.query 는 앱 탭 의미로, action.onClicked 는 레지스트리로).
   - `'x' in chrome` 은 원본대로라 확장의 기능 감지·대체 경로는 살아 있다. 직접 호출만 조용히 통과한다.
   - `chromeShim` 은 `executeInMainWorld` 로 **직렬화**되어 돈다 — 함수 바깥 값을 참조하면 안 된다(테스트가 검사).
3. **앱 다리(메인)** — `tabs-bridge.runTabsOp`: query/create/update/remove/duplicate/goBack/goForward/highlight/captureVisibleTab/
   download/openOptionsPage/windowGet. 서비스워커는 `samba-ext-tabs`, 문서는 `samba-ext-page` 채널로 온다.
4. **아이콘 클릭** — `handlers.ts extAction`: default_popup → 팝업 뷰, 없으면 side_panel.default_path → 팝업 자리에 폭 400 고정,
   없으면 옵션 페이지 새 탭, 그것도 없으면 `actionClicked` 를 세션의 워커에 보내 `chrome.action.onClicked` 가 불리게 한다.

## 새 확장이 안 될 때 보는 순서

1. **서비스워커 콘솔** — 앱 로그의 `[ext-console]`·`[ext-error]` 줄. `Uncaught TypeError … reading 'xxx'` 가 있으면
   그 네임스페이스/메서드가 빠진 것이다. 어느 층에서 메워야 하는지 정한다:
   - 무해하게 끝나도 되는 것 → `chrome-shim.ts` 의 `ensure(...)` 목록에 메서드 이름만 추가(스텁).
   - 실제 동작이 필요한 것(탭을 열어야 한다 등) → `tabs-bridge.runTabsOp` 에 op 를 추가하고 shim 에서 `bridged('op')`.
   - Proxy 안전망이 받는 이름이면 TypeError 는 없지만 결과가 `undefined` 다 — 확장이 그 값을 기다리면 멈춘다.
2. **아이콘을 눌러도 아무것도 안 뜸** — manifest 에 `action.default_popup`·`side_panel.default_path`·`options_ui` 가 있는지 본다.
   셋 다 없으면 확장은 `action.onClicked` 로 동작한다 → 앱이 `actionClicked` 를 보내는지(`[ext-nav] … actionClicked`), 워커가 떠 있는지 본다.
3. **팝업/패널은 뜨는데 버튼이 비활성** — 대개 콘텐츠 스크립트가 보내는 `runtime.sendMessage` 를 문서가 못 받은 것.
   Electron 은 콘텐츠 스크립트→확장 문서 메시지를 전달한다(탐침 확인 10/18). 그러면 콘텐츠 스크립트가 **안 돈 것**이다:
   확장이 그 탭의 세션(파티션)에 로드돼 있는지(`ExtensionManager.attachHost`), `content_scripts.matches` 가 맞는지 본다.
4. **tabs.query 가 엉뚱한 탭을 줌** — 팝업/워커 자신·앱 UI 가 섞이면 다리가 아니라 네이티브로 간 것이다. shim 이 깔렸는지(`[ext-ready]`), 다리 제공자(`setExtensionTabsProvider`)가 창에 꽂혔는지 본다.
5. **콘텐츠 스크립트 안의 chrome.*** — 콘텐츠 스크립트는 격리 월드라 우리 프리로드가 못 들어간다. 거기서 `chrome.dom` 같은
   것을 부르면 못 메운다(크롬도 콘텐츠 스크립트엔 runtime·storage·i18n·scripting 정도만 준다). 이 경우는 한계로 기록한다.
6. **재현은 별도 Electron 탐침으로** — 앱을 건드리지 말고 scratchpad 에 `main.cjs` 를 두고 `node_modules/electron/dist/electron.exe` 로
   띄운다(별도 userData). `ses.serviceWorkers.on('console-message')`, `ses.registerPreloadScript({type:'service-worker'|'frame'})`,
   `ses.extensions.loadExtension(폴더)`, `webContents.executeJavaScript` 로 상태를 읽는다. 10/18 탐침: `scratchpad/ig-probe`, `msg-probe`.

## 알려진 한계

- 배지(setBadgeText)는 메인에 알리기만 하고 아직 툴바에 그리지 않는다.
- 사이드 패널은 붙박이가 아니라 팝업(바깥 클릭에 닫힘)이다.
- contextMenus 는 등록만 받고 실제 메뉴에 나오지 않는다(onClicked 는 앱이 `contextMenuClicked` 를 보내면 쏠 수 있게 준비만).
- webRequest 리스너는 등록만 받는다(차단·수정은 안 된다). 광고 차단은 declarativeNetRequest(네이티브) 쪽만 동작한다.
- 콘텐츠 스크립트 월드는 보충하지 못한다(위 5).
