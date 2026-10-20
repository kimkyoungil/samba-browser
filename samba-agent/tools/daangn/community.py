# 당근 동네생활 글쓰기(장소 첨부) / 댓글 — 활동배지(동네 주민·탐험가·한바퀴·답변가)용
import io, json, os, sys, time
from post import dump, find, tap, sh, focused, sx, sy, ADB, DEV, H
import subprocess
from kbd import Kbd

def dismiss_overlay(nodes):
  """후후 스팸 안내 등 다른 앱 오버레이가 덮으면 닫기(X) 또는 뒤로"""
  if any('후후' in n['t'] for n in nodes):
    x = [n for n in nodes if n['click'] and n['cy'] < sy(200) and n['cx'] > sx(850)]
    if x: tap(x[0]['cx'], x[0]['cy'], 1.5)
    else: sh('input', 'keyevent', '4'); time.sleep(1.5)
    return True
  return False

def to_community():
  """당근 메인 → 커뮤니티 탭(동네생활 목록)"""
  for _ in range(10):
    f = focused()
    nodes = dump()
    if dismiss_overlay(nodes): continue
    tab = [n for n in nodes if (n['t'] == '커뮤니티' or n['d'] == '커뮤니티') and n['cy'] > sy(2000)]   # 옛 UI 는 desc 만 있음
    if 'MainActivity' in f and tab:
      tap(tab[0]['cx'], tab[0]['cy'], 2.5); return True
    if 'towneers' not in f:
      sh('monkey', '-p', 'com.towneers.www', '-c', 'android.intent.category.LAUNCHER', '1'); time.sleep(4)
      continue
    b = find(nodes, text='저장하지 않고 나가기', exact=True)
    if b: tap(b['cx'], b['cy'], 1.5); continue
    c = find(nodes, desc='닫기') or find(nodes, text='닫기', exact=True)
    if c and find(nodes, rid='title'): tap(c['cx'], c['cy'], 1.5); continue
    sh('input', 'keyevent', '4'); time.sleep(1.5)
  return False

def paste(text):
  k = Kbd(); k.paste(text); time.sleep(0.4); k.close()

