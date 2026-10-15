// 앱 빌드 전 점검 — origin/master 보다 뒤처진 소스로는 빌드하지 못하게 막는다.
//
// 2026-10-15: 메인 체크아웃이 origin/master 보다 38커밋 뒤처진 채 다른 세션이 거기서 빌드·재시작해
// '아이디 저장'·구글 로그아웃·롯데온 결제 키패드 수정이 빠진 옛 앱이 세 번 떴다. 그 일을 막는 문지기다.
//
// 막는 경우: 현재 커밋이 origin/master 의 조상이 아니거나(=뒤처짐) origin 에 없는 커밋이 있다.
// 그냥 통과: 앞서 있음(푸시 전 커밋), 커밋 안 된 소스 변경(경고만 — 판 표시 끝에 + 가 붙는다).
// 우회: 환경변수 SAMBA_ALLOW_STALE_BUILD=1 (옛 판을 일부러 만들 때만)
import { execSync } from 'node:child_process'

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

if (process.env.SAMBA_ALLOW_STALE_BUILD === '1') {
  console.warn('[빌드 점검] SAMBA_ALLOW_STALE_BUILD=1 — 점검을 건너뛴다')
  process.exit(0)
}

try {
  try {
    run('git fetch -q origin')
  } catch {
    console.warn('[빌드 점검] git fetch 실패 — 마지막으로 받아 둔 origin/master 기준으로 본다')
  }
  const [ahead, behind] = run('git rev-list --left-right --count HEAD...origin/master')
    .split(/\s+/)
    .map(Number)
  const head = run('git log -1 --format=%h')
  if (behind > 0) {
    console.error(
      `\n[빌드 점검] 막음: 이 소스(${head})는 origin/master 보다 ${behind}커밋 뒤처졌다.\n` +
        '이 상태로 빌드하면 최근 수정(로그인 아이디 저장·로그아웃·결제 키패드 등)이 빠진 옛 앱이 된다.\n' +
        '해결: 이 폴더를 origin/master 로 맞춘 뒤 빌드하거나, 앱 배포 스크립트(scripts/deploy-app.ps1)를 쓴다.\n' +
        '(옛 판을 일부러 만들 때만 SAMBA_ALLOW_STALE_BUILD=1)\n'
    )
    process.exit(1)
  }
  if (ahead > 0) console.warn(`[빌드 점검] 주의: 푸시 안 된 커밋 ${ahead}개가 포함된다(${head})`)
  const dirty = run('git status --porcelain -- src')
  if (dirty) console.warn('[빌드 점검] 주의: 커밋 안 된 소스 변경이 포함된다 — 판 표시 끝에 + 가 붙는다')
} catch (e) {
  // git 이 없거나 저장소가 아니면(압축본 등) 막지 않는다
  console.warn(`[빌드 점검] 점검을 못 했다(${e instanceof Error ? e.message : e}) — 계속한다`)
}
