#!/bin/bash
# 30초 폴링 크론 wrapper — flock으로 중복 실행 방지
LOCK=/tmp/kiosk_update.lock
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/var/log/kiosk_update.log

exec 9>"$LOCK"
flock -n 9 || exit 0   # 이미 실행 중이면 조용히 종료

set -a
# shellcheck source=/dev/null
source "$SCRIPT_DIR/.env"
set +a

python3 "$SCRIPT_DIR/update_kiosk.py" >> "$LOG" 2>&1
