# 주문처리 감시 인수인계 (2026-10-10 07:50 KST)

이 파일 하나로 다른 계정(**GPT·Codex**)의 새 세션이 감시를 이어받는다. 원래 Claude 세션이 하던 일이다. 응답은 항상 한국어, 간결하게(10줄 이내), 사용자는 "금고" 대신 **키마스터**라고 부른다.

## 0. 먼저 읽을 것
- 전역 지침: `C:\Users\canno\.claude\CLAUDE.md`(코딩·언어 규칙), `C:\Users\canno\.claude\rules\`
- 메모리(규칙·사고 기록 96개): `C:\Users\canno\.claude\projects\C--Users-canno-workspace-samba-browser\memory\MEMORY.md` — 색인의 파일을 필요할 때 읽는다. 특히 `watch-failed-jobs`, `cancel-needs-evidence`, `harness-restart-safe-point`, `double-purchase-requeue`, `wrong-purchase-cancel-immediately`, `no-automation-during-user-login`, `never-touch-shipping-status`, `cancel-request-procedure`.
- 이 PC 는 Windows 11, 셸은 Git Bash/PowerShell. 한국어로만 답한다(시간은 KST).

## 1. 10분마다 하는 일(이 프롬프트를 /loop 로 그대로 넣는다)
```
[주문처리 감시 — 10분마다] 하네스(samba-agent) 상태를 점검하고 사람이 시키기 전에 처리한다. 순서: (1) 삼바웨이브 DB 의 발주미입력(status=pending, sourcing_order_number 비어 있음, 최근 30일) 목록과 jobs.sqlite 의 queued/running/needs_human 을 대조한다. (2) running 작업이 30분 넘게 갱신 없으면 원인을 로그에서 찾는다(재시작은 결제 중이 아닐 때만). (3) needs_human 이 새로 생겼으면 events.sqlite 의 사유로 분류: 품절·마진은 이미 자동 처리되므로 확인만, 결제 전 일시 오류(검색 버튼·결제창 안 뜸·선물 화면)는 하네스가 두 번 재시도하므로 소진된 건만 cancel+enqueue 로 한 번 더 넣고, 결제됐을 수 있는 사유(pay_interrupted·verify-failed·결제됐는지)는 절대 재투입하지 말고 소싱처 주문내역을 읽기 전용으로 확인해 기입·보고한다. (4) 큐가 비었는데 발주미입력이 남아 있으면 이유를 찾는다(소싱처 비어 있음 등). (5) 변화가 있을 때만 한국어 3줄 이내로 사용자에게 보고하고, 변화 없으면 한 줄만 쓴다. 폰은 PHONE_HOLD 없이 PHONE_BUSY 자물쇠를 쓴다. 하네스 재시작은 큐 0·마지막 done 후 5분 경과일 때만.
```
점검 명령(작업 폴더 `C:\Users\canno\workspace\samba_browser\samba-agent`):
```bash
echo "도커 $(docker ps -q | wc -l)"   # 10개여야 정상
docker exec local-postgres-1 psql -U samba -d samba -At -F' | ' -c "select order_number,coalesce(source_site,'') from samba_order where status='pending' and coalesce(sourcing_order_number,'')='' and created_at>now()-interval '30 days'"
.venv/Scripts/python.exe -c "import sqlite3;c=sqlite3.connect('jobs.sqlite',timeout=5);print(c.execute(\"select state,count(*) from jobs where id>=1628 group by state\").fetchall());print(c.execute(\"select id,order_no,state,attempts,updated_at,substr(coalesce(error,''),1,70) from jobs where id>=1696 or state in ('running','queued') order by id desc limit 6\").fetchall())"
```
`PYTHONIOENCODING=utf-8` 를 붙인다. 새 needs_human 사유는 `events.sqlite`(`select substr(payload,1,600) from events where job_id=<id> and kind='agent' order by id desc limit 2`).

## 2. 자주 쓰는 조치
- **결제 전 오류 1회 재투입**(결제됐을 수 있는 사유는 금지): `UPDATE jobs SET state='queued', attempts=attempts+1, error=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%S+00:00','now') WHERE id=<id> AND state='needs_human' AND error='unknown' AND attempts<2` (`JobQueue(...)`를 열면 running 행이 queued 로 바뀌니 직접 SQL 을 쓴다).
- **품절 근거로 취소중 처리**: `FlagMarker(make_wave(Settings()), None, on_cancelled=make_cancel_export(s,w)).mark('<ord_… 행 id>', 'out_of_stock', '<근거 글자>')` — 근거 없으면 하지 않는다.
- **사이트 스크립트 수정**: `site-scripts/<이름>.js` 수정 → 앱에 저장(브릿지 `save_script`, 8000자 제한, 409/busy 면 0.7초 간격 재시도). 하네스가 브릿지를 계속 써서 호출 사이 빈틈에 끼워 넣는다. 수정 후 커밋.
- 브릿지: `127.0.0.1:47811`(1호기), 토큰은 `.env` 의 `SAMBA_BRIDGE_TOKEN`, 내 탭은 `X-Samba-Lane` 헤더로 레인을 분리한다.

