import json

from samba_agent.agents.payer import single_order_tab


def _tabs(*urls: str) -> str:
    return json.dumps([{'id': f't{i}', 'kind': 'tab', 'url': u} for i, u in enumerate(urls)])


def test_single_checkout_tab_found() -> None:
    out = _tabs('https://www.29cm.co.kr/products/1', 'https://order.29cm.co.kr/order/checkout?x=1')
    assert single_order_tab(out) == 't1'


def test_multiple_or_none_returns_none() -> None:
    assert single_order_tab(_tabs('https://a.com/order/checkout', 'https://b.com/order/order-form')) is None
    assert single_order_tab(_tabs('https://a.com/')) is None
    assert single_order_tab('not json') is None


def test_글자_사이즈가_다르게_담긴_주문서는_막는다():
    """주문 M 인데 S 로 담긴 주문서가 숫자 사이즈 대조만으로 통과해 결제됐다(실기 2026-10-18 무신사 지오다노 2건)."""
    from samba_agent.agents.payer import order_form_mismatch

    opt = '01아이보리+미드헤더그레이 / M'
    name = '지오다노 캠핑티셔츠 라운드넥티셔츠'
    page = '지오다노 캠핑티셔츠 라운드넥티셔츠 01아이보리+미드헤더그레이 S 1개'
    assert order_form_mismatch(page, name, opt, '01아이보리+미드헤더그레이 S')
    assert order_form_mismatch(page, name, opt, '')  # 담긴 옵션을 못 넘겨도 화면의 S 로 막는다
    ok = page.replace(' S ', ' M ')
    assert order_form_mismatch(ok, name, opt, '01아이보리+미드헤더그레이 M') is None
    assert order_form_mismatch(ok, name, opt, '') is None
