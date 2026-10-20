"""결제 전 주문서 상품 대조 — 마켓 상품명 모델 코드에 숫자 접두가 붙어도 같은 상품으로 본다."""

from samba_agent.agents.payer import order_form_mismatch

PAGE = (
    '주문서 임성희 배송지 상품 1개 휠라 키즈 FILA GGUMI LIGHT TEENIEPING LEGEND(FK261CD01X042100) '
    'WHITE/BLUE/PURPLE · 160 / 1개 89,900원'
)


def test_모델_코드_숫자_접두와_오타_상품명은_같은_상품이다() -> None:
    name = '매장정품 키즈 1200FK261CD01X042100 다이아나핑 꾸미 라이트'
    assert order_form_mismatch(PAGE, name, '160') is None


def test_다른_상품_모델_코드는_막는다() -> None:
    name = '매장정품 키즈 1200FK261CD01X099999 다이아나핑 꾸미 라이트'
    assert order_form_mismatch(PAGE, name, '160') is not None
