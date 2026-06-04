#!/usr/bin/env python3
"""
키오스크 가격 업데이트 스크립트
Supabase kiosk_updates 테이블 폴링 → 엑셀 생성 → Selenium 자동 업로드
"""
import os, sys, time
from datetime import datetime, timezone
import requests
from openpyxl import Workbook
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.keys import Keys
from webdriver_manager.chrome import ChromeDriverManager

SUPABASE_URL    = os.environ['SUPABASE_URL']
SUPABASE_KEY    = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ['SUPABASE_ANON_KEY']
KIOSK_COMPANY   = os.environ.get('KIWOOM_COMPANY', os.environ.get('KIOSK_COMPANY', '12157'))
KIOSK_USER      = os.environ.get('KIWOOM_USERID',  os.environ.get('KIOSK_USER', ''))
KIOSK_PASS      = os.environ.get('KIWOOM_USERPASS', os.environ.get('KIOSK_PASS', ''))
CHROMEDRIVER    = os.environ.get('CHROMEDRIVER_PATH')  # snap chromedriver 경로
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
    # /tmp 대신 스크립트 옆 디렉토리 사용 (headless Chrome 파일 접근 제한 우회)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kiosk_upload.xlsx')
    wb.save(path)
    return path


def run_kiosk(excel_path):
    opts = Options()
    opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--window-size=1400,900')

    if CHROMEDRIVER:
        service = Service(CHROMEDRIVER)
    else:
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
        inputs[2].send_keys(Keys.RETURN)     # Enter로 로그인 (버튼 구조 불문)
        time.sleep(8)                        # 로그인 후 메뉴 JS 렌더링 대기
        log('로그인 완료')

        # ── 1-b. 로그인 후 팝업 닫기 (비밀번호 변경 안내, 공지사항 등) ─────────
        popup_close_ids = ['btnChangeNextTimePw', 'btnCloseChangeInfo', 'btnNoticeClose', 'btnSlidingExpiration']
        for pid in popup_close_ids:
            try:
                btn = driver.find_element(By.ID, pid)
                if btn.is_displayed():
                    btn.click()
                    time.sleep(0.5)
            except Exception:
                pass
        # 혹시 남은 .close 버튼도 닫기
        for close_btn in driver.find_elements(By.CSS_SELECTOR, 'button.close'):
            try:
                if close_btn.is_displayed():
                    close_btn.click()
                    time.sleep(0.3)
            except Exception:
                pass
        time.sleep(1)

        # ── 2+3. 상품 등록(본사) 직접 클릭 (즐겨찾기 or 메뉴, 한/영 대응) ────
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//*['
                'contains(text(),"Product registration(Common)") or '
                'contains(text(),"상품 등록(본사)") or '
                '(contains(text(),"상품 등록") and contains(text(),"본사"))'
            ']')
        )).click()
        time.sleep(3)
        log('상품 등록(본사) 진입')

        # ── 4. 콘텐츠 iframe으로 전환 후 엑셀 업로드 버튼 클릭 ─────────────────
        iframe = W.until(EC.presence_of_element_located(
            (By.XPATH, '//iframe[contains(@src,"CompanyGoodsReg")]')
        ))
        driver.switch_to.frame(iframe)
        W.until(EC.element_to_be_clickable(
            (By.XPATH, '//button[contains(text(),"엑셀 업로드") or contains(text(),"Excel Upload") or contains(text(),"Excel upload")]')
        )).click()
        log('엑셀 업로드 팝업 열기')

        # ── 5. cmbUploadType → Cover the same goods (덮어쓰기) ─────────────────
        sel_el = W.until(EC.presence_of_element_located((By.ID, 'cmbUploadType')))
        sel = Select(sel_el)
        sel.select_by_visible_text('Cover the same goods')
        log(f'덮어쓰기 옵션 선택: {sel.first_selected_option.text}')

        # ── 6. 파일 업로드 ────────────────────────────────────────────────────
        file_input = W.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, 'input[type="file"]')
        ))
        file_input.send_keys(os.path.abspath(excel_path))
        time.sleep(2)  # 업로드 후 그리드 갱신 대기
        log('파일 업로드 완료')

        # ── 7. 팝업 저장 클릭 (btnSaveExcel) — JS click ──────────────────────
        save_btn = W.until(EC.presence_of_element_located((By.ID, 'btnSaveExcel')))
        driver.execute_script('arguments[0].click();', save_btn)
        # 저장 후 "저장되었습니다" alert 처리
        W.until(EC.alert_is_present())
        driver.switch_to.alert.accept()
        time.sleep(1)
        log('저장 완료')

        # ── 8. 팝업 닫기 (modal-footer 내 text="Close" 버튼만 정확히 클릭) ──────
        close_btn = driver.find_element(
            By.XPATH,
            '//div[contains(@class,"modal-footer")]//button[normalize-space()="Close"]'
        )
        driver.execute_script('arguments[0].click();', close_btn)
        time.sleep(1)

        # ── 9. 전체 선택 후 자료수신 클릭 ────────────────────────────────────
        # 그리드 행을 전체 선택해야 자료수신이 활성화됨
        select_all = W.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, '.dt-button.buttons-select-all')
        ))
        driver.execute_script('arguments[0].click();', select_all)
        time.sleep(1)

        req_btn = W.until(EC.element_to_be_clickable((By.ID, 'btnReqDownload')))
        driver.execute_script('arguments[0].click();', req_btn)

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
