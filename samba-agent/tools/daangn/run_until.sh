#!/bin/bash
# 사용: run_until.sh <posts.json> <done.txt> <log> [목표수=10] [최대시도=8] — 실패해도 목표 수까지 반복
export MSYS_NO_PATHCONV=1
P=$1; D=$2; L=$3; N=${4:-10}; MAX=${5:-8}
for i in $(seq 1 $MAX); do
  c=$(grep -c . "$D" 2>/dev/null || echo 0)
  [ "$c" -ge "$N" ] && break
  python -X utf8 community.py "$P" "$D" $((N - c)) >> "$L" 2>&1
  sleep 5
done
echo "최종 $(grep -c . "$D" 2>/dev/null) 개"; grep -E "게시 OK|Error|assert" "$L" | tail -4
