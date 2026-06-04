#!/bin/bash
# Oracle VM 초기 세팅 — 한 번만 실행
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== [1/4] Chrome 설치 확인 ==="
if ! command -v google-chrome &>/dev/null && ! command -v chromium-browser &>/dev/null; then
    wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    sudo apt install -y ./google-chrome-stable_current_amd64.deb
    rm -f google-chrome-stable_current_amd64.deb
    echo "Chrome 설치 완료"
else
    echo "Chrome 이미 설치됨 — 건너뜀"
fi

echo "=== [2/4] Python 패키지 설치 ==="
pip3 install -r "$SCRIPT_DIR/requirements.txt"

echo "=== [3/4] .env 파일 ==="
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo ".env 생성됨 — SUPABASE_KEY(service_role)와 KIOSK_PASS 직접 입력 필요"
else
    echo ".env 이미 존재 — 건너뜀"
fi

echo "=== [4/4] 로그 파일 + 권한 ==="
sudo touch /var/log/kiosk_update.log
sudo chmod 666 /var/log/kiosk_update.log
chmod +x "$SCRIPT_DIR/run_kiosk_update.sh"

echo ""
echo "=== 크론탭 등록 (아래 2줄 추가) ==="
echo "  crontab -e  로 편집기 열고:"
echo ""
echo "  * * * * * /bin/bash $SCRIPT_DIR/run_kiosk_update.sh"
echo "  * * * * * sleep 30 && /bin/bash $SCRIPT_DIR/run_kiosk_update.sh"
echo ""
echo "=== 세팅 완료 ==="
