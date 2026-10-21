// 당근채팅 숨은 뷰가 갈 수 있는 주소를 판정한다. 접미사 속임수(chat.daangn.com.evil.com)를 막으려고
// 문자열 포함이 아니라 호스트를 파싱해 정확히 비교한다

const CHAT_HOST = 'chat.daangn.com'
const LOGIN_HOSTS = new Set(['accounts.daangn.com'])
const ALLOWED_HOSTS = new Set([CHAT_HOST, 'accounts.daangn.com', 'business-gateway.daangn.com'])
// 인증 서버(지역 접두사 kr 등)
const AUTH_HOST = /^karrotauth-http\.[a-z0-9-]+\.karrotmarket\.com$/

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** 채팅 화면인가, 로그인(QR·온보딩) 화면인가, 그 밖인가 */
export function classifyChatUrl(url: string): 'chat' | 'login' | 'other' {
  const u = parse(url)
  if (!u || u.protocol !== 'https:') return 'other'
  if (LOGIN_HOSTS.has(u.hostname)) return 'login'
  if (u.hostname !== CHAT_HOST) return 'other'
  return u.pathname.startsWith('/login') || u.pathname.startsWith('/onboarding') ? 'login' : 'chat'
}

/** 숨은 뷰가 이동해도 되는 주소(https 의 당근 채팅·로그인·인증 호스트만) */
export function isAllowedChatUrl(url: string): boolean {
  const u = parse(url)
  if (!u || u.protocol !== 'https:') return false
  return ALLOWED_HOSTS.has(u.hostname) || AUTH_HOST.test(u.hostname)
}

/** `/room/<id>` 주소에서 방 id 를 뽑는다. 방 주소가 아니면 null */
export function roomIdOf(url: string): string | null {
  const u = parse(url)
  if (!u || u.hostname !== CHAT_HOST) return null
  const m = /^\/room\/([^/?#]+)/.exec(u.pathname)
  return m ? m[1] : null
}
