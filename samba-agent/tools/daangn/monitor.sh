#!/bin/bash
# 4폰 상태 한눈에: 게시/댓글 수, 현재 앱, 배터리, 잠금
export MSYS_NO_PATHCONV=1
A=/c/Users/canno/Downloads/pt/platform-tools/adb.exe
declare -A DEV=( [S23]=adb-R3CW60F49RY-uzSPwc._adb-tls-connect._tcp [G950N]=192.168.45.28:5555 [A426N]=192.168.45.95:5555 [XCover]=adb-R59RC04LJSE-VOmqqN._adb-tls-connect._tcp )
declare -A KEY=( [S23]=s23 [G950N]=g950 [A426N]=a426 [XCover]=xcover )
declare -A CMT=( [S23]=comment_done_s23.txt [G950N]=comment_done_g950.txt [A426N]=comment_done_a426.txt [XCover]=comment_done_xcover.txt )
for p in S23 G950N A426N XCover; do
  d=${DEV[$p]}
  if $A -s $d get-state >/dev/null 2>&1; then
    app=$(DAANGN_DEV=$d python -X utf8 -c "from post import focused; print(focused())" 2>/dev/null | tail -1 | sed 's/.*\///' | cut -c1-40)
    bat=$($A -s $d shell dumpsys battery 2>/dev/null | grep -E "^  level" | grep -oE "[0-9]+")
  else app="(연결 끊김)"; bat="-"; fi
  posts=$(grep -c . places/done_${KEY[$p]}.txt 2>/dev/null || echo 0); cmts=$(grep -c . ${CMT[$p]} 2>/dev/null || echo 0)
  err=$(grep -E "Error|assert" places/log_${KEY[$p]}.txt 2>/dev/null | tail -1 | cut -c1-60)
  printf "%-7s 글 %2s/10  댓글 %2s/10  배터리 %3s%%  화면 %s\n" "$p" "$posts" "$cmts" "$bat" "$app"
  [ -n "$err" ] && printf "        마지막 오류: %s\n" "$err"
done
echo "잠금: $(python /c/Users/canno/workspace/phone-locks/phone_lock.py status 2>/dev/null | tr '\n' ' ')"
echo "실행 중: $(powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ? { \$_.CommandLine -match 'community.py|comment.py' } | % { (\$_.CommandLine -split ' ')[-3] }" 2>/dev/null | tr '\n' ' ')"
