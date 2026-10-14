# 실패 화면 근거 — 파일 경로 규칙·사유 꼬리표·비밀 화면 제외·글자 스냅샷·run_agent 연결
from datetime import datetime

from samba_agent.agents.base import AgentFailure, AgentResult, run_agent
from samba_agent.agents.contracts import FailReason
from samba_agent.ops import evidence


def test_shot_path_uses_date_dir_and_safe_name():
    p = evidence.shot_path('3477 2907/abc', 'buyer', datetime(2026, 10, 14, 21, 5, 7))
    assert p.parent.name == '20261014'
    assert p.name == '3477_2907_abc-buyer-210507.png'


def test_tag_and_secret_stage():
    assert evidence.tag(None) == ''
    assert evidence.tag(['a.png', 'b.png']) == ' [화면: a.png; b.png]'
    assert evidence.is_secret_stage('결제 비밀번호 키패드가 뜨지 않았다')
    assert not evidence.is_secret_stage('옵션 불일치')


def test_host_of():
    assert evidence.host_of('https://www.musinsa.com/products/1') == 'musinsa.com'
    assert evidence.host_of('https://pay.ssg.com/x') == 'ssg.com'
    assert evidence.host_of('') == ''


def test_render_text_png_is_png():
    data = evidence.render_text_png('742668795428943 옵션 품절', '[품절] M 45,000\nL 45,000\n' * 3)
    assert data.startswith(b'\x89PNG')


def test_save_text_shot_skips_secret(tmp_path, monkeypatch):
    monkeypatch.setattr(evidence, 'EVIDENCE_DIR', tmp_path)
    assert evidence.save_text_shot('o1', 'payer', '결제 비밀번호 입력', 'x') is None
    saved = evidence.save_text_shot('o1', 'buyer', '옵션 없음', '[품절] M')
    assert saved is not None and saved.endswith('.png')


def test_run_agent_appends_shot_tag():
    def fn():
        raise AgentFailure('needs_ai', '옵션 없음', FailReason.UNKNOWN)

    r = run_agent(fn, None, lambda reason: ['C:/e/x.png'])
    assert isinstance(r, AgentResult)
    assert r.reason == '옵션 없음 [화면: C:/e/x.png]'


def test_run_agent_shot_failure_is_swallowed():
    def fn():
        raise AgentFailure('fail', '막힘', FailReason.UNKNOWN)

    def bad(reason):
        raise RuntimeError('no cdp')

    assert run_agent(fn, None, bad).reason == '막힘'
