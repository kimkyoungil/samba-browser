"""실패·취소 판정의 화면 근거 — 그 순간의 브라우저·폰 화면을 PNG 로 남긴다.

사용자 2026-10-14: "실패한 근거를 이미지로 남기고, 실패한 이유를 이미지랑 함께 보고해. 가격·재고 없음도 마찬가지."
글자 덤프(uiautomator·page.get)만 보고 '버튼 없음'·'링크 만료'로 오판한 사고(SSG 선물 E746D6) 뒤 추가.
저장 실패는 원래 흐름을 막지 않는다(경고 로그만). 결제 비밀번호·키패드 화면은 찍지 않는다.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import subprocess
import urllib.request
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_DIR = ROOT / 'evidence'
CDP_URL = 'http://127.0.0.1:9502'
# 이 말이 든 사유·단계는 찍지 않는다 — 비밀번호 키패드 배치를 남기지 않는다
SECRET_WORDS = ('비밀번호', '키패드', 'password', 'secret', 'keypad')


def is_secret_stage(text: str) -> bool:
    low = (text or '').lower()
    return any(w.lower() in low for w in SECRET_WORDS)


def _safe(s: str) -> str:
    return re.sub(r'[^0-9A-Za-z가-힣._-]+', '_', (s or '').strip())[:60] or 'unknown'


def shot_path(order_no: str, stage: str, now: datetime | None = None) -> Path:
    """evidence/<YYYYMMDD>/<주문번호>-<단계>-<HHMMSS>.png — 파일명에 못 쓰는 글자는 _ 로."""
    at = now or datetime.now()
    name = f'{_safe(order_no)}-{_safe(stage)}-{at.strftime("%H%M%S")}.png'
    return EVIDENCE_DIR / at.strftime('%Y%m%d') / name


def tag(paths: list[str] | str | None) -> str:
    """사유 문자열 끝에 붙일 ' [화면: …]'. 없으면 빈 문자열."""
    if not paths:
        return ''
    items = [paths] if isinstance(paths, str) else list(paths)
    return f' [화면: {"; ".join(items)}]'


def _write(path: Path, data: bytes) -> str | None:
    if not data or not data.startswith(b'\x89PNG'):
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


def save_phone_shot(
    adb: str, serial: str, order_no: str, stage: str, server_args: tuple[str, ...] = ()
) -> str | None:
    """폰 화면을 PNG 로 저장(adb exec-out screencap -p). 실패하면 None."""
    if is_secret_stage(stage):
        return None
    try:
        done = subprocess.run(
            [adb, *server_args, '-s', serial, 'exec-out', 'screencap', '-p'],
            capture_output=True,
            timeout=20,
            check=False,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        return _write(shot_path(order_no, stage), done.stdout)
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning('폰 화면 저장 실패: %s', e)
        return None


async def _capture(ws_url: str) -> bytes:
    import websockets

    async with websockets.connect(ws_url, max_size=50_000_000) as ws:
        await ws.send(
            json.dumps({'id': 1, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}})
        )
        # 숨은 탭(보이지 않는 자동화 탭)은 Electron 이 그리지 않아 응답이 영영 안 온다 — 짧게 기다리고
        # 호출부가 글자 스냅샷으로 넘어간다(실기 2026-10-14 롯데온 탭 시간 초과)
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), 12))
            if msg.get('id') == 1:
                return base64.b64decode(msg.get('result', {}).get('data', ''))


def save_browser_shots(
    order_no: str, stage: str, host_filter: str = '', cdp: str = CDP_URL, limit: int = 2
) -> list[str]:
    """삼바 브라우저(CDP)에서 host_filter 가 든 페이지 탭을 찍는다(최대 limit 장). 실패하면 빈 목록."""
    if is_secret_stage(stage):
        return []
    try:
        with urllib.request.urlopen(f'{cdp}/json/list', timeout=5) as r:
            targets = json.loads(r.read().decode('utf-8'))
    except Exception as e:  # noqa: BLE001 — 브라우저가 없거나 포트가 닫혀도 흐름을 막지 않는다
        log.warning('브라우저 화면 목록 실패: %s', e)
        return []
    pages = [
        t
        for t in targets
        if t.get('type') == 'page'
        and 'webSocketDebuggerUrl' in t
        and (not host_filter or host_filter in str(t.get('url', '')))
        and not str(t.get('url', '')).startswith('file:')
    ]
    out: list[str] = []
    for i, t in enumerate(pages[:limit]):
        try:
            data = asyncio.run(_capture(t['webSocketDebuggerUrl']))
            label = f'{stage}-{i + 1}' if len(pages) > 1 else stage
            saved = _write(shot_path(order_no, label), data)
            if saved:
                out.append(saved)
        except Exception as e:  # noqa: BLE001
            log.warning(
                '브라우저 화면 저장 실패(%s): %s %s', str(t.get('url', ''))[:60], type(e).__name__, e
            )
    return out


FONT_CANDIDATES = (r'C:\Windows\Fonts\malgun.ttf', r'C:\Windows\Fonts\gulim.ttc')


def render_text_png(title: str, text: str, width: int = 1100) -> bytes:
    """글자 스냅샷을 PNG 로 그린다 — 숨은 탭은 화면 그림을 못 얻으므로(Electron 이 그리지 않음) 글자라도 그림으로 남긴다.
    맨 위에 제목을 두고 아래에 본문을 줄바꿈해 넣는다. 한글 글꼴은 맑은 고딕을 쓴다."""
    from PIL import Image, ImageDraw, ImageFont

    font = None
    for cand in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(cand, 16)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()
    lines: list[str] = []
    for raw in (text or '').splitlines() or ['(비어 있음)']:
        raw = raw.rstrip()
        while len(raw) > 70:
            lines.append(raw[:70])
            raw = raw[70:]
        lines.append(raw)
    lines = lines[:120]
    height = 60 + 22 * (len(lines) + 1)
    img = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(img)
    draw.text((16, 12), f'[글자 스냅샷 — 숨은 탭이라 화면 그림 없음] {title}', fill='red', font=font)
    y = 48
    for line in lines:
        draw.text((16, y), line, fill='black', font=font)
        y += 22
    import io

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def save_text_shot(order_no: str, stage: str, title: str, text: str) -> str | None:
    """글자 스냅샷 PNG 를 저장한다. 비밀 단계면 저장하지 않는다."""
    if is_secret_stage(stage) or is_secret_stage(title):
        return None
    try:
        return _write(shot_path(order_no, f'{stage}-text'), render_text_png(title, text))
    except Exception as e:  # noqa: BLE001
        log.warning('글자 스냅샷 저장 실패: %s %s', type(e).__name__, e)
        return None


def host_of(url: str) -> str:
    """등록 도메인만 남긴다(www.musinsa.com → musinsa.com) — pay.·member. 같은 하위 도메인 탭도 잡힌다."""
    m = re.match(r'https?://([^/]+)', url or '')
    if not m:
        return ''
    host = m.group(1).lower()
    parts = host.split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else host
