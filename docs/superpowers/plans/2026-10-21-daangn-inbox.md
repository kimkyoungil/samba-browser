# 당근 통합 채팅함 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 삼바 브라우저에 "당근" 페이지를 추가해, 여러 당근 계정의 채팅을 한 목록(기본 안 읽음만, 최근순)으로 모아 보고 계정별로 거르고, 오른쪽에서 당근 채팅 화면 그대로 답장하며 자주 쓰는 답변 템플릿을 입력칸에 채운다.

**Architecture:** 계정마다 전용 파티션의 독립 `WebContentsView`(TabManager 미경유)가 `https://chat.daangn.com/` 를 띄우고, 메인 프로세스 `DaangnService` 가 상시 뷰(기본 8개)와 순환 임시 뷰(동시 3개)로 목록 DOM 을 읽어 합쳐 렌더러에 보낸다. 방을 고르면 그 계정 뷰를 오른쪽 영역 bounds 에 붙인다(당근 자체 목록 패널은 CSS 로 가림). 순서·합치기·알림 판정·뷰 스케줄·시각 파싱은 전부 순수 함수로 떼어 단위 시험한다.

**Tech Stack:** Electron(WebContentsView·Notification), TypeScript, drizzle + sqlite(`0011` 마이그레이션), React + Zustand + Tailwind, i18next(ko/en), vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-daangn-inbox-design.md`

## Global Constraints

- 코드 주석은 한국어, 들여쓰기 스페이스 2칸, 세미콜론 없음, 작은따옴표, `any` 금지, 문자열은 i18n ko/en 둘 다(`src/renderer/src/i18n/ko.json`·`en.json`, 메인은 `tr()`).
- 계정 파티션 이름: `persist:<작업공간접두사>__daangn-<id>__` — 만들 때 한 번 정해 테이블 `partition` 컬럼에 저장하고 그 문자열만 쓴다(작업공간 전환과 무관). `__…__` 는 내부 프로필 규칙이라 사용자 프로필 목록에 안 보인다.
- 뷰는 **TabManager 를 타지 않는 독립 WebContentsView**. 페이지 preload·확장·금고 저장 바 없음. 직접 챙길 것: `setWindowOpenHandler`(링크는 기본 브라우저, 새 창 금지), `will-navigate`/`will-redirect` 가드(`chat.daangn.com`·`accounts.daangn.com` 밖 금지), 권한 요청 거부, 다운로드 거부, 대화상자 자동 닫기.
- 상시 뷰 기본 8(`daangnWarmViews`), 임시 뷰 동시 3(`daangnTempViews`), 폴링 5000ms(`daangnScanIntervalMs`), 비상시 계정 재읽기 최소 간격 120초(`daangnRotateIntervalSec`) — 그래도 모든 계정이 3분 안에 한 번은 읽힘. 알림 쿨다운 같은 방 2분. 알림 기본 켬(`daangnNotify`), 기능 스위치 `daangnEnabled` 기본 켬.
- 템플릿 글자 수 상한 500, 기본값 없음, 계정 공통. 보내기 버튼은 우리가 누르지 않는다.
- 새 테이블 `daangn_accounts`·`daangn_templates` 는 PC 로컬 전용 — `SYNC_TABLES` 에 넣지 않는다. 새 설정 키는 동기화 대상(`SYNCED_SETTING_KEYS`)에 넣지 않는다.
- 저장소 규칙(CLAUDE.md): 커밋은 지정 경로만 `git add <경로>` 후 메인 트리에 직접 하고 곧바로 `git push origin master`. 커밋 메시지 한국어. 앱 `out/` 은 `pwsh scripts/deploy-app.ps1` 로만 만들고 재시작은 하네스 큐가 5분 빌 때만(`-Restart`).
- 테스트 실행: `node node_modules/vitest/vitest.mjs run <파일>`, 타입 검사: `npm run typecheck`.

## Review Focus

명세는 있어야 할 것을 말하지만 아래 입력·조건에는 침묵한다. 각 줄의 시험은 오너 Task 에 들어 있다.

1. **앱 시작 직후 첫 읽기에서 알림이 쏟아지지 않는다** — 안 읽음 50건이 이미 쌓인 채로 켜도 알림 0건, 그 뒤 늘어난 방만 알림(Task 5).
2. **안 읽은 수 표기가 "99+"·빈 값·글자만 있는 배지여도 숫자로 읽힌다** — 못 읽으면 0 이 아니라 1 이상으로 본다(안 읽음이 목록에서 빠지면 안 됨)(Task 3).
3. **한 계정의 읽기 실패·로그인 풀림이 다른 계정 목록을 지우지 않는다** — 실패한 계정의 옛 목록은 지우고 나머지는 그대로(Task 6).
4. **다른 계정 방이 열려 있을 때 템플릿 채우기가 엉뚱한 계정 입력칸으로 가지 않는다** — 선택 계정과 열린 뷰 계정이 다르면 거부(Task 8).
5. **계정이 0개이거나 창이 닫힐 때 뷰·타이머가 남지 않는다** — 계정 0개면 뷰 0·타이머 0, 종료 훅에서 전부 해제(Task 6).
6. (덤) 템플릿에 줄바꿈·이모지·따옴표가 있어도 입력칸에 그대로 들어간다(Task 8).

---

## File Structure

| 파일 | 책임 |
|------|------|
| `src/shared/daangn.ts` | DTO·상수, 순수 함수(`parseUnread`·`parseKoreanTime`·`filterChannels`·`unreadByAccount`) |
| `src/shared/settings.ts` (수정) | 새 설정 키 6개 |
| `src/shared/ipc.ts` (수정) | `daangn:*` 채널 이름 |
| `src/main/db/schema.ts`·`migrations.ts` (수정) | `daangn_accounts`·`daangn_templates`, 마이그레이션 `0011_daangn` |
| `src/main/daangn/repo.ts` | 계정·템플릿 저장소 |
| `src/main/daangn/selectors.ts` | chat.daangn.com DOM 선택자·읽기 스크립트·`parseScan` |
| `src/main/daangn/url-guard.ts` | `classifyChatUrl`·`isAllowedChatUrl` |
| `src/main/daangn/account-view.ts` | 계정 1개의 WebContentsView 래퍼 |
| `src/main/daangn/schedule.ts` | `planScan`(상시·임시 뷰 선택), `diffUnread`, `NotifyThrottle` |
| `src/main/daangn/service.ts` | 뷰 풀·폴링·합치기·알림·창 붙이기 |
| `src/main/daangn/register.ts` | IPC 등록(`registerDaangnIpc`) |
| `src/main/ipc/handlers.ts`·`src/preload/renderer.ts` (수정) | 배선, `window.samba.daangn` |
| `src/renderer/src/stores/daangnStore.ts` | 계정·목록·선택·템플릿 상태 |
| `src/renderer/src/pages/DaangnPage.tsx` + `components/daangn/*` | 3단 화면 |
| `src/renderer/src/stores/uiStore.ts`·`App.tsx`·`sidebar-view.ts`·`Sidebar.tsx`·i18n (수정) | 새 뷰·사이드바 항목 |
| `tests/daangn-*.test.ts` | 순수 함수·저장소 시험 |

---

### Task 1: 공용 타입·순수 함수·설정 키

**Files:**
- Create: `src/shared/daangn.ts`
- Modify: `src/shared/settings.ts`(기본값·zod 스키마 — `phoneCardOrder` 옆 규칙 참고)
- Test: `tests/daangn-shared.test.ts`

**Interfaces:**
- Produces(`src/shared/daangn.ts`):
  - `DAANGN_ACCOUNT_STATES = ['loading','logged_in','expired','read_failed'] as const`, `type DaangnAccountState`
  - `interface DaangnAccountDto { id: number; label: string; displayName: string; profileImage: string | null; state: DaangnAccountState; unread: number }`
  - `interface DaangnChannelDto { accountId: number; roomId: string; peerName: string; region: string; lastMessage: string; lastAt: number; lastAtText: string; unread: number; productTitle: string; productThumb: string | null }` (`lastAt` 은 epoch ms, 못 읽으면 0)
  - `interface DaangnTemplateDto { id: number; text: string; sortOrder: number }`, `interface DaangnBounds { x: number; y: number; width: number; height: number }`
  - `const DAANGN_TEMPLATE_MAX = 500`
  - `parseUnread(text: string): number`, `parseKoreanTime(text: string, now: Date): number`, `filterChannels(list: readonly DaangnChannelDto[], opts: { accountId: number | null; unreadOnly: boolean }): DaangnChannelDto[]`, `unreadByAccount(list: readonly DaangnChannelDto[]): Record<number, number>`
- 설정 키(기본값): `daangnEnabled: true`, `daangnWarmViews: 8`, `daangnTempViews: 3`, `daangnScanIntervalMs: 5000`, `daangnRotateIntervalSec: 120`, `daangnNotify: true`.

- [ ] **Step 1: 실패하는 시험을 쓴다** — `tests/daangn-shared.test.ts`
  - `parseUnread`: `'3'→3`, `'99+'→99`, `'N'→1`(글자만 있는 배지는 1 이상), `''→0`, `'  12 '→12`, `'0'→0`.
  - `parseKoreanTime`(now = 2026-10-21 16:00 KST): `'오후 03:26'→ 오늘 15:26`, `'오전 12:05'→ 오늘 00:05`, `'오후 12:10'→ 오늘 12:10`, `'어제'→ 어제 00:00 이상 24:00 미만`, `'10월 20일'→ 2026-10-20 00:00`, `'2025년 3월 2일'→ 2025-03-02 00:00`, 알 수 없는 글 `'방금'→ now`(방금은 최신), `'???'→0`.
  - `filterChannels`: unreadOnly 면 unread>0 만, accountId 가 있으면 그 계정만, 결과는 `lastAt` 내림차순이고 같으면 `roomId` 사전순(안정 정렬). 원본 배열을 바꾸지 않는다.
  - `unreadByAccount`: 계정별 합계, 없는 계정은 키 없음.
  - 설정: `settingsSchema.parse({})` 가 새 키 6개를 위 기본값으로 채우고, `SYNCED_SETTING_KEYS` 에 이 키들이 없음을 단언(`src/shared/sync.ts` 의 배열 import).
- [ ] **Step 2: 시험이 실패하는지 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-shared.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3: 구현** — 위 시그니처대로 `src/shared/daangn.ts` 작성. 시각 파싱은 한국 시간(로컬 타임존) 기준 정규식 분기, 정렬은 `Array.prototype.toSorted` 대신 복사 후 sort. `settings.ts` 에는 `phoneCardOrder` 와 같은 자리에 기본값 + zod 항목(`z.boolean().catch(...)`, `z.number().int().min(…).max(…).catch(...)`: warm 1~30, temp 1~10, scanInterval 2000~60000, rotate 30~900)을 추가.
- [ ] **Step 4: 시험 통과 확인** — 같은 명령 → PASS. `npm run typecheck` 오류 0.
- [ ] **Step 5: 커밋** — `git add src/shared/daangn.ts src/shared/settings.ts tests/daangn-shared.test.ts` → `git commit -m "추가: 당근 채팅함 공용 타입·순수 함수·설정 키"` → `git push origin master`.

---

### Task 2: 저장소(계정·템플릿)와 마이그레이션

**Files:**
- Modify: `src/main/db/schema.ts`(테이블 정의 2개), `src/main/db/migrations.ts`(`0011_daangn` 추가 — 형식은 `0010_auth_events_pay_method` 항목 참고, `optional: true`)
- Create: `src/main/daangn/repo.ts`
- Test: `tests/daangn-repo.test.ts`

**Interfaces:**
- Consumes: `Db`(`src/main/db/client.ts`), `DaangnTemplateDto`·`DaangnAccountState`(Task 1).
- Produces(`DaangnRepo`, 생성자 `new DaangnRepo(db: Db)`):
  - `interface DaangnAccountRow { id: number; label: string; partition: string; displayName: string; profileImage: string | null; state: DaangnAccountState; lastSeenAt: number; createdAt: number }`
  - `addAccount(input: { label: string; partitionPrefix: string }): DaangnAccountRow` — 행을 만든 뒤 `partition = ${partitionPrefix}__daangn-${id}__` 로 채운다. 같은 별칭 허용(중복은 막지 않음), 빈 별칭이면 `계정 N`.
  - `listAccounts(): DaangnAccountRow[]`(id 오름차순), `setLabel(id: number, label: string): void`, `setIdentity(id: number, displayName: string, profileImage: string | null): void`, `setState(id: number, state: DaangnAccountState, at: number): void`, `removeAccount(id: number): void`
  - 템플릿: `listTemplates(): DaangnTemplateDto[]`(sortOrder 순), `saveTemplate(input: { id?: number; text: string }): DaangnTemplateDto`(앞뒤 공백 제거, 빈 글·500자 초과는 `Error`), `deleteTemplate(id: number): void`, `reorderTemplates(ids: readonly number[]): void`

- [ ] **Step 1: 실패하는 시험** — `:memory:` DB 에서: 계정 추가 시 `partition` 이 `persist:ws1-__daangn-<id>__` 형식, 빈 별칭 기본값, 같은 별칭 두 개 허용, `removeAccount` 뒤 목록에서 사라짐; 템플릿 저장·수정(같은 id)·삭제·`reorderTemplates([3,1,2])` 뒤 순서, 빈 글·501자는 던짐, 줄바꿈·이모지·따옴표 포함 글이 그대로 저장; `SYNC_TABLES` 에 두 테이블이 없음 단언.
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-repo.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 스키마 컬럼: accounts(`id` PK autoincrement, `label` text, `partition` text unique, `display_name` text default '', `profile_image` text null, `state` text default 'loading', `last_seen_at` integer default 0, `created_at` integer), templates(`id`, `text`, `sort_order` integer, `created_at`). 마이그레이션 SQL 은 `CREATE TABLE IF NOT EXISTS` 형식. 저장소는 `src/main/phone/repo.ts` 의 drizzle 사용 방식을 따른다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `node node_modules/vitest/vitest.mjs run tests/db*.test.ts` 로 기존 마이그레이션 시험이 안 깨졌는지 확인.
- [ ] **Step 5: 커밋** — `git add src/main/db/schema.ts src/main/db/migrations.ts src/main/daangn/repo.ts tests/daangn-repo.test.ts` → `git commit -m "추가: 당근 계정·템플릿 저장소와 마이그레이션 0011"` → `git push origin master`.

---

### Task 3: DOM 선택자·읽기 결과 해석·주소 판정(순수)

**Files:**
- Create: `src/main/daangn/selectors.ts`, `src/main/daangn/url-guard.ts`
- Test: `tests/daangn-selectors.test.ts`

**Interfaces:**
- Consumes: `parseUnread`, `parseKoreanTime`(Task 1).
- Produces:
  - `selectors.ts`: `SELECTORS`(객체: 목록 줄·방 링크·상대 이름·지역·마지막 메시지·시각·안 읽은 배지·상품 썸네일·상품 제목·내 이름·내 프로필 사진·"안읽은 메시지만 보기" 토글·메시지 입력칸·목록 패널)와 `buildScanScript(): string`(페이지 안에서 실행해 `RawScan` JSON 을 돌려주는 스크립트 문자열), `buildHideListCss(): string`(당근 자체 목록 패널을 `display:none` 으로 가리는 CSS), `buildFillScript(text: string): string`(입력칸 native setter + `input` 이벤트로 `text` 를 넣고 성공이면 `true`).
  - `interface RawScan { me: { displayName: string; profileImage: string | null } | null; rows: RawRow[] }`, `interface RawRow { href: string; peerName: string; region: string; lastMessage: string; timeText: string; unreadText: string; productTitle: string; productThumb: string | null }`
  - `parseScan(raw: unknown, accountId: number, now: Date): { me: RawScan['me']; channels: DaangnChannelDto[] }` — `href` 의 `/room/<id>` 에서 `roomId` 를 뽑고, 형식이 다른 줄·`roomId` 없는 줄은 건너뛴다. 입력이 객체가 아니면 `Error`(읽기 실패로 취급).
  - `url-guard.ts`: `classifyChatUrl(url: string): 'chat' | 'login' | 'other'`(`chat.daangn.com/login` 과 `accounts.daangn.com` 은 `'login'`, 그 밖의 `chat.daangn.com` 은 `'chat'`), `isAllowedChatUrl(url: string): boolean`(`chat.daangn.com`·`accounts.daangn.com`·`business-gateway.daangn.com`·`karrotauth-http.*.karrotmarket.com` 만 true), `roomIdOf(url: string): string | null`.

- [ ] **Step 1: 실패하는 시험** — `parseScan`: 정상 2줄(안 읽음 `'3'`·`'99+'`)이 `DaangnChannelDto` 로 바뀌고 `lastAt` 이 파싱됨; `href` 가 `/room/UMTA1ODgt…` 형식에서 `roomId` 추출; `/room/` 없는 줄 건너뜀; 입력 `null`·`'x'` 는 던짐; `unreadText: ''` 인데 줄에 배지 요소만 있는 경우(`'N'`) 1 로 읽음. `classifyChatUrl`·`isAllowedChatUrl`: `https://chat.daangn.com/room/abc→'chat'`, `https://chat.daangn.com/login→'login'`, `https://accounts.daangn.com/sign-in?next=…→'login'`, `https://evil.com/→'other'`/false, `https://chat.daangn.com.evil.com/` 는 false(접미사 속임수). `buildFillScript('안녕 "하세요"\n두번째 줄 😀')` 이 문자열을 이스케이프해 그대로 담음(생성된 스크립트에 `JSON.stringify` 결과가 들어 있음을 단언).
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-selectors.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 선택자 값은 **실제 로그인된 chat.daangn.com 화면에서 확인해 채운다**: 크롬 확장 탭 도구로 로그인된 탭을 열어 목록 줄·배지·입력칸 요소를 조사해 `SELECTORS` 에 적는다(클래스명이 해시면 `role`·`aria-label`·구조 위치 기준). 확인한 DOM 조각을 `tests/fixtures/daangn-list.html` 로 저장하고, 선택자가 그 조각에서 목록 줄 수를 맞히는 시험을 하나 더 추가한다(이 저장소에 jsdom 이 없으면 정규식 대신 `buildScanScript` 의 순수 부분을 Node 에서 돌릴 수 있게 `parseScan` 입력만 시험하고, 선택자 정합은 Task 4 수동 확인으로 둔다 — 어느 쪽인지 이 단계에서 정하고 커밋 메시지에 적는다).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `git add src/main/daangn/selectors.ts src/main/daangn/url-guard.ts tests/daangn-selectors.test.ts tests/fixtures/daangn-list.html` → `git commit -m "추가: 당근 채팅 DOM 선택자·읽기 결과 해석·주소 판정"` → push.

---

### Task 4: 계정 뷰(독립 WebContentsView)

**Files:**
- Create: `src/main/daangn/account-view.ts`
- Modify: `src/shared/ipc.ts`(Task 6 에서 쓸 채널은 그때 추가 — 여기선 없음)
- Test: `tests/daangn-account-view.test.ts`(Electron 없이 가능한 순수 부분만)

**Interfaces:**
- Consumes: `classifyChatUrl`·`isAllowedChatUrl`·`roomIdOf`(Task 3), `buildScanScript`·`buildHideListCss`·`buildFillScript`·`parseScan`, `DaangnBounds`(Task 1).
- Produces: `class DaangnAccountView`
  - `constructor(deps: { accountId: number; partition: string; now: () => Date; openExternal: (url: string) => void })`
  - `start(host: BrowserWindow): Promise<void>` — 파티션 세션으로 `WebContentsView` 를 만들어 `host.contentView` 에 **화면 밖 bounds** 로 붙이고(`{ x: -10000, y: -10000, width: 1100, height: 800 }` — 뷰포트가 0 이 되지 않게) `https://chat.daangn.com/` 를 연다. 필수 보안 설정은 Global Constraints 그대로.
  - `stop(): void`(뷰를 창에서 떼고 `webContents.close()`), `state(): DaangnAccountState`(주소가 `login` 이면 `'expired'`, 목록이 그려졌으면 `'logged_in'`, 그 전엔 `'loading'`), `scan(): Promise<{ me: …; channels: DaangnChannelDto[] }>`, `openRoom(roomId: string): Promise<void>`, `currentRoomId(): string | null`, `show(bounds: DaangnBounds): void`(그 영역에 붙이고 `buildHideListCss` 를 `insertCSS`), `hide(): void`(다시 화면 밖), `fillText(text: string): Promise<boolean>`, `openLogin(): Promise<void>`(뷰를 `https://chat.daangn.com/login` 으로 보냄 — Task 6 `addAccount`·Task 10 `relogin` 이 씀), `webContents(): WebContents | null`.
- 순수 보조: `export function offscreenBounds(): DaangnBounds`, `export function clampBounds(b: DaangnBounds): DaangnBounds`(음수·NaN 폭 방지, 최소 폭 640 — 이보다 좁으면 당근이 1단 배치로 바뀜).

- [ ] **Step 1: 실패하는 시험** — `clampBounds({x:0,y:0,width:300,height:-5})` 가 `width 640`·`height ≥ 1` 로 보정, NaN 입력은 화면 밖 기본값; `offscreenBounds()` 가 `x<0` 이고 폭·높이 > 0.
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-account-view.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `DaangnAccountView`. `will-navigate`·`will-redirect` 에서 `isAllowedChatUrl` 밖이면 `preventDefault`, `setWindowOpenHandler` 는 `openExternal(url)` 후 `{ action: 'deny' }`, `session.setPermissionRequestHandler`/`setPermissionCheckHandler` 는 거부, `will-download` 는 취소, `webContents.on('dialog'…)` 대신 `window.alert/confirm` 은 `did-finish-load` 에서 무력화. `scan()` 은 `executeJavaScript(buildScanScript())` 결과를 `parseScan` 에 넘기고, 주소가 `login` 이면 `state()` 를 `'expired'` 로 두고 빈 목록을 돌려준다. 읽기가 3회 연속 던지면 `'read_failed'`.
- [ ] **Step 4: 시험 통과 + 실제 확인** — 시험 PASS. 그다음 `run` 스킬로 앱을 띄우거나 개발 스크립트에서 계정 하나를 임시로 만들어(이 단계 전용 임시 코드, 커밋하지 않음): (a) 화면 밖 bounds 에서도 `executeJavaScript('innerWidth')` 가 0 보다 크고 로그인된 계정이면 목록 줄이 읽히는지, (b) `show()` 후 당근 자체 목록 패널이 가려지고 방 화면만 보이는지, (c) 영역 폭 640 에서 1단 배치로 안 바뀌는지를 확인한다. 안 되면 `offscreenBounds`·최소 폭 값을 조정해 시험을 고친다.
- [ ] **Step 5: 커밋** — `git add src/main/daangn/account-view.ts tests/daangn-account-view.test.ts` → `git commit -m "추가: 당근 계정 뷰(독립 WebContentsView, 화면 밖 폴링·방 붙이기)"` → push.

---

### Task 5: 스케줄·알림 판정(순수)

**Files:**
- Create: `src/main/daangn/schedule.ts`
- Test: `tests/daangn-schedule.test.ts`

**Interfaces:**
- Consumes: `DaangnChannelDto`(Task 1).
- Produces:
  - `planScan(input: { accountIds: readonly number[]; unread: Readonly<Record<number, number>>; lastReadAt: Readonly<Record<number, number>>; warm: ReadonlySet<number>; selectedId: number | null; now: number; warmMax: number; tempMax: number; minGapMs: number }): { warm: number[]; temp: number[] }`
    - warm = 선택 계정(있으면 항상) → 안 읽음 많은 순 → 이미 상시였던 계정 순으로 `warmMax` 까지(상시 유지 우선, 자리 바꿈 최소). temp = warm 이 아닌 계정 중 `now - lastReadAt >= minGapMs` 인 것을 **가장 오래 안 읽은 순**으로 `tempMax` 까지.
  - `diffUnread(prev: ReadonlyMap<string, number> | null, next: readonly DaangnChannelDto[]): DaangnChannelDto[]` — 키는 `${accountId}:${roomId}`. `prev === null`(앱 시작 직후 첫 읽기)이면 빈 배열, 아니면 안 읽은 수가 늘어난 방만.
  - `class NotifyThrottle { constructor(cooldownMs: number); allow(key: string, now: number): boolean }`(같은 키는 쿨다운 안이면 false, 허용하면 시각을 갱신)

- [ ] **Step 1: 실패하는 시험**
  - `planScan`: 계정 50개·warmMax 8·tempMax 3 에서 선택 계정은 항상 warm, 안 읽음 있는 계정이 warm 우선, 이전 warm 이 안 읽음 없어도 자리가 남으면 유지; temp 는 3개이고 warm 과 겹치지 않으며 `lastReadAt` 이 가장 오래된 순; `minGapMs` 안에 읽은 계정은 temp 에서 빠짐; 42개 비상시 계정을 10초 틱마다 돌리면 `lastReadAt` 갱신 가정으로 15틱(150초) 안에 전부 한 번씩 뽑힘(시뮬레이션 루프로 단언); 계정 0개면 `{warm:[],temp:[]}`.
  - `diffUnread`: `prev===null` → `[]`(Review Focus 1); prev 에 없던 새 방(unread>0)은 알림 대상; 2→2 는 아님; 3→5 는 대상; 5→0 은 아님.
  - `NotifyThrottle(120000)`: 같은 키 0초 true·60초 false·121초 true, 다른 키는 독립.
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-schedule.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 시그니처대로. 순수 함수만(전역 시각·타이머 금지).
- [ ] **Step 4: 통과 확인** — PASS, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `git add src/main/daangn/schedule.ts tests/daangn-schedule.test.ts` → `git commit -m "추가: 당근 뷰 스케줄(상시·순환)·알림 판정"` → push.

---

### Task 6: 서비스·IPC 배선·계정 추가(QR)

**Files:**
- Create: `src/main/daangn/service.ts`, `src/main/daangn/register.ts`
- Modify: `src/shared/ipc.ts`(채널 추가), `src/main/ipc/handlers.ts`(폰 화면 배선 옆에 `registerDaangnIpc` 호출 + `onShutdown(() => daangn.dispose())`), `src/preload/renderer.ts`(`window.samba.daangn`)
- Test: `tests/daangn-service.test.ts`

**Interfaces:**
- Consumes: Task 1~5 전부, `WindowManager.primary()`(`src/main/browser/window-manager.ts`).
- Produces:
  - IPC 채널(`src/shared/ipc.ts`): `daangnAccountsList: 'daangn:accounts:list'`, `daangnAccountAdd`, `daangnAccountRemove`, `daangnAccountSetLabel`, `daangnAccountRelogin`, `daangnChannelsList`, `daangnRoomOpen`, `daangnRoomBounds`, `daangnRoomClose`, `daangnRoomFill`, `daangnTemplatesList`, `daangnTemplateSave`, `daangnTemplateDelete`, `daangnTemplatesReorder`; 이벤트 `daangnUpdated: 'daangn:updated'`(페이로드 `DaangnStateDto = { accounts: DaangnAccountDto[]; channels: DaangnChannelDto[] }`), `daangnNotifyClick: 'daangn:notifyClick'`(페이로드 `{ accountId: number; roomId: string }`).
  - `class DaangnService`: `constructor(deps: { repo: DaangnRepo; host: () => BrowserWindow; settings: () => Settings; send: (channel: string, payload: unknown) => void; notify: (title: string, body: string, onClick: () => void) => void; now: () => number; partitionPrefix: string; createView: (a: { accountId: number; partition: string }) => AccountViewLike })` — `AccountViewLike` 는 `DaangnAccountView` 의 공개 메서드 부분집합(시험에서 가짜로 갈아끼움).
  - `start(): void`(계정이 1개 이상일 때만 틱 타이머 시작 — Review Focus 5), `dispose(): void`, `snapshot(): DaangnStateDto`, `addAccount(label: string): Promise<DaangnAccountDto>`(새 계정은 `login` 화면을 오른쪽 영역에 보여 QR 로그인), `removeAccount(id: number): void`, `openRoom(accountId: number, roomId: string): Promise<void>`, `setRoomBounds(b: DaangnBounds | null): void`, `closeRoom(): void`, `fillText(accountId: number, text: string): Promise<boolean>`.
  - `registerDaangnIpc(deps: { handle: <A extends unknown[], T>(channel: string, fn: (...a: A) => T | Promise<T>) => void; service: DaangnService; repo: DaangnRepo }): void`.
  - 렌더러 API(`window.samba.daangn`, 메서드 이름 고정 — 반환은 모두 `Promise<IpcResult<…>>`): `accountsList()`, `addAccount(label: string)`, `removeAccount(id: number)`, `setAccountLabel(id: number, label: string)`, `relogin(id: number)`, `channelsList()`, `openRoom(accountId: number, roomId: string)`, `setRoomBounds(b: DaangnBounds | null)`, `closeRoom()`, `fillText(accountId: number, text: string)`, `templatesList()`, `saveTemplate(input: { id?: number; text: string })`, `deleteTemplate(id: number)`, `reorderTemplates(ids: number[])`; 이벤트 구독 `onUpdated(cb: (s: DaangnStateDto) => void): () => void`, `onNotifyClick(cb: (p: { accountId: number; roomId: string }) => void): () => void`.

- [ ] **Step 1: 실패하는 시험** — 가짜 `createView`·가짜 시계로:
  - 계정 0개: `start()` 후 `createView` 호출 0·타이머 0(`vi.useFakeTimers()` 의 `getTimerCount()===0`), `dispose()` 뒤에도 0(Review Focus 5).
  - 계정 3개·한 계정 `scan()` 이 던짐 → 그 계정 `state` 가 `'read_failed'` 로 바뀌고 나머지 두 계정의 채널은 `snapshot().channels` 에 그대로(Review Focus 3); 로그인 풀림(`state()==='expired'`)이면 그 계정 채널만 제거되고 `daangn:updated` 가 나감.
  - 첫 틱에서는 알림 0건, 두 번째 틱에서 안 읽음이 늘어난 방에만 `notify` 1건, 같은 방 2분 안 재알림 없음(Review Focus 1 재확인), `daangnNotify=false` 면 0건.
  - `openRoom(2,'r1')` → 그 계정 뷰의 `openRoom`·`show` 호출, 이전에 열려 있던 다른 계정 뷰는 `hide`; `closeRoom()` → `hide`.
  - `dispose()` 가 모든 가짜 뷰의 `stop()` 을 부르고 타이머를 모두 해제.
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-service.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 틱 주기 10초(`ROTATE_TICK_MS`) 로 `planScan` → 상시 뷰는 `daangnScanIntervalMs` 마다 `scan()`, 임시 뷰는 틱마다 `start`→`scan`→`stop`(임시 뷰 한 계정당 최대 10초 대기, 목록이 안 그려지면 읽기 실패로 처리). 결과를 계정별 맵에 합쳐 `snapshot()` 을 만들고 변화가 있으면 `daangn:updated` 전송. 알림은 `diffUnread`+`NotifyThrottle(120000)`, 클릭 시 `daangn:notifyClick` 전송 + 앱 창 앞세움(마지막 활성 창, 없으면 `primary()`). 계정을 처음 보이는 로그인 직후 `setIdentity` 로 `displayName`·`profileImage` 저장. 호스트 창이 닫히면 뷰를 새 호스트로 옮긴다(`host()` 를 매 틱 다시 읽어 바뀌었으면 `stop`→`start`). `handlers.ts` 에서 `windows.primary()` 기반 `host` 를 넘긴다. `index.ts` 변경 없음(핸들러 배선에서 `service.start()`).
- [ ] **Step 4: 통과 확인** — 시험 PASS, `npm run typecheck`, `npm run lint` 오류 0.
- [ ] **Step 5: 커밋** — `git add src/main/daangn/service.ts src/main/daangn/register.ts src/shared/ipc.ts src/main/ipc/handlers.ts src/preload/renderer.ts tests/daangn-service.test.ts` → `git commit -m "추가: 당근 채팅함 서비스(뷰 풀·폴링·알림)와 IPC 배선"` → push.

---

### Task 7: 렌더러 — 스토어·3단 화면·계정 추가

**Files:**
- Create: `src/renderer/src/stores/daangnStore.ts`, `src/renderer/src/pages/DaangnPage.tsx`, `src/renderer/src/components/daangn/AccountPanel.tsx`, `ChannelList.tsx`, `RoomPane.tsx`
- Modify: `src/renderer/src/stores/uiStore.ts`(`MainView` 에 `'daangn'`), `App.tsx`(`view === 'daangn' ? <DaangnPage />` 추가), `src/renderer/src/components/layout/sidebar-view.ts`(`SIDEBAR_ITEMS` 에 `{ key: 'daangn', view: 'daangn' }`)·`Sidebar.tsx`(`ICONS.daangn`, lucide `MessageCircle`), `ko.json`·`en.json`(`sidebar.daangn: "당근"/"Daangn"`, `daangn.*` 문구)
- Test: `tests/daangn-view.test.ts`

**Interfaces:**
- Consumes: `window.samba.daangn`(Task 6), `filterChannels`·`unreadByAccount`(Task 1).
- Produces: `useDaangnStore` — 상태 `accounts`, `channels`, `selectedAccountId: number | null`, `unreadOnly: boolean`(기본 true), `openRoom: { accountId: number; roomId: string } | null`, `templates: DaangnTemplateDto[]`; 액션 `load()`, `subscribe(): () => void`, `selectAccount(id: number | null)`, `setUnreadOnly(v: boolean)`, `openChannel(c: DaangnChannelDto)`, `addAccount(label: string)`, `removeAccount(id)`, `renameAccount(id, label)`. 순수 보조 `export function visibleChannels(state: Pick<DaangnStoreState,'channels'|'selectedAccountId'|'unreadOnly'>): DaangnChannelDto[]`(= `filterChannels` 호출) — 시험 대상.

- [ ] **Step 1: 실패하는 시험** — `visibleChannels`: 기본 `unreadOnly:true`·`selectedAccountId:null` 이면 모든 계정의 안 읽은 방이 최근순; 계정 선택 시 그 계정만; `unreadOnly:false` 면 읽은 방 포함; 같은 `lastAt` 은 `roomId` 순.
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-view.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 3단: `AccountPanel`(폭 190, "전체"+계정 줄+안 읽음 배지, 로그인 풀림은 빨간 "다시 로그인" 줄, 맨 아래 "＋ 계정 추가"), `ChannelList`(폭 330, 칩 [안읽음 N][전체], 줄: 상대·시각 / 마지막 메시지 / `별칭 · 상품명 · 배지`, 읽은 줄은 흐리게), `RoomPane`(영역 `div` 하나를 `ref` 로 잡고 `ResizeObserver` + `getBoundingClientRect` 를 창 좌표로 바꿔 `daangn.setRoomBounds` 를 보낸다 — 언마운트·다른 화면 전환 때 `setRoomBounds(null)` 로 뷰를 접는다. 방이 없으면 안내 문구). 계정 추가는 별칭 입력 후 `addAccount` → `RoomPane` 이 그 계정의 로그인(QR) 화면을 보여 준다. 스타일은 `PhonesPage.tsx`·`PhoneCard.tsx` 의 토큰(`var(--line)`·`text-[var(--text)]`)을 따른다. 시안: `.superpowers/brainstorm/328448-1792564530/content/inbox-layout.html`.
- [ ] **Step 4: 통과 확인** — 시험 PASS, `npm run typecheck`·`npm run lint`. `run` 스킬로 앱을 띄워 사이드바 "당근" → 3단 화면, 계정 추가(QR) → 로그인 후 목록이 채워지는 것을 직접 확인하고 스크린샷을 남긴다.
- [ ] **Step 5: 커밋** — 변경 경로를 `git add` 로 지정(다른 세션 변경이 섞이지 않게 `git status` 확인) → `git commit -m "추가: 당근 채팅함 화면(계정 패널·통합 목록·방 영역·계정 추가)"` → push.

---

### Task 8: 방 열기·템플릿 채우기·모달 접기

**Files:**
- Modify: `src/main/daangn/service.ts`(`fillText` 검증), `src/renderer/src/components/daangn/RoomPane.tsx`(템플릿 줄), `src/renderer/src/stores/daangnStore.ts`
- Create: `src/renderer/src/components/daangn/TemplateBar.tsx`
- Test: `tests/daangn-service.test.ts`(추가), `tests/daangn-selectors.test.ts`(추가)

**Interfaces:**
- Consumes: `DaangnService.fillText(accountId, text)`(Task 6), `buildFillScript`(Task 3), `daangnTemplatesList`(Task 6).
- Produces: `DaangnService.fillText` 는 `accountId` 가 지금 열린 방의 계정과 다르면 입력칸을 건드리지 않고 `false`(Review Focus 4). `TemplateBar` 컴포넌트: `export function TemplateBar(props: { templates: readonly DaangnTemplateDto[]; disabled: boolean; onPick: (text: string) => void; onEdit: () => void }): React.JSX.Element`. 스토어 액션 `fillTemplate(text: string): Promise<boolean>`.

- [ ] **Step 1: 실패하는 시험** — 서비스: 2번 계정 방이 열린 상태에서 `fillText(1, '안녕')` → `false` 이고 어떤 뷰의 `fillText` 도 호출되지 않음; `fillText(2, '안녕')` → 2번 뷰의 `fillText('안녕')` 1회 호출·`true`; 방이 닫혀 있으면 `false`. 선택자: `buildFillScript` 로 만든 스크립트 문자열이 줄바꿈 `\n`·큰따옴표·이모지를 `JSON.stringify` 형태로 담고 `</script>` 같은 조각이 있어도 문자열 리터럴 밖으로 새지 않음(Review Focus 6).
- [ ] **Step 2: 실패 확인** — 두 시험 파일 실행 → FAIL.
- [ ] **Step 3: 구현** — `RoomPane` 아래에 `TemplateBar`(칩 줄 + "＋ 편집", 방이 없으면 `disabled`). 칩을 누르면 `fillTemplate` → 입력칸에만 채우고 보내기는 누르지 않는다. **모달 접기**: 템플릿 편집 대화상자·토스트가 열리는 동안 `setRoomBounds(null)` 로 뷰를 접고 닫히면 원래 bounds 를 다시 보낸다(스토어의 `modalOpen` 카운터로 관리).
- [ ] **Step 4: 통과 확인** — 시험 PASS, `npm run typecheck`. 앱에서 방을 열고 칩 클릭 → 당근 입력칸에 글이 들어가는지, 글자 유실·개행 처리가 맞는지 확인.
- [ ] **Step 5: 커밋** — `git add` 지정 경로 → `git commit -m "추가: 당근 채팅 템플릿 채우기(계정 불일치 거부)·모달 중 뷰 접기"` → push.

---

### Task 9: 템플릿 편집 대화상자

**Files:**
- Create: `src/renderer/src/components/daangn/TemplateDialog.tsx`
- Modify: `src/main/daangn/register.ts`(템플릿 IPC 가 Task 6 에서 연결돼 있는지 확인), `daangnStore.ts`(`saveTemplate`·`deleteTemplate`·`reorderTemplates`), `ko.json`·`en.json`
- Test: `tests/daangn-repo.test.ts`(추가: IPC 쪽 검증 규칙은 저장소가 던지는 것으로 이미 덮임 — 여기선 순서 변경 후 `listTemplates` 가 일관됨만 재확인)

**Interfaces:**
- Consumes: `daangnTemplates*` 채널(Task 6).
- Produces: `TemplateDialog` — `export function TemplateDialog(props: { open: boolean; onClose: () => void }): React.JSX.Element`. 목록(끌어서 순서 변경 + ▲▼ 버튼), 항목 추가·수정·삭제, 입력은 500자 제한 표시, 빈 글은 저장 버튼 비활성. 열리면 `modalOpen` +1, 닫히면 −1(Task 8).

- [ ] **Step 1: 실패하는 시험** — `reorderTemplates` 후 `listTemplates` 순서 일치, 삭제한 id 를 다시 `reorderTemplates` 에 넣어도 던지지 않고 무시(UI 와 저장소가 어긋난 상태 대비).
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-repo.test.ts` → FAIL(새 케이스).
- [ ] **Step 3: 구현** — 저장소 `reorderTemplates` 가 모르는 id 를 건너뛰게 고치고, 대화상자를 만든다. 문구는 i18n. 폰 카드의 끌기·화살표 패턴(`PhonesPage.tsx`, `moveItem` from `@shared/reorder`)을 재사용.
- [ ] **Step 4: 통과 확인** — PASS, `npm run typecheck`·`lint`. 앱에서 추가·수정·삭제·순서 변경 후 앱을 껐다 켜도 남는지 확인.
- [ ] **Step 5: 커밋** — `git add` 지정 경로 → `git commit -m "추가: 당근 답변 템플릿 편집 대화상자"` → push.

---

### Task 10: 알림 클릭·로그인 풀림 처리·설정 항목

**Files:**
- Modify: `src/renderer/src/stores/daangnStore.ts`(`daangn:notifyClick` 받으면 `uiStore.setView('daangn')` + 그 방 열기), `src/renderer/src/components/daangn/AccountPanel.tsx`(풀린 계정 줄 → `relogin`), `src/main/daangn/service.ts`(`relogin(id)`: 그 계정 뷰를 로그인 화면으로 보냄), 설정 화면 폰 섹션 옆 또는 `src/renderer/src/components/settings/` 에 "당근 채팅" 섹션(알림 켜기, 상시 뷰 수, 기능 켜기) — 섹션 추가 방식은 `sections.ts` 의 기존 항목 규칙을 따른다
- Test: `tests/daangn-service.test.ts`(추가)

**Interfaces:**
- Consumes: Task 6 의 `daangn:notifyClick`, `daangnAccountRelogin`.
- Produces: `DaangnService.relogin(id: number): Promise<void>`.

- [ ] **Step 1: 실패하는 시험** — `relogin(2)` 가 2번 계정 뷰를 `login` 주소로 보내고(가짜 뷰의 `openLogin` 호출), 그 계정 상태를 `'loading'` 으로 바꿔 `updated` 전송; 로그인 완료(`state()` 가 `'logged_in'`)가 되면 다음 틱에서 채널이 합쳐짐; `daangnEnabled=false` 로 바꾸면 다음 틱에 모든 뷰 `stop`·타이머 해제(`settings()` 를 매 틱 읽음).
- [ ] **Step 2: 실패 확인** — `node node_modules/vitest/vitest.mjs run tests/daangn-service.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 동작. 알림 클릭 시 렌더러 이동은 스토어의 `onNotifyClick` 구독에서 처리(앱 전체에서 한 번만 구독하도록 `App.tsx` 에서 `subscribe()` 호출).
- [ ] **Step 4: 통과 확인** — PASS. 앱에서: 계정 하나 로그아웃(폰에서 "다른 기기 로그아웃")시켜 "다시 로그인" 표시·복구, 다른 창을 보는 동안 새 메시지가 오면 알림이 뜨고 클릭하면 그 방이 열리는지 확인.
- [ ] **Step 5: 커밋** — `git add` 지정 경로 → `git commit -m "추가: 당근 알림 클릭 이동·로그인 풀림 다시 로그인·설정 항목"` → push.

---

### Task 11: 부하 확인·마무리

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-daangn-inbox-design.md`(실측값을 "만드는 사람에게 남기는 것" 에 반영), 메모리 `daangn-inbox.md`(`C:\Users\canno\.claude\projects\C--Users-canno-workspace-samba-browser\memory\` + `MEMORY.md` 한 줄)

- [ ] **Step 1: 계정 수를 늘려 측정** — 실계정이 5개뿐이면 같은 계정의 세션을 파티션만 달리 복제할 수 없으므로, 5개 실계정 + 가짜 뷰 45개(`createView` 를 `about:blank` 뷰로 갈아끼운 개발용 스위치 `SAMBA_DAANGN_FAKE=45`, 커밋하지 않음)로 상시 8·임시 3 일 때 작업 관리자 기준 메모리·CPU 를 기록한다.
- [ ] **Step 2: 기본값 조정** — 측정이 결제 작업(하네스)에 영향을 주면(주문 처리 지연) 상시 뷰 기본값을 낮추고 시험의 기본값 단언을 고친다. 조정이 없으면 "조정 없음" 으로 기록.
- [ ] **Step 3: 전체 시험** — `node node_modules/vitest/vitest.mjs run` 전체 PASS, `npm run typecheck`·`npm run lint` 오류 0.
- [ ] **Step 4: 배포 확인** — `pwsh scripts/deploy-app.ps1`(재시작은 주문처리 세션과 조율해 큐가 비었을 때만 `-Restart`), 로그인 화면 아래 판 표시가 최신 커밋과 같은지 확인.
- [ ] **Step 5: 문서·메모리 커밋** — 설계 문서 갱신분 `git add docs/superpowers/specs/2026-10-21-daangn-inbox-design.md` → `git commit -m "문서: 당근 채팅함 실측값 반영"` → push. 메모리 파일 작성.
