# JY 상품을 당근에 임시저장(초안)으로 올린다 — 등록 전 판매관리에 같은 제목이 있으면 건너뜀(중복 등록 = 계정 정지 위험, 사용자 10/21)
import json, sys, time
from post import post, go_sales, dump, sh, sx, sy
def already_listed(title):
  assert go_sales(), '판매관리 아님'
  for _ in range(20): sh('input', 'swipe', '360', '400', '360', '1200', '150')
  time.sleep(1); key = title[:12]
  for _ in range(6):
    nodes = dump()
    if any(n['t'].startswith(key) for n in nodes): return True
    sh('input', 'swipe', str(sx(540)), str(sy(1700)), str(sx(540)), str(sy(900)), '400'); time.sleep(1)
  for _ in range(20): sh('input', 'swipe', '360', '400', '360', '1200', '150')
  return False
items = json.load(open(sys.argv[1], encoding='utf-8'))
for it in items:
  it.setdefault('draft', True); it.setdefault('direct_buy', False)
  if already_listed(it['title']): print('이미 등록됨, 건너뜀:', it['title']); continue
  post(it)
