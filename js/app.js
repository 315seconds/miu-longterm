// ── helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(str) {
  if (!str) return '-';
  const d = new Date(str);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function daysDiff(str) {
  if (!str) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(str).getTime()) / 86400000));
}

function buildDisplayName(brand, category, productName, barcode) {
  brand = (brand||'').trim(); category = (category||'').trim(); productName = (productName||'').trim();
  if (brand && category) return `${brand} ${category}`;
  if (category) return category;
  if (productName) return productName;
  return barcode || '';
}

function appAlert(msg) {
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'modal-overlay open';
    o.innerHTML = `<div class="modal-box"><div class="modal-msg">${escapeHtml(msg)}</div>
      <button class="btn btn-primary btn-block" id="_ok">확인</button></div>`;
    document.body.appendChild(o);
    const close = () => { o.remove(); resolve(); };
    o.querySelector('#_ok').onclick = close;
    o.onclick = e => { if (e.target === o) close(); };
  });
}

function appConfirm(msg) {
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'modal-overlay open';
    o.innerHTML = `<div class="modal-box"><div class="modal-msg">${escapeHtml(msg)}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-outline flex-1" id="_cancel">취소</button>
        <button class="btn btn-primary flex-1" id="_ok">확인</button>
      </div></div>`;
    document.body.appendChild(o);
    const close = r => { o.remove(); resolve(r); };
    o.querySelector('#_ok').onclick = () => close(true);
    o.querySelector('#_cancel').onclick = () => close(false);
    o.onclick = e => { if (e.target === o) close(false); };
  });
}

// ── 바코드 정규화 (스캐너 한글 자모 역변환) ─────────────────────────────────

function normalizeBarcode(input) {
  const JAMO = {'ㄱ':'r','ㄲ':'R','ㄴ':'s','ㄷ':'e','ㄸ':'E','ㄹ':'f','ㅁ':'a','ㅂ':'q','ㅃ':'Q','ㅅ':'t','ㅆ':'T','ㅇ':'','ㅈ':'w','ㅉ':'W','ㅊ':'c','ㅋ':'z','ㅌ':'x','ㅍ':'v','ㅎ':'g','ㅏ':'k','ㅐ':'o','ㅑ':'i','ㅒ':'O','ㅓ':'j','ㅔ':'p','ㅕ':'u','ㅖ':'P','ㅗ':'h','ㅘ':'hk','ㅙ':'ho','ㅚ':'hl','ㅛ':'y','ㅜ':'n','ㅝ':'nj','ㅞ':'np','ㅟ':'nl','ㅠ':'b','ㅡ':'m','ㅢ':'ml','ㅣ':'l','ㄳ':'rt','ㄵ':'sw','ㄶ':'sg','ㄺ':'fr','ㄻ':'fa','ㄼ':'fq','ㄽ':'ft','ㄾ':'fx','ㄿ':'fv','ㅀ':'fg','ㅄ':'qt'};
  const INI = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const VOW = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const FIN = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  let r = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const off = code - 0xAC00;
      r += JAMO[INI[Math.floor(off/(21*28))]]??'';
      r += JAMO[VOW[Math.floor((off%(21*28))/28)]]??'';
      const fi = off%28; if (fi>0) r += JAMO[FIN[fi]]??'';
    } else if (code >= 0x3130 && code <= 0x318F) {
      r += JAMO[ch]??ch;
    } else { r += ch; }
  }
  return r.toUpperCase().trim();
}

// ── 앱 상태 ──────────────────────────────────────────────────────────────────

const S = {
  store: '',
  threshold: 60,
  items: new Map(),    // barcode → itemData
  selected: new Set(),
  priceMode: 'individual',
  priceOriginal: [],
  lastChanges: [],
};

// ── 화면 전환 ─────────────────────────────────────────────────────────────────

const STEPS = ['setup','scan','process','price','move'];
function showStep(id) {
  STEPS.forEach(s => { document.getElementById(`step-${s}`).style.display = s===id ? 'block':'none'; });
}