## 3. 진행 중·대기 중(2026-10-10 07:50)
상태: done 37 · needs_human 31 · 큐 0, 도커 10. 마지막 job id 1695.
발주미입력 11건 — **모두 사용자 확인 또는 외부 조치 대기**, 임의 처리 금지:
| 주문 | 상황 |
|---|---|
| 29CM 21315211511003299 | 살로몬 티셔츠, 29CM 검색 막혀 품절 근거 없음 — 사용자 확인 |
| 29CM 21315211664023299 | 아디다스 푸퍼 베스트 블랙 XS, 옵션 목록이 비어 2회 실패, 사이즈표에 XS 없음(9월 리뷰엔 있음) — 사용자가 XS 재고 확인하면 있으면 옵션 읽기 수정, 없으면 취소중 |
| ABC마트 20261008064737 | 뉴발란스 M2002RCA 240, 6계정 모두 "주문서 옵션 못 읽음" 2회 실패 — 사용자가 240 품절 여부 확인 |
| 롯데온 20261009099555721-001 | 배송지 입력 검증 실패 2회(수리 에이전트가 로그인 만료로 못 고침) — 로그인 폴백 수정 후 재시작되면 한 번 더 시도 |
| 크림 A-SW242580789·A-AC212190929·A-SN242687879·A-SW229029359·A-AC219484270·A-LI227494712·A-AC230295875 | 크림 일본·해외 소싱 — 하네스 큐 대상 아님, 취소 버튼도 누르지 않는다(크림 취소요청은 목록 정리만) |
크림 취소요청 3건(A-LI228471328·A-LI228287933·A-LI228059847)은 입찰이 크림에 안 올라가 손실 체결된 사고 — 크림 세션이 원인을 확인했고 체결 건 처리 방침은 사용자 판단.

## 4. 이번에 고친 것(전부 커밋됨, 하네스 재시작 전에는 적용 안 된 코드가 있다)
- 예비 구독 토큰 폴백: `src/samba_agent/llm/auth.py` — 수리·AI 대행·폰 구매·폰 연결도 기본 로그인이 막히면 `SAMBA_CLAUDE_OAUTH_TOKENS`(2개, 시험상 정상) → API 키 순으로 넘어간다. **적용하려면 하네스 재시작 필요**(큐 0 + 마지막 done 5분 경과 + 폰 뒤처리 끝난 뒤).
- API 키 슬롯: `.env` 의 `SAMBA_ANTHROPIC_API_KEY`, `SAMBA_ANTHROPIC_WORKSPACE_ID` 저장됨. 시험 호출은 "Credit balance is too low" — Console 프로모션 $200 이 이 워크스페이스에 적용되지 않는다(적용 대상은 Console 결제 세부 정보에서 사용자 확인 필요). 키는 채팅에 노출된 적이 있어 사용자가 교체할 수 있다.
- SSG 선물 진입 옵션 매칭(`ssg_gift_enter.js`), 무신사 프리 사이즈 주문서 대조(`checkout_enter_musinsa.js`) — 앱에 저장 완료.
- SAMBA 브라우저 로그인 성공 판정(`login-success.ts`) — 인스타그램 로그인이 키마스터에 저장 제안까지 못 가던 문제 수정, **앱 재빌드·재시작 전**(1호기·2호기 모두 master `out/` 사용, 사용자 시점 확인 후).
- 환경: `scripts/docker-watch.ps1` 1분 점검(도커 꺼지면 되살림), 동기화 폴링 절약(Supabase 한도 초과 사고).

## 5. 지켜야 할 규칙(요약)
- 결제·구매는 사용자 지시 범위에서만, 시험은 결제 버튼 직전에 멈춘다. 잘못 산 주문(중고·다른 품번·사이즈)은 알자마자 내가 취소·환불한다.
- 결제비밀번호·API 키·토큰은 입력하지 않는다(키마스터 도구만). 사용자가 로그인 중인 사이트는 자동화하지 않는다. 캡차는 풀지 않는다. USB 디버깅 팝업은 취소만.
- `shipping_status` 는 쓰지 않는다. `node.exe` 일괄 종료 금지. 사용자 탭(lane user)은 건드리지 않는다.
- 취소는 근거(품절 표시·나의 할인가 확인)를 메모에 남기고 상태는 취소중. 일괄·추정 취소 금지. 취소 거부 버튼 금지.
- 하네스 재시작: 큐 0, 대기·승인 대기 0, 마지막 done 후 5분 경과일 때만.
- 삼바웨이브 변경·배포는 `deploy-local.ps1` 만, 크림 중국 세션과 조율(관리자 강제 머지 금지).
- 커밋 메시지·주석·문서는 한국어, 커밋 끝에 `Co-Authored-By` 줄은 세션 알림이 주는 값을 쓴다.

## 6. GPT(Codex)로 이어가는 법
`/loop` 가 없으니 10분마다 `codex exec` 로 돌린다. 프롬프트는 `monitor-prompt.txt` 에 있다.
```powershell
# 한 번 시험
powershell -ExecutionPolicy Bypass -File C:\Users\canno\workspace\samba_browser\samba-agent\run-order-monitor-codex.ps1
# 10분마다(작업 스케줄러에 등록)
schtasks /Create /SC MINUTE /MO 10 /TN SambaOrderMonitorCodex /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\canno\workspace\samba_browser\samba-agent\run-order-monitor-codex.ps1"
```
- 결과는 `logs\monitor-codex-YYYYMMDD.log` 에 쌓인다(변화 있을 때만 3줄, 없으면 한 줄). 마지막 메시지는 `logs\monitor-codex-last.txt`.
- 샌드박스: 스크립트는 `danger-full-access` 로 돈다(도커·sqlite·브릿지를 만져야 해서). 읽기만 하는 점검으로 줄이려면 `-s workspace-write` 로 바꾸되 docker/sqlite 가 막히는지 먼저 본다.
- Codex 앱을 쓰면 같은 프롬프트로 앱의 반복 작업(Automations)을 만들어도 된다.
- 알림 채널이 없다 — 변화는 로그 파일에 남으니 사용자가 폰에서 Codex 앱으로 본다.