def write_post(title, body, place=None, tag='생활/편의'):
  assert to_community(), '커뮤니티 진입 실패'
  nodes = dump(); dn = [n for n in nodes if n['t'] == '동네생활' and n['cy'] < sy(400)]
  if dn: tap(dn[0]['cx'], dn[0]['cy'], 2)
  else: tap(sx(140), sy(275), 2)   # 상단 '동네생활' 서브탭(웹뷰)
  def open_form():
    for attempt in range(3):
      nodes = dump()
      if find(nodes, desc='발행 위치 선택') or find(nodes, rid='title'):   # 이미 폼이 열려 있음(이전 시도에서 늦게 뜬 경우)
        print('폼 이미 열림'); return nodes
      fab = [n for n in nodes if n['t'] == '글쓰기' and n['cy'] > sy(1500)]
      if fab: tap(fab[0]['cx'], fab[0]['cy'], 2.5)
      else: tap(sx(900), sy(1935), 2.5)                      # 웹뷰 FAB '+ 글쓰기'
      for _ in range(4):
        if 'BottomSheet' in focused(): break
        time.sleep(1)
      if 'BottomSheet' not in focused():
        nodes = dump()
        if find(nodes, desc='발행 위치 선택') or find(nodes, rid='title'): print('폼 바로 열림'); return nodes   # 시트 없이 바로 폼으로 가는 판
        print('시트 안 뜸', attempt); continue
      time.sleep(6.0)                                        # 구형 폰은 Lynx 시트가 늦게 활성화됨
      from PIL import Image
      import io as _io
      png = subprocess.run([ADB, '-s', DEV, 'exec-out', 'screencap', '-p'], capture_output=True, creationflags=0x08000000).stdout
      im = Image.open(_io.BytesIO(png)).convert('L'); w, h = im.size
      x = w // 2; top = None
      for y in range(int(h * 0.3), int(h * 0.9)):
        if im.getpixel((x, y)) > 245 and all(im.getpixel((x, y + k)) > 245 for k in range(5, 60, 5)):
          top = y; break
      if not top: print('시트 윗변 못 찾음'); continue
      ty = round((top + h * 0.16) * H / h); print('시트 top', top, '탭', ty)
      tap(sx(540), ty, 3)         # 시트 첫 항목 '글쓰기'
      if 'BottomSheet' in focused(): tap(sx(540), ty, 3)   # 한 번 더
      backed = False
      for _ in range(10):
        nodes = dump()
        if dismiss_overlay(nodes): continue
        if find(nodes, desc='발행 위치 선택'): return nodes
        if find(nodes, rid='title'):
          if not backed: sh('input', 'keyevent', '4'); backed = True; time.sleep(1.5); continue   # 키보드만 한 번 내림
          return nodes                                          # 제목칸 보이면 폼으로 인정(발행 버튼은 뒤에서 재시도)
        time.sleep(1.5)
      time.sleep(4); nodes = dump()
      if find(nodes, desc='발행 위치 선택') or find(nodes, rid='title'): print('폼 늦게 뜸'); return nodes
      print('폼 안 뜸, 화면:', focused())
      assert to_community(), '커뮤니티 복귀 실패'
      nodes = dump(); dn = [n for n in nodes if n['t'] == '동네생활' and n['cy'] < sy(400)]
      if dn: tap(dn[0]['cx'], dn[0]['cy'], 2)
    return None
  nodes = open_form()
  assert nodes, '글쓰기 폼 아님'
  sel = None
  for _ in range(6):
    nodes = dump(); sel = find(nodes, desc='발행 위치 선택')
    if sel: break
    if not find(nodes, rid='title'): break
    sh('input', 'keyevent', '4') if not find(nodes, text='완료', exact=True) else None   # 키보드 떠 있으면 내림
    time.sleep(1.5)
  if sel is None:
    sel = {'cx': sx(540), 'cy': sy(318)}                        # 폼 상단 '커뮤니티를 선택해주세요' 고정 위치
  # 커뮤니티 선택
  def wait_node(pred, tries=6, what=''):
    for _ in range(tries):
      nodes = dump(); hit = pred(nodes)
      if hit: return hit
      time.sleep(1.2)
    raise AssertionError('안 보임: ' + what)
  for attempt in range(3):
    tap(sel['cx'], sel['cy'], 1.5)
    try:
      dl = wait_node(lambda ns: next((n for n in ns if n['t'].startswith('동네생활') and n['cls'] == 'Button'), None), 4, '동네생활 항목')
      tap(dl['cx'], dl['cy'], 1.5)
      def vis_tag(ns):
        t = [n for n in ns if n['t'] == tag and n['cls'] in ('RadioButton', 'TextView') and 0 < n['cx'] < W - sx(40)]   # 구형 폰은 칩이 TextView
        return t[0] if t else None
      from post import W
      tg = None
      for _ in range(4):
        nodes = dump(); tg = vis_tag(nodes)
        if tg: break
        row = [n for n in nodes if n['cls'] in ('RadioButton', 'TextView') and n['t'] in ('맛집', '동네행사', '반려동물', '운동')]
        if row:                                           # 칩 줄을 왼쪽으로 밀어 숨은 태그 노출
          y = row[0]['cy']; sh('input', 'swipe', str(sx(900)), str(y), str(sx(200)), str(y), '300'); time.sleep(1)
        else:
          time.sleep(1)
      assert tg, f'태그 {tag} 없음'
      tap(tg['cx'], tg['cy'], 1.5)
    except AssertionError as e:
      print('선택 재시도:', e); continue
    ok = wait_node(lambda ns: find(ns, desc='현재 동네생활') or find(ns, text='동네생활 · ' + tag), 4, '선택 확인') if False else None
    nodes = dump(); cur = find(nodes, desc='발행 위치 선택') or find(nodes, text='발행 위치 선택')
    chk = [n for n in nodes if n['t'] == tag and (n['chk'] or n['sel'])]
    if (cur and '현재' in (cur['d'] + cur['t'])) or chk or find(nodes, text='동네생활 · ' + tag): break
    print('선택 안 됨, 재시도', attempt)
  else:
    raise AssertionError('커뮤니티·태그 선택 실패')
  # 제목·본문
  def clear(): sh('input', 'keycombination', '113', '29'); sh('input', 'keyevent', '67'); time.sleep(0.3)   # 남은 글자 비우기
  def fill(rid, text):
    for _ in range(4):                                       # 칸에 포커스가 실제로 갈 때까지(구형 폰은 느림)
      ed = lambda ns: next((n for n in ns if n['id'] == rid and n['cls'] == 'EditText'), None)   # android:id/content(FrameLayout) 와 구분
      nodes = dump(); f = ed(nodes); tap(f['cx'], f['cy'], 1.0)
      nodes = dump(); f = ed(nodes)
      if f and f['foc']: break
    assert f and f['foc'], rid + ' 포커스 실패'
    if f['t']: clear()                                     # 빈 칸에 백스페이스 치면 포커스가 제목으로 튐(XCover)
    paste(text); time.sleep(0.8)
    nodes = dump(); f = ed(nodes); print('입력', rid, (f['t'] or '')[:25])
    sh('input', 'keyevent', '4'); time.sleep(1.2)
  fill('title', title); fill('content', body)
  nodes = dump()
  assert find(nodes, rid='title')['t'] == title, '제목 확인 실패'
  # 장소 첨부
  if place:
    pb = wait_node(lambda ns: find(ns, desc='장소 첨부') or find(ns, text='장소 첨부', exact=True), 5, '장소 첨부 버튼'); tap(pb['cx'], pb['cy'], 2.5)
    nodes = dump(); e = next(n for n in nodes if n['cls'] == 'EditText'); tap(e['cx'], e['cy'], 0.7)
    paste(place); time.sleep(2.5); sh('input', 'keyevent', '4'); time.sleep(1.2)
    tap(sx(540), sy(458), 2.5)                 # 검색 결과 첫 행(웹뷰라 덤프 안 잡힘, 검색어를 지도 명칭과 맞춰 둠)
    nodes = dump()
    assert find(nodes, text='지도보기') is None, '행 선택 안 됨'
    tap(sx(540), sy(2106), 2.5)                # 지도 화면 아래 '선택'
    nodes = dump()
    assert find(nodes, rid='title'), '폼 복귀 실패'
    chosen = find(nodes, desc='선택된 장소') or find(nodes, text='선택된 장소')
    label = (chosen['d'] or chosen['t']) if chosen else ''
    assert chosen and place.replace(' ', '')[:4] in label.replace(' ', ''), '장소 불일치: ' + (label or '없음')
    print('장소 첨부:', label)
  done = find(nodes, text='완료', exact=True); tap(done['cx'], done['cy'], 4)
  nodes = dump()
  ok = find(nodes, text=title) is not None and find(nodes, rid='title') is None
  print('게시', 'OK' if ok else '확인 필요', '|', title)
  return ok

if __name__ == '__main__':
  posts = json.load(open(sys.argv[1], encoding='utf-8'))
  done_f = sys.argv[2] if len(sys.argv) > 2 else 'community_done.txt'
  done = set(open(done_f, encoding='utf-8').read().split('\n')) if os.path.exists(done_f) else set()
  limit = int(sys.argv[3]) if len(sys.argv) > 3 else 3
  n = 0
  for p in posts:
    if p['title'] in done or n >= limit: continue
    if write_post(p['title'], p['body'], p.get('place'), p.get('tag', '생활/편의')):
      open(done_f, 'a', encoding='utf-8').write(p['title'] + '\n'); n += 1
      time.sleep(20)
    else:
      break
  print('오늘 게시', n)