// ── STEP 1: 설정 ─────────────────────────────────────────────────────────────

async function initSetup() {
  const sel = document.getElementById('store-select');
  sel.innerHTML = '<option value="">로딩 중...</option>';

  const { data: locs, error } = await sb.from('locations').select('name').eq('is_active', true).order('name');
  if (error || !locs?.length) {
    sel.innerHTML = '<option value="">매장 정보 로드 실패</option>'; return;
  }
  sel.innerHTML = '<option value="">매장을 선택하세요</option>' +
    locs.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join('');

  document.getElementById('start-btn').onclick = () => {
    const store = sel.value;
    const threshold = parseInt(document.getElementById('threshold-input').value) || 60;
    if (!store) { appAlert('매장을 선택해주세요.'); return; }
    S.store = store; S.threshold = threshold; S.items = new Map(); S.selected = new Set();
    showStep('scan');
    initScanStep();
  };
}

// ── STEP 2: 스캔 ─────────────────────────────────────────────────────────────

function initScanStep() {
  document.getElementById('scan-store-label').textContent = `${S.store} · 기준 ${S.threshold}일`;
  renderScanList();

  // 기존 리스너 제거 후 새로 연결
  const old = document.getElementById('scan-input');
  const inp = old.cloneNode(true);
  old.parentNode.replaceChild(inp, old);
  inp.value = '';

  let timer = null;
  function tryAdd(val) {
    const bc = normalizeBarcode(val);
    if (!bc) return;
    inp.value = '';
    if (!S.items.has(bc)) addItemToScan(bc);
  }
  inp.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); clearTimeout(timer); tryAdd(inp.value); }});
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => tryAdd(inp.value), 500); });
  inp.addEventListener('compositionend', () => { clearTimeout(timer); timer = setTimeout(() => tryAdd(inp.value), 500); });

  document.getElementById('scan-back-btn').onclick = () => showStep('setup');
  document.getElementById('process-btn').onclick = () => {
    const valid = [...S.items.values()].filter(i => !i.loading && !i.notFound && !i.error);
    if (!valid.length) { appAlert('스캔된 바코드가 없습니다.'); return; }
    showStep('process');
    initProcessStep();
  };

  setTimeout(() => inp.focus(), 100);
}

async function addItemToScan(barcode) {
  S.items.set(barcode, { barcode, loading: true });
  renderScanList();

  try {
    const [{ data: item, error }, { data: moves }] = await Promise.all([
      sb.from('inventory_items')
        .select('price,brand,category,product_name,location,created_at,status')
        .eq('barcode', barcode).maybeSingle(),
      sb.from('session_items')
        .select('move_sessions!inner(session_date,to_location)')
        .eq('barcode', barcode),
    ]);

    if (error || !item) {
      S.items.set(barcode, { barcode, notFound: true }); renderScanList(); return;
    }

    const currentLoc = item.location || S.store;
    let arrivalStr = item.created_at;
    if (moves?.length) {
      const locMoves = moves
        .filter(m => m.move_sessions?.to_location === currentLoc)
        .sort((a,b) => new Date(b.move_sessions.session_date) - new Date(a.move_sessions.session_date));
      if (locMoves.length) arrivalStr = locMoves[0].move_sessions.session_date;
    }

    const daysInStore = daysDiff(arrivalStr);
    S.items.set(barcode, {
      barcode,
      price: item.price || 0,
      displayName: buildDisplayName(item.brand, item.category, item.product_name, barcode),
      location: item.location || '-',
      createdAt: item.created_at,
      arrivalDate: arrivalStr,
      daysInStore,
      isLongterm: daysInStore >= S.threshold,
      status: item.status,
    });
  } catch(e) {
    S.items.set(barcode, { barcode, error: e.message });
  }
  renderScanList();
}

