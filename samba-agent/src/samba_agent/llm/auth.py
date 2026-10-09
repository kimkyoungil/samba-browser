"""Claude 호출의 계정 넘김 — 기본 로그인이 막히면 등록된 예비 구독 토큰으로 이어서 부른다.

결정 호출(decide.py)만 예비 토큰을 썼고, 수리 에이전트·AI 대행·폰 구매·폰 연결은 기본 로그인만 써서 로그인이 풀리면
전부 "Not logged in" 으로 멈췄다(실기 2026-10-09 롯데온 배송지·SSG 선물 — 예비 토큰 2개는 멀쩡했다).
이 모듈은 query() 와 같은 모양의 호출 객체를 감싸 같은 규칙을 모든 호출에 적용한다.
"""

import dataclasses
import os
import re
from collections.abc import AsyncIterator, Callable
from typing import Any

# 구독 만료·차단·로그인 풀림 — 다른 계정으로 넘어가야 하는 오류(decide.py 와 같은 기준)
AUTH_ERROR_RE = re.compile(
    r'subscription access|disabled|not logged in|login|unauthori[sz]ed|'
    r'authentication|oauth|token.*(expired|invalid)|credit balance|usage limit|401|403',
    re.IGNORECASE,
)
TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'
API_KEY_ENV = 'ANTHROPIC_API_KEY'
HEADERS_ENV = 'ANTHROPIC_CUSTOM_HEADERS'

# 마지막으로 통한 계정 번호(0 = 기본 로그인, 1.. = 예비 토큰). 막힌 계정을 매번 다시 두드리지 않는다
_preferred = 0

QueryFn = Callable[..., AsyncIterator[Any]]


def fallback_tokens() -> list[str]:
    """기본 로그인이 막혔을 때 차례로 쓸 다른 계정의 OAuth 토큰."""
    raw = os.environ.get('SAMBA_CLAUDE_OAUTH_TOKENS', '')
    return [t.strip() for t in raw.split(',') if t.strip()]


def fallback_api_key() -> str:
    """구독 계정이 모두 막혔을 때 마지막으로 쓸 Anthropic API 키(Console 크레딧으로 결제). 없으면 빈 문자열."""
    return os.environ.get('SAMBA_ANTHROPIC_API_KEY', '').strip()


def api_key_env(api_key: str) -> dict[str, str]:
    """API 키 슬롯의 환경변수. 워크스페이스에 묶이지 않은 키(sk-ant-usr-)는 요청마다 워크스페이스 ID 헤더가 필요하다."""
    env = {API_KEY_ENV: api_key}
    workspace = os.environ.get('SAMBA_ANTHROPIC_WORKSPACE_ID', '').strip()
    if workspace:
        env[HEADERS_ENV] = f'anthropic-workspace-id: {workspace}'
    return env


def is_auth_error(error: BaseException) -> bool:
    return AUTH_ERROR_RE.search(f'{type(error).__name__} {error}') is not None


def with_fallback(query_fn: QueryFn) -> QueryFn:
    """query_fn 을 감싼다. 응답이 한 줄도 오기 전에 인증 오류가 나면 다음 계정으로 같은 요청을 다시 보낸다."""

    async def run(*, prompt: Any, options: Any) -> AsyncIterator[Any]:
        global _preferred
        tokens = fallback_tokens()
        api_key = fallback_api_key()
        # 슬롯: 0 = 기본 로그인, 1..n = 예비 구독 토큰, 마지막 = API 키(있을 때만)
        count = 1 + len(tokens) + (1 if api_key else 0)
        start = _preferred if _preferred < count else 0
        order = [(start + i) % count for i in range(count)]
        last: BaseException | None = None
        for slot in order:
            env = dict(getattr(options, 'env', None) or {})
            env.pop(TOKEN_ENV, None)
            env.pop(API_KEY_ENV, None)
            env.pop(HEADERS_ENV, None)
            if 0 < slot <= len(tokens):
                env[TOKEN_ENV] = tokens[slot - 1]
            elif slot > len(tokens):
                env.update(api_key_env(api_key))
            tried = dataclasses.replace(options, env=env)
            started = False
            try:
                async for message in query_fn(prompt=prompt, options=tried):
                    started = True
                    yield message
                _preferred = slot
                return
            except Exception as e:
                # 이미 응답이 오기 시작했으면(도구가 실행됐을 수 있다) 같은 요청을 다시 보내지 않는다
                if started or not is_auth_error(e):
                    raise
                last = e
        assert last is not None
        raise last

    return run
