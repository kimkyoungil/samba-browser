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
