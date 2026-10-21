# 당근 동네생활 글에 댓글 달기 — 활동배지(동네 답변가·동네 산책 등)용
# 사용: python comment.py scan [N]            → 동네생활 피드에서 동네 글 N개(제목·요약) 출력(JSON)
#       python comment.py post comments.json done.txt [limit]  → {제목: 댓글} 대로 글 찾아 댓글 작성
import json, os, re, sys, time
from post import dump, find, tap, sh, focused, sx, sy, H, W
from community import to_community, paste, dismiss_overlay

def to_feed(tab='인기'):
  assert to_community(), '커뮤니티 진입 실패'
  nodes = dump(); dn = [n for n in nodes if n['t'] == '동네생활' and n['cy'] < sy(400)]
  if dn: tap(dn[0]['cx'], dn[0]['cy'], 2)
  else: tap(sx(140), sy(275), 2)
  nodes = dump(); b = next((n for n in nodes if n['t'] == tab and n['cls'] == 'Button'), None)
  if b: tap(b['cx'], b['cy'], 2.5)
  for _ in range(6): sh('input', 'swipe', str(sx(540)), str(sy(800)), str(sx(540)), str(sy(1900)), '150')   # 맨 위로
  time.sleep(1.5)

POST = re.compile(r'^(?P<title>.+?)(?: (?P<n>\d+))? (?P<village>\S{1,5}(?:동|면|읍|리)) ⸱ (?P<when>[^⸱]+?) ⸱ 조회 (?P<views>[\d,]+)')
def cards(nodes):
  """피드의 동네 글 버튼(인기 탭: '제목 [댓글수] 동네 ⸱ 시간 ⸱ 조회 N') — 화면 안에 보이는 것만"""
  out = []
  for n in nodes:
    if n['cls'] != 'Button' or not n['click']: continue
    m = POST.match(n['t'])
    if not m or not (sy(500) < n['cy'] < sy(1880)): continue
    out.append({'title': m['title'], 'snippet': '', 'village': m['village'], 'when': m['when'], 'views': m['views'], 'comments': m['n'] or '0', 'node': n})
  return out

def scan(limit=15):
  to_feed()
  seen, out = set(), []
  for _ in range(12):
    nodes = dump()
    if dismiss_overlay(nodes): continue
    for c in cards(nodes):
      if c['title'] in seen: continue
      seen.add(c['title']); out.append({k: c[k] for k in ('title', 'village', 'when', 'views', 'comments')})
    if len(out) >= limit: break
    sh('input', 'swipe', str(sx(540)), str(sy(1800)), str(sx(540)), str(sy(700)), '400'); time.sleep(1.5)
  return out[:limit]

def visible(nodes):
  """웹뷰가 화면 밖 노드를 한 줄(cy 같음)로 뭉쳐 보고하므로, 같은 cy 가 3개 이상이면 화면 밖으로 본다"""
  from collections import Counter
  cnt = Counter(n['cy'] for n in nodes if n['cls'] == 'Button')
  return [n for n in nodes if cnt[n['cy']] < 3]

def open_post(title):
  to_feed()
  for _ in range(20):
    nodes = dump()
    if dismiss_overlay(nodes): continue
    vis = visible(nodes)
    for c in cards(vis):
      if c['title'] == title:
        tap(c['node']['cx'], c['node']['cy'], 3)
        nodes = dump()
        if find(nodes, text=title[:15]) and not next((n for n in nodes if n['t'] == '인기' and n['cls'] == 'Button'), None): return True
        print('상세 안 열림, 계속'); sh('input', 'keyevent', '4'); time.sleep(1.5)
    more = [n for n in vis if n['t'] == '더보기' and n['cls'] == 'Button' and sy(500) < n['cy'] < sy(1880)]
    if more: tap(more[0]['cx'], more[0]['cy'], 2); continue            # 접힌 '용강동 인기글' 펼침
    sh('input', 'swipe', str(sx(540)), str(sy(1700)), str(sx(540)), str(sy(900)), '400'); time.sleep(1.5)
  return False

def write_comment(title, text):
  assert open_post(title), '글 못 찾음: ' + title
  nodes = None
  for _ in range(6):
    nodes = dump()
    if dismiss_overlay(nodes): continue
    box = next((n for n in nodes if n['id'] == 'comment' and n['cls'] == 'EditText'), None)
    if box: break
    tap(sx(640), H - sy(215), 2.0)        # 웹뷰 글은 아래 '댓글을 입력해주세요' 줄을 눌러야 입력 칸이 생김
    nodes = dump(); box = next((n for n in nodes if n['id'] == 'comment' and n['cls'] == 'EditText'), None)
    if box: break
    time.sleep(1.5)
  assert box, '댓글 칸 없음'
  tap(box['cx'], box['cy'], 1.0)
  nodes = dump(); box = next((n for n in nodes if n['id'] == 'comment' and n['cls'] == 'EditText'), None)
  assert box and box['foc'], '댓글 칸 포커스 실패'
  if box['t']: sh('input', 'keycombination', '113', '29'); sh('input', 'keyevent', '67'); time.sleep(0.3)   # 남은 글자 비움(빈 칸이면 생략)
  for _ in range(3):                                           # 붙여넣기가 가끔 안 먹음(A426N) → 칸 다시 눌러 재시도
    paste(text); time.sleep(1.0)
    nodes = dump(); box = next((n for n in nodes if n['id'] == 'comment' and n['cls'] == 'EditText'), None)
    if box and text[:10] in box['t']: break
    if box: tap(box['cx'], box['cy'], 1.0)
  assert box and text[:10] in box['t'], '댓글 입력 확인 실패: ' + (box['t'][:20] if box else '칸 없음')
  cands = [n for n in nodes if n['click'] and n['cls'] == 'Button' and n['cx'] > box['b'][2] and abs(n['cy'] - box['cy']) < sy(150)]
  send = max(cands, key=lambda n: n['cx']) if cands else None   # 맨 오른쪽 = 전송(안쪽 이모지 버튼 제외, desc 없음)
  assert send, '등록 버튼 없음'
  tap(send['cx'], send['cy'], 3)
  nodes = dump()
  ok = find(nodes, text=text[:15]) is not None and not next((n for n in nodes if n['id'] == 'comment' and n['cls'] == 'EditText' and n['t']), None)
  print('댓글', 'OK' if ok else '확인 필요', '|', title[:20], '|', text[:20])
  sh('input', 'keyevent', '4'); time.sleep(1.5)
  if 'MainActivity' not in focused(): sh('input', 'keyevent', '4'); time.sleep(1.5)
  return ok

if __name__ == '__main__':
  cmd = sys.argv[1]
  if cmd == 'scan':
    print(json.dumps(scan(int(sys.argv[2]) if len(sys.argv) > 2 else 15), ensure_ascii=False, indent=1))
  else:
    cm = json.load(open(sys.argv[2], encoding='utf-8'))
    done_f = sys.argv[3]; done = set(open(done_f, encoding='utf-8').read().split('\n')) if os.path.exists(done_f) else set()
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else 5; n = 0
    ours = set(json.load(open('our_titles.json', encoding='utf-8'))) if os.path.exists('our_titles.json') else set()
    for title, text in cm.items():
      if title in ours: print('우리 글이라 건너뜀:', title[:20]); continue      # 본인(우리 계정) 작성 글엔 댓글 금지
      if title in done or n >= limit: continue
      if write_comment(title, text):
        open(done_f, 'a', encoding='utf-8').write(title + '\n'); n += 1; time.sleep(15)
      else: break
    print('댓글', n, '개')
