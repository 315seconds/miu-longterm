#!/bin/bash
# 30초 폴링 크론 wrapper — flock으로 중복 실행 방지
LOCK=/tmp/kiosk_update.lock
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/home/ubuntu/miu-longterm/logs/kiosk_update.log

exec 9>"$LOCK"
flock -n 9 || exit 0   # 이미 실행 중이면 조용히 종료

set -a
# work_automation .env (Supabase + Chromium + 키움 자격증명 공유)
source /home/ubuntu/work_automation/.env
set +a

mkdir -p "$(dirname "$LOG")"
python3 "$SCRIPT_DIR/update_kiosk.py" >> "$LOG" 2>&1