function renderScanList() {
  const all = [...S.items.values()];
  const valid = all.filter(i => !i.loading && !i.notFound && !i.error);
  const ltCount = valid.filter(i => i.isLongterm).length;

  document.getElementById('scan-count').textContent =
    `${valid.length}개 스캔됨${ltCount ? ` · 🔴 장기재고 ${ltCount}개` : ''}`;
  document.getElementById('process-btn').disabled = valid.length === 0;

  const sorted = [...all].sort((a,b) => {
    if (a.isLongterm && !b.isLongterm) return -1;
    if (!a.isLongterm && b.isLongterm) return 1;
    return (b.daysInStore||0) - (a.daysInStore||0);
  });

  const list = document.getElementById('scan-list');
  list.innerHTML = sorted.map(item => {
    const rm = `<button class="remove-btn" data-bc="${escapeHtml(item.barcode)}">×</button>`;
    if (item.loading) return `<div class="scan-card"><span class="bc-text">${escapeHtml(item.barcode)}</span> <span class="muted">조회 중...</span></div>`;
    if (item.notFound) return `<div class="scan-card card-err"><div class="row-sb"><span class="bc-text">${escapeHtml(item.barcode)}</span>${rm}</div><div class="err-text">⚠ DB에서 찾을 수 없음</div></div>`;
    if (item.error) return `<div class="scan-card card-err"><div class="row-sb"><span class="bc-text">${escapeHtml(item.barcode)}</span>${rm}</div><div class="err-text">${escapeHtml(item.error)}</div></div>`;

    const badge = `<span class="badge ${item.isLongterm?'badge-red':'badge-green'}">${item.daysInStore}일</span>`;
    const soldTag = item.status==='sold' ? '<span class="sold-tag">판매됨</span>' : '';

    return `<div class="scan-card${item.isLongterm?' card-lt':''}">
      <div class="card-top">
        <div class="card-main">
          <div class="item-name">${escapeHtml(item.displayName)}</div>
          <div class="card-sub">
            <span class="bc-text">${escapeHtml(item.barcode)}</span>
            <span class="dot-sep">·</span>
            <span class="loc-text">${escapeHtml(item.location)}</span>
            ${soldTag}
          </div>
        </div>
        <div class="card-right">
          ${badge}
          ${rm}
        </div>
      </div>
      <div class="card-price">${item.price.toLocaleString()}<span class="unit">원</span></div>
      <div class="date-row">
        <span class="date-pill date-initial">최초입고 ${fmtDate(item.createdAt)}</span>
        <span class="date-pill date-arrival">이 매장 ${fmtDate(item.arrivalDate)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="empty-msg">바코드를 스캔하면 여기에 표시됩니다</div>';

  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.onclick = () => { S.items.delete(btn.dataset.bc); renderScanList(); };
  });
}

// ── STEP 3: 처리 ─────────────────────────────────────────────────────────────

function initProcessStep() {
  const all = [...S.items.values()].filter(i => !i.loading && !i.notFound && !i.error);
  const lt  = all.filter(i => i.isLongterm).sort((a,b) => b.daysInStore - a.daysInStore);
  const ok  = all.filter(i => !i.isLongterm).sort((a,b) => b.daysInStore - a.daysInStore);

  // 장기재고 자동 선택
  S.selected = new Set(lt.map(i => i.barcode));

  let html = `<div class="page-header">
    <button class="back-btn" id="proc-back">← 스캔으로</button>
    <span class="page-title">처리할 물건 선택</span>
  </div>`;

  if (lt.length) {
    html += `<div class="section-hd red-hd">🔴 장기재고 ${lt.length}개 (${S.threshold}일 초과)</div>`;
    html += lt.map(i => processCard(i)).join('');
  }
  if (ok.length) {
    html += `<div class="section-hd green-hd" style="margin-top:${lt.length?'12px':'0'}">🟢 정상 ${ok.length}개</div>`;
    html += ok.map(i => processCard(i)).join('');
  }

  html += `<div class="action-bar">
    <span id="sel-count" class="sel-count">${S.selected.size}개 선택됨</span>
    <button class="btn btn-price" id="goto-price" ${S.selected.size?'':'disabled'}>💰 가격수정</button>
    <button class="btn btn-move"  id="goto-move"  ${S.selected.size?'':'disabled'}>📦 이동복사</button>
  </div>`;

  const el = document.getElementById('step-process');
  el.innerHTML = html;

  el.querySelector('#proc-back').onclick = () => showStep('scan');
  el.querySelectorAll('.proc-cb').forEach(cb => {
    cb.checked = S.selected.has(cb.dataset.bc);
    cb.onchange = () => {
      cb.checked ? S.selected.add(cb.dataset.bc) : S.selected.delete(cb.dataset.bc);
      updateProcActions();
    };
  });
  el.querySelector('#goto-price').onclick = () => { showStep('price'); initPriceStep(); };
  el.querySelector('#goto-move').onclick  = () => { showStep('move');  initMoveStep();  };
}

function processCard(item) {
  const badge = `<span class="badge ${item.isLongterm?'badge-red':'badge-green'}">${item.daysInStore}일</span>`;
  const chk = S.selected.has(item.barcode) ? 'checked' : '';
  return `<label class="proc-card${item.isLongterm?' card-lt':''}">
    <input type="checkbox" class="proc-cb" data-bc="${escapeHtml(item.barcode)}" ${chk}>
    <div class="proc-info">
      <div class="proc-top">
        <div class="item-name" style="flex:1;min-width:0">${escapeHtml(item.displayName)}</div>
        ${badge}
      </div>
      <div class="card-sub" style="margin-top:3px">
        <span class="bc-text">${escapeHtml(item.barcode)}</span>
      </div>
      <div class="card-price" style="margin-top:8px">${item.price.toLocaleString()}<span class="unit">원</span></div>
      <div class="date-row">
        <span class="date-pill date-initial">최초입고 ${fmtDate(item.createdAt)}</span>
        <span class="date-pill date-arrival">이 매장 ${fmtDate(item.arrivalDate)}</span>
      </div>
    </div>
  </label>`;
}

function updateProcActions() {
  document.getElementById('sel-count').textContent = `${S.selected.size}개 선택됨`;
  document.getElementById('goto-price').disabled = S.selected.size === 0;
  document.getElementById('goto-move').disabled  = S.selected.size === 0;
}

// ── STEP 4A: 가격수정 ────────────────────────────────────────────────────────

function initPriceStep() {
  S.priceMode = 'individual';
  S.priceOriginal = [...S.selected].map(bc => {
    const item = S.items.get(bc);
    return { barcode: bc, oldPrice: item?.price||0, displayName: item?.displayName||bc };
  });

  let html = `<div class="page-header">
    <button class="back-btn" id="price-back">← 선택으로</button>
    <span class="page-title">가격수정 (${S.priceOriginal.length}개)</span>
  </div>
  <div class="slack-notice">⚠️ Slack에 <strong>「지금 공동판매 엑셀 가격 수정 중입니다」</strong> 메시지를 먼저 보내주세요.</div>
  <div class="mode-bar">
    <button class="mode-btn active" id="mode-ind">개별 수정</button>
    <button class="mode-btn" id="mode-bulk">일괄 % 수정</button>
  </div>
  <div class="bulk-box" id="bulk-box">
    <div class="row-gap">
      <span style="color:#fbbf24;font-weight:600">할인율</span>
      <input class="bulk-input" id="bulk-pct" type="number" min="1" max="99" placeholder="30">
      <span style="color:#fbbf24;font-weight:700">%</span>
      <span class="muted" style="font-size:12px">반올림 천원 단위</span>
    </div>
  </div>`;

  html += S.priceOriginal.map((item, i) => `
    <div class="item-card">
      <div class="row-gap" style="margin-bottom:6px">
        <span class="bc-text">${escapeHtml(item.barcode)}</span>
        <span class="muted">${escapeHtml(item.displayName)}</span>
      </div>
      <div class="row-gap">
        <span class="price-old" id="old-${i}">${item.oldPrice.toLocaleString()}</span>
        <span class="muted">→</span>
        <input class="price-input" id="new-${i}" type="number" step="1000" min="0"
               value="${item.oldPrice}" data-original="${item.oldPrice}">
        <span class="muted">원</span>
      </div>
    </div>`).join('');

  html += `<button class="btn btn-price btn-block" id="price-apply" style="margin-top:16px">✅ 수정 적용하기</button>
  <div class="modal-overlay" id="price-modal">
    <div class="modal-box">
      <div style="font-weight:700;margin-bottom:12px">⚠️ 가격 수정 확인</div>
      <div id="price-summary" class="modal-msg"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-outline flex-1" id="price-cancel">취소</button>
        <button class="btn btn-price flex-1" id="price-confirm">수정 적용</button>
      </div>
    </div>
  </div>
  <div id="price-done" style="display:none;margin-top:14px">
    <div class="success-box">
      <div style="font-weight:700;margin-bottom:10px">✅ 가격 수정 완료</div>
      <div id="bulk-notice" class="muted" style="display:none;margin-bottom:12px;font-size:13px">
        일괄 할인된 물건에는 <strong>해당 %가 표시된 스티커</strong>를 기존 바코드 위에 붙여주세요.
      </div>
      <button class="btn btn-green btn-block" id="zpl-btn" style="display:none">🖨 수정된 라벨 ZPL 다운로드</button>
      <button class="btn btn-kiosk btn-block" id="kiosk-btn" style="margin-top:8px">🖥 키오스크 가격 업데이트</button>
      <div id="kiosk-status" class="muted" style="font-size:12px;text-align:center;margin-top:6px"></div>
    </div>
  </div>`;

  const el = document.getElementById('step-price');
  el.innerHTML = html;

  el.querySelector('#price-back').onclick = () => { showStep('process'); initProcessStep(); };
  el.querySelector('#mode-ind').onclick  = () => setPriceMode('individual');
  el.querySelector('#mode-bulk').onclick = () => setPriceMode('bulk');
  el.querySelector('#bulk-pct').oninput  = applyBulk;
  el.querySelectorAll('.price-input').forEach(inp => inp.oninput = () => onPriceChange(inp));
  el.querySelector('#price-apply').onclick  = openPriceConfirm;
  el.querySelector('#price-cancel').onclick = () => el.querySelector('#price-modal').classList.remove('open');
  el.querySelector('#price-confirm').onclick = submitPriceChanges;
}

function setPriceMode(mode) {
  S.priceMode = mode;
  document.getElementById('mode-ind').classList.toggle('active', mode==='individual');
  document.getElementById('mode-bulk').classList.toggle('active', mode==='bulk');
  document.getElementById('bulk-box').classList.toggle('open', mode==='bulk');
  if (mode === 'individual') {
    S.priceOriginal.forEach((d, i) => {
      const inp = document.getElementById(`new-${i}`);
      if (inp) { inp.value = d.oldPrice; onPriceChange(inp); }
    });
  }
}

function applyBulk() {
  const pct = parseFloat(document.getElementById('bulk-pct').value);
  if (isNaN(pct) || pct<=0 || pct>=100) return;
  S.priceOriginal.forEach((d, i) => {
    const inp = document.getElementById(`new-${i}`);
    if (!inp) return;
    inp.value = Math.round((d.oldPrice * (1-pct/100)) / 1000) * 1000;
    onPriceChange(inp);
  });
}

function onPriceChange(inp) {
  inp.classList.toggle('changed', parseInt(inp.value) !== parseInt(inp.dataset.original));
}

function getChanges() {
  return S.priceOriginal.map((d, i) => {
    const inp = document.getElementById(`new-${i}`);
    if (!inp) return null;
    const newPrice = parseInt(inp.value);
    if (isNaN(newPrice) || newPrice===d.oldPrice || newPrice<=0) return null;
    return { barcode: d.barcode, oldPrice: d.oldPrice, newPrice };
  }).filter(Boolean);
}

function openPriceConfirm() {
  const changes = getChanges();
  if (!changes.length) { appAlert('변경된 가격이 없습니다.'); return; }
  document.getElementById('price-summary').textContent =
    `변경 ${changes.length}건:\n` + changes.map(c => `${c.barcode}: ${c.oldPrice.toLocaleString()} → ${c.newPrice.toLocaleString()}원`).join('\n');
  document.getElementById('price-modal').classList.add('open');
}

async function submitPriceChanges() {
  const btn = document.getElementById('price-confirm');
  btn.disabled = true; btn.textContent = '⏳ 처리 중...';
  const changes = getChanges();
  try {
    const now = new Date().toISOString();
    const { error } = await sb.from('price_changes').insert(
      changes.map(c => ({ barcode:c.barcode, old_price:c.oldPrice, new_price:c.newPrice, changed_at:now, excel_updated:false }))
    );
    if (error) throw error;

    document.getElementById('price-modal').classList.remove('open');
    S.lastChanges = changes;

    // 로컬 캐시 업데이트
    changes.forEach(c => {
      const item = S.items.get(c.barcode);
      if (item) { item.price = c.newPrice; S.items.set(c.barcode, item); }
      const orig = S.priceOriginal.find(p => p.barcode===c.barcode);
      if (orig) orig.oldPrice = c.newPrice;
    });

    const done = document.getElementById('price-done');
    done.style.display = 'block';
    done.scrollIntoView({ behavior:'smooth', block:'center' });

    if (S.priceMode === 'bulk') {
      document.getElementById('bulk-notice').style.display = 'block';
    } else {
      const zplBtn = document.getElementById('zpl-btn');
      zplBtn.style.display = 'block';
      zplBtn.onclick = () => {
        window.open('labels.html?barcodes=' + encodeURIComponent(changes.map(c=>c.barcode).join(',')), '_blank');
      };
    }

    document.getElementById('kiosk-btn').onclick = submitKioskUpdate;
  } catch(e) {
    await appAlert('오류: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '수정 적용';
  }
}

async function submitKioskUpdate() {
  const btn = document.getElementById('kiosk-btn');
  const status = document.getElementById('kiosk-status');
  btn.disabled = true; btn.textContent = '⏳ 전송 중...';

  const { error } = await sb.from('kiosk_updates').insert(
    S.lastChanges.map(c => ({ barcode:c.barcode, new_price:c.newPrice }))
  );

  if (error) {
    btn.disabled = false; btn.textContent = '🖥 키오스크 가격 업데이트';
    status.textContent = '오류: ' + error.message;
    return;
  }
  btn.textContent = '✅ 전송 완료';
  btn.style.background = '#166534';
  status.textContent = `${S.lastChanges.length}개 전송됨 · 30초 내 자동 반영됩니다`;
}

// ── STEP 4B: 이동 복사 ───────────────────────────────────────────────────────

function initMoveStep() {
  const barcodes = [...S.selected];
  const items = barcodes.map(bc => S.items.get(bc)).filter(Boolean);

  document.getElementById('step-move').innerHTML = `
    <div class="page-header">
      <button class="back-btn" id="move-back">← 선택으로</button>
      <span class="page-title">이동복사 (${barcodes.length}개)</span>
    </div>
    <div class="move-list">
      ${items.map(i => `<div class="move-item">
        <span class="bc-text">${escapeHtml(i.barcode)}</span>
        <span class="muted">${escapeHtml(i.displayName)}</span>
      </div>`).join('')}
    </div>
    <button class="btn btn-move btn-block" id="copy-btn" style="margin-top:16px">📋 바코드 클립보드 복사</button>
    <div id="copy-status" style="display:none;color:#22c55e;text-align:center;margin-top:8px;font-size:13px">
      ✅ 복사됨! 이동앱에서 붙여넣기 하세요.
    </div>`;

  document.getElementById('move-back').onclick = () => { showStep('process'); initProcessStep(); };
  document.getElementById('copy-btn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(barcodes.join('\n'));
      document.getElementById('copy-status').style.display = 'block';
      document.getElementById('copy-btn').textContent = '✅ 복사됨';
    } catch(e) {
      appAlert('클립보드 복사 실패.\n수동으로 복사해주세요:\n\n' + barcodes.join('\n'));
    }
  };
}

// ── 초기화 ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  showStep('setup');
  initSetup();
});
