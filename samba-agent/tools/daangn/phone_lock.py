# 폰 공유 잠금 — 여러 Claude 세션(당근·크림 중국 등)이 같은 폰을 번갈아 쓰기 위한 파일 잠금
# 사용: python phone_lock.py acquire <serial> <owner> [minutes]  → 빈 때까지 기다렸다 잠금(기본 30분 뒤 자동 만료)
#       python phone_lock.py release <serial> <owner>
#       python phone_lock.py status
# 또는 import: with PhoneLock('R59RC04LJSE', 'daangn', 30): ...
import json, os, sys, time
DIR = os.path.dirname(os.path.abspath(__file__))

def _path(serial): return os.path.join(DIR, serial.replace(':', '_') + '.lock')

def _read(serial):
  p = _path(serial)
  try: return json.load(open(p, encoding='utf-8'))
  except Exception: return None

def holder(serial):
  """잠근 세션 이름, 없거나 만료면 None"""
  d = _read(serial)
  if d and d.get('until', 0) > time.time(): return d.get('owner')
  return None

def acquire(serial, owner, minutes=30, wait=1800, note=''):
  """빈 때까지 최대 wait 초 기다린 뒤 잠금. 같은 owner 면 연장."""
  t0 = time.time()
  while True:
    h = holder(serial)
    if h is None or h == owner:
      json.dump({'owner': owner, 'since': time.time(), 'until': time.time() + minutes * 60, 'note': note}, open(_path(serial), 'w', encoding='utf-8'))
      return True
    if time.time() - t0 > wait: return False
    time.sleep(10)

def release(serial, owner):
  d = _read(serial)
  if d and d.get('owner') == owner:
    try: os.remove(_path(serial))
    except FileNotFoundError: pass

class PhoneLock:
  def __init__(self, serial, owner, minutes=30, wait=1800, note=''):
    self.serial, self.owner, self.minutes, self.wait, self.note = serial, owner, minutes, wait, note
  def __enter__(self):
    if not acquire(self.serial, self.owner, self.minutes, self.wait, self.note):
      raise RuntimeError(f'{self.serial} 잠금 못 얻음(점유: {holder(self.serial)})')
    return self
  def __exit__(self, *a): release(self.serial, self.owner)

if __name__ == '__main__':
  cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
  if cmd == 'acquire':
    ok = acquire(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 30)
    print('locked' if ok else 'busy:' + str(holder(sys.argv[2]))); sys.exit(0 if ok else 1)
  elif cmd == 'release':
    release(sys.argv[2], sys.argv[3]); print('released')
  else:
    for f in os.listdir(DIR):
      if f.endswith('.lock'):
        d = json.load(open(os.path.join(DIR, f), encoding='utf-8')); left = int(d['until'] - time.time())
        print(f, d['owner'], '남은', left, '초', d.get('note', ''))
