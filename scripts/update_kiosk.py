#!/usr/bin/env python3
"""
키오스크 가격 업데이트 스크립트
Supabase kiosk_updates 테이블 폴링 → 엑셀 생성 → Selenium 자동 업로드
"""
import os, sys, time, tempfile
from datetime import datetime, timezone
import requests
from openpyxl import Workbook
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

SUPABASE_URL    = os.environ['SUPABASE_URL']
SUPABASE_KEY    = os.environ['SUPABASE_KEY']   # service role key 사용
KIOSK_COMPANY   = os.environ['KIOSK_COMPANY']  # 회사코드: 12157
KIOSK_USER      = os.environ['KIOSK_USER']
KIOSK_PASS      = os.environ['KIOSK_PASS']
BASE_URL        = 'https://asp.kiwoompaypos.co.kr'

HDR = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}


def log(msg):
    print(f'[{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] {msg}', flush=True)


def fetch_pending():
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/kiosk_updates',
        params={'processed_at': 'is.null', 'select': 'id,barcode,new_price'},
        headers=HDR,
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def mark_processed(ids):
    now = datetime.now(timezone.utc).isoformat()
    id_list = ','.join(map(str, ids))
    r = requests.patch(
        f'{SUPABASE_URL}/rest/v1/kiosk_updates',
        params={'id': f'in.({id_list})'},
        headers={**HDR, 'Prefer': 'return=minimal'},
        json={'processed_at': now},
        timeout=10,
    )
    r.raise_for_status()


def make_excel(rows):
    wb = Workbook()
    ws = wb.active
    ws.append(['바코드', '판매단가'])
    for row in rows:
        ws.append([str(row['barcode']), int(row['new_price'])])
    f = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    wb.save(f.name)
    f.close()
    return f.name


def run_kiosk(excel_path):
    opts = Options()
    opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--window-size=1400,900')

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)
    W = WebDriverWait(driver, 20)

    try:
        # ── 1. 로그인 (3개 필드: 회사코드 / 아이디 / 비밀번호) ──────────────
        driver.get(BASE_URL)
        # 화면에 보이는 input 순서대로 인덱스로 접근
        inputs = W.until(lambda d: [
            el for el in d.find_elements(By.CSS_SELECTOR, 'input')
            if el.get_attribute('type') in ('text', 'password', '')
            and el.is_displayed()
        ])
        inputs[0].send_keys(KIOSK_COMPANY)   # 회사코드
        inputs[1].send_keys(KIOSK_USER)      # 아이디
        inputs[2].send_keys(KIOSK_PASS)      # 비밀번호
        driver.find_element(By.XPATH, '//button[contains(text(),"로그인")]').click()
        log('로그인 완료')

        # ── 2. 상품 관리 메뉴 클릭 ────────────────────────────────────────────
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//*[self::a or self::li or self::span][contains(text(),"상품 관리") or contains(text(),"상품관리")]')
        )).click()
        time.sleep(0.5)

        # ── 3. 상품 등록 (본사) 클릭 ──────────────────────────────────────────
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//a[contains(text(),"상품 등록") and contains(text(),"본사")]')
        )).click()
        log('상품 등록(본사) 진입')

        # ── 4. 엑셀 업로드 버튼 클릭 ─────────────────────────────────────────
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//button[contains(text(),"엑셀 업로드")]')
        )).click()
        log('엑셀 업로드 팝업 열기')

        # ── 5. 동일 상품 덮어쓰기 선택 ────────────────────────────────────────
        sel_el = W.until(EC.presence_of_element_located((By.TAG_NAME, 'select')))
        Select(sel_el).select_by_visible_text('동일 상품 덮어쓰기')

        # ── 6. 파일 업로드 ────────────────────────────────────────────────────
        file_input = W.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, 'input[type="file"]')
        ))
        file_input.send_keys(os.path.abspath(excel_path))
        time.sleep(2)  # 업로드 후 그리드 갱신 대기
        log('파일 업로드 완료')

        # ── 7. 저장 클릭 ──────────────────────────────────────────────────────
        driver.find_element(
            By.XPATH, '//button[contains(text(),"저장")]'
        ).click()
        time.sleep(3)  # 저장 처리 대기
        log('저장 완료')

        # ── 8. 닫기 클릭 ──────────────────────────────────────────────────────
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//button[contains(text(),"닫기")]')
        )).click()
        time.sleep(1)

        # ── 9. 자료수신 클릭 ──────────────────────────────────────────────────
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//button[contains(text(),"자료수신")]')
        )).click()

        # ── 10. 브라우저 confirm → OK ─────────────────────────────────────────
        W.until(EC.alert_is_present())
        driver.switch_to.alert.accept()
        time.sleep(2)
        log('자료수신 완료')

    finally:
        driver.quit()


def main():
    rows = fetch_pending()
    if not rows:
        sys.exit(0)  # 처리할 항목 없음 — 로그 안 남김

    log(f'가격 수정 {len(rows)}건 처리 시작')
    excel_path = make_excel(rows)

    try:
        run_kiosk(excel_path)
        ids = [r['id'] for r in rows]
        mark_processed(ids)
        log(f'완료: {len(ids)}건 처리됨')
    except Exception as e:
        log(f'오류: {e}')
        sys.exit(1)
    finally:
        try:
            os.unlink(excel_path)
        except Exception:
            pass


if __name__ == '__main__':
    main()
