# 내 동네생활 글 삭제 — 나의 당근 > 내 커뮤니티 글 > 글 > ⋮ > 삭제
import sys, time
from community import to_community, dismiss_overlay
from post import dump, find, tap, sh, sx, sy, focused, W

def to_my_posts():
  assert to_community(), '커뮤니티 진입 실패'
  for _ in range(5):
    nodes = dump(); my = [n for n in nodes if (n['d'] == '나의 당근' or n['t'] == '나의 당근') and n['cy'] > sy(2000)]
    if my: break
    time.sleep(1.5)
  assert my, '나의 당근 탭 없음'
  tap(my[0]['cx'], my[0]['cy'], 2.5)
  for _ in range(3): sh('input', 'swipe', str(sx(540)), str(sy(800)), str(sx(540)), str(sy(1800)), '200')   # 맨 위로
  time.sleep(1.5)
  for _ in range(4):
    nodes = dump(); m = find(nodes, text='내 커뮤니티 글')
    if m: tap(m['cx'], m['cy'], 3); return True
    sh('input', 'swipe', str(sx(540)), str(sy(1500)), str(sx(540)), str(sy(800)), '300'); time.sleep(1)
  return False

def my_post_titles(max_scroll=12):
  """'내 커뮤니티 글' 목록의 제목 전부(게시 전 중복 확인용)"""
  assert to_my_posts(), '내 커뮤니티 글 진입 실패'
  titles, stall = [], 0
  for _ in range(max_scroll):
    nodes = dump()
    tv = [n for n in nodes if n['cls'] == 'TextView' and n['t'].strip()]
    new = 0
    for i, n in enumerate(tv):            # 카드 구조: '동네생활' 라벨 다음 줄이 제목
      if n['t'] == '동네생활' and i + 1 < len(tv):
        t = tv[i + 1]['t'].strip()
        if t and t not in titles: titles.append(t); new += 1
    if find(nodes, text='작성한 글이 없어요') or find(nodes, text='아직 작성한 글이 없어요'): break
    stall = 0 if new else stall + 1
    if stall >= 2: break
    sh('input', 'swipe', str(sx(540)), str(sy(1900)), str(sx(540)), str(sy(600)), '400'); time.sleep(1.5)
  sh('input', 'keyevent', '4'); time.sleep(1.0)
  return titles

def open_my_post(title):
  assert to_my_posts(), '내 커뮤니티 글 진입 실패'
  for _ in range(10):
    nodes = dump(); t = find(nodes, text=title)
    if t and sy(300) < t['cy'] < sy(2100): tap(t['cx'], t['cy'], 3); return True
    sh('input', 'swipe', str(sx(540)), str(sy(1800)), str(sx(540)), str(sy(700)), '400'); time.sleep(1.5)
  return False

def delete_post(title):
  assert open_my_post(title), '글 못 찾음: ' + title
  nodes = dump(); assert find(nodes, text=title), '상세 아님'
  btns = sorted([n for n in nodes if n['cls'] == 'Button' and n['cy'] < sy(200) and n['cx'] > sx(600)], key=lambda n: n['cx'])
  from post import H
  for attempt in range(3):
    nodes = dump()
    btns = sorted([n for n in nodes if n['cls'] == 'Button' and n['cy'] < sy(200) and n['cx'] > sx(600)], key=lambda n: n['cx'])
    tap(btns[-1]['cx'], btns[-1]['cy'], 3.5)                    # ⋮ (시트가 늦게 올라오니 넉넉히 기다림)
    tap(W // 2, round(H * 0.828), 2.5)                          # 시트(웹뷰) 둘째 줄 '삭제' — 수정/삭제/닫기 고정 위치
    nodes = dump()
    if find(nodes, text='게시글을 삭제할까요?'): break
    if find(nodes, rid='title'):                                # '수정' 이 눌려 수정 폼이 열림 → 되돌아가 다시
      print('수정 폼 열림, 되돌림'); sh('input', 'keyevent', '4'); time.sleep(1.5); sh('input', 'keyevent', '4'); time.sleep(2)
      assert open_my_post(title), '글 다시 못 찾음'
    else:
      sh('input', 'keyevent', '4'); time.sleep(1.5)
  else:
    raise AssertionError('삭제 확인창 안 뜸')
  ok = next(n for n in nodes if n['cls'] == 'Button' and n['t'].strip() == '삭제'); tap(ok['cx'], ok['cy'], 3)
  nodes = dump()
  gone = find(nodes, text=title) is None or not any(n['cls'] == 'Button' and n['cy'] < sy(200) and n['cx'] > sx(600) for n in nodes)
  print('삭제', 'OK' if gone else '확인 필요', '|', title)
  return gone

if __name__ == '__main__':
  for t in sys.argv[1:]:
    delete_post(t)
