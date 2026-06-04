// ZPL 상수 — Flask 코드와 동일한 값
const ZPL = {
  LW: 472, LH: 354,
  NAME_H: 45,
  Y_NAME: 10, Y_PRICE: 63, Y_BC: 145, H_BC: 140, Y_BCNUM: 293,
  F_PRICE: 74, F_BCNUM: 35,
  BC_FO_X: 84, BC_BY: 3,
};

// ZPL ^FD 필드에 ^ 문자가 들어가면 명령어로 해석되므로 제거
function sanitizeZpl(s) {
  return String(s == null ? "" : s).replace(/\^/g, "");
}

// Canvas로 텍스트를 비트맵 → ZPL ^GFA 변환
function nameToGFA(text) {
  const W = ZPL.LW, H = ZPL.NAME_H;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.font = `700 38px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);

  const pixels = ctx.getImageData(0, 0, W, H).data;
  const bpr = Math.ceil(W / 8);
  let hex = "";
  for (let y = 0; y < H; y++) {
    const row = new Uint8Array(bpr);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (lum < 128) row[x >> 3] |= 0x80 >> (x & 7);
    }
    hex += Array.from(row).map(b => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  }
  const total = bpr * H;
  return `^GFA,${total},${total},${bpr},${hex}`;
}

// displayName 계산 (세션/재출력 경로 공통)
function buildDisplayName(brand, category, productName, barcode) {
  brand = (brand || "").trim();
  category = (category || "").trim();
  productName = (productName || "").trim();
  if (brand && category) return `${brand} ${category}`;
  if (category) return category;
  if (productName) return productName;
  return barcode || "";
}

function generateZpl(items) {
  const lines = [];
  for (const item of items) {
    if (item.isSeparator) {
      const hnum = sanitizeZpl(item.hangerNumber);
      const numFont = String(hnum).length === 1 ? 200 : 160;
      lines.push(
        "^XA", "^LH0,0",
        `^PW${ZPL.LW}`, `^LL${ZPL.LH}`,
        `^FO0,90^A0N,${numFont},${numFont}^FB${ZPL.LW},1,0,C^FD${hnum}^FS`,
        "^XZ", ""
      );
      continue;
    }

    const barcode = sanitizeZpl(item.barcode);
    // price가 NaN이면 0원으로 fallback
    const price = isFinite(Number(item.price)) ? Number(item.price) : 0;
    const priceStr = sanitizeZpl(price.toLocaleString("ko-KR"));
    const displayName = (item.displayName || "").trim();
    const hasKorean = /[ㄱ-ㅎ가-힣]/.test(displayName);

    let nameCmd;
    if (hasKorean) {
      nameCmd = `^FO0,${ZPL.Y_NAME}${nameToGFA(displayName)}^FS`;
    } else if (displayName) {
      const ascii = sanitizeZpl(displayName.replace(/[^\x00-\x7F]/g, "")).slice(0, 29);
      nameCmd = `^FO0,${ZPL.Y_NAME}^A0N,${ZPL.NAME_H},${ZPL.NAME_H}^FB${ZPL.LW},1,0,C^FD${ascii}^FS`;
    } else {
      nameCmd = "";
    }

    // 바코드 없으면 ^BC 명령어 생략 (빈 ^FD로 프린터 오류 방지)
    const bcLines = barcode
      ? [
          `^FO${ZPL.BC_FO_X},${ZPL.Y_BC}^BY${ZPL.BC_BY}^BCN,${ZPL.H_BC},N,N,N^FD${barcode}^FS`,
          `^FO0,${ZPL.Y_BCNUM}^A0N,${ZPL.F_BCNUM},${ZPL.F_BCNUM}^FB${ZPL.LW},1,0,C^FD${barcode}^FS`,
        ]
      : [];

    lines.push(
      "^XA", "^LH0,0",
      `^PW${ZPL.LW}`, `^LL${ZPL.LH}`,
      ...(nameCmd ? [nameCmd] : []),
      `^FO0,${ZPL.Y_PRICE}^A0N,${ZPL.F_PRICE},${ZPL.F_PRICE}^FB${ZPL.LW},1,0,C^FD${priceStr}^FS`,
      ...bcLines,
      "^XZ", ""
    );
  }
  return lines.join("\n");
}

// 세션 기반 아이템 목록 구성
async function buildItemsFromSession(sessionId) {
  const [{ data: sessRows, error: sessErr }, { data: hangerRows, error: hangerErr }] = await Promise.all([
    sb.from("inventory_sessions").select("*").eq("id", sessionId),
    sb.from("inventory_hangers").select("*").eq("session_id", sessionId).order("hanger_number"),
  ]);
  if (sessErr) throw new Error(sessErr.message);
  if (hangerErr) throw new Error(hangerErr.message);
  if (!sessRows || !sessRows.length) throw new Error("세션을 찾을 수 없습니다.");
  const sess = sessRows[0];
  const prefix = sess.barcode_prefix;
  const startNum = sess.start_barcode_num;
  const hangers = hangerRows || [];

  // N+1 방지: 모든 hanger_id를 한 번에 조회
  const hangerIds = hangers.map(h => h.id);
  const allItems = [];
  if (hangerIds.length) {
    const { data: invItems, error: itemErr } = await sb
      .from("inventory_items")
      .select("hanger_id,barcode,price,brand,category,order_index")
      .in("hanger_id", hangerIds)
      .order("hanger_id")
      .order("order_index");
    if (itemErr) throw new Error(itemErr.message);

    // hanger_id → hanger 매핑
    const hangerMap = Object.fromEntries(hangers.map(h => [h.id, h]));
    for (const it of (invItems || [])) {
      const hanger = hangerMap[it.hanger_id];
      if (!hanger) continue;
      let category = hanger.category || "";
      if (sess.location === "온라인" && !category.startsWith("온")) category = "온" + category;
      allItems.push({
        price: isFinite(Number(it.price)) ? Number(it.price) : 0,
        brand: it.brand || "",
        category,
        barcode: it.barcode || "",
        hangerNumber: hanger.hanger_number,
      });
    }
  }

  // 바코드가 모두 없을 때만 자동 할당 (부분 할당 상태는 건드리지 않음)
  if (startNum && allItems.length && allItems.every(it => !it.barcode)) {
    allItems.forEach((it, i) => { it.barcode = `${prefix}${startNum + i}`; });
  }

  allItems.forEach(it => {
    it.displayName = buildDisplayName(it.brand, it.category, "", it.barcode);
  });

  // 행거 순서대로 정렬 후 구분자 삽입
  const hangerOrder = Object.fromEntries(hangers.map((h, i) => [h.hanger_number, i]));
  allItems.sort((a, b) => (hangerOrder[a.hangerNumber] ?? 0) - (hangerOrder[b.hangerNumber] ?? 0));

  const result = [];
  let curHanger = null;
  for (const it of allItems) {
    if (it.hangerNumber !== curHanger) {
      curHanger = it.hangerNumber;
      result.push({ isSeparator: true, hangerNumber: curHanger });
    }
    result.push(it);
  }
  return { items: result, sess };
}

// 바코드 목록 기반 아이템 구성
async function buildItemsFromBarcodes(barcodes) {
  const { data: rows, error } = await sb
    .from("inventory_items")
    .select("barcode,price,brand,category,product_name")
    .in("barcode", barcodes);
  if (error) throw new Error(error.message);

  const dbMap = {};
  (rows || []).forEach(r => { if (r.barcode) dbMap[r.barcode.toUpperCase()] = r; });

  const items = [], notFound = [];
  for (const bc of barcodes) {
    const row = dbMap[bc.toUpperCase()];
    if (!row) { notFound.push(bc); continue; }
    items.push({
      barcode: bc,
      price: isFinite(Number(row.price)) ? Number(row.price) : 0,
      displayName: buildDisplayName(row.brand, row.category, row.product_name, bc),
    });
  }
  return { items, notFound };
}

// HTML 라벨 미리보기 렌더 (SVG id는 index 기반으로 CSS selector 충돌 방지)
function renderPreview(items) {
  const grid = document.getElementById("label-grid");
  grid.innerHTML = items.map((item, idx) => {
    if (item.isSeparator) {
      return `<div class="label-separator"><div class="sep-num">${escapeHtml(String(item.hangerNumber))}</div></div>`;
    }
    return `
      <div class="label">
        <div class="label-name">${escapeHtml(item.displayName || "")}</div>
        <div class="label-price-wrap">
          <div class="label-price">${(isFinite(Number(item.price)) ? Number(item.price) : 0).toLocaleString("ko-KR")}</div>
        </div>
        <div class="label-bottom">
          <div class="label-barcode"><svg id="bc-idx-${idx}"></svg></div>
          <div class="label-barcode-num">${escapeHtml(item.barcode || "")}</div>
        </div>
      </div>`;
  }).join("");

  items.forEach((item, idx) => {
    if (item.isSeparator || !item.barcode) return;
    try {
      JsBarcode(`#bc-idx-${idx}`, item.barcode, {
        format: "CODE128", width: 1.2, height: 28, displayValue: false, margin: 1,
      });
    } catch (e) { console.warn("바코드 렌더 실패:", item.barcode, e); }
  });
}

function downloadZpl(zplText, filename) {
  const blob = new Blob([zplText], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

async function zebraPrint(zplText, totalCount) {
  const btn = document.getElementById("zebra-btn");
  btn.disabled = true;
  btn.textContent = "⏳ 프린터 연결 중…";

  if (typeof BrowserPrint === "undefined") {
    await appAlert("❌ BrowserPrint SDK 로드 실패");
    btn.textContent = "🦓 Zebra 직접 출력"; btn.disabled = false;
    return;
  }

  BrowserPrint.getDefaultDevice("printer",
    printer => {
      if (!printer) {
        appAlert("❌ 연결된 Zebra 프린터 없음\nUSB 케이블 및 전원을 확인하세요.");
        btn.textContent = "🦓 Zebra 직접 출력"; btn.disabled = false;
        return;
      }
      btn.textContent = `⏳ 전송 중… (${totalCount}장)`;
      printer.send(zplText,
        () => {
          btn.textContent = "✓ 출력 완료!";
          btn.style.background = "#166534";
          setTimeout(() => {
            btn.textContent = "🦓 Zebra 직접 출력";
            btn.style.background = "#22c55e";
            btn.disabled = false;
          }, 3000);
        },
        err => {
          appAlert("❌ 전송 실패: " + (err || "알 수 없는 오류"));
          btn.textContent = "🦓 Zebra 직접 출력"; btn.disabled = false;
        }
      );
    },
    err => {
      appAlert("❌ Browser Print 연결 실패\nBrowser Print 앱이 실행 중인지 확인하세요.\n오류: " + (err || "unknown"));
      btn.textContent = "🦓 Zebra 직접 출력"; btn.disabled = false;
    }
  );
}

// ── 진입점 ──────────────────────────────────────────────────────────────────
async function main() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session_id");
  const barcodesParam = params.get("barcodes");

  const zplBtn = document.getElementById("zpl-btn");
  const zebraBtn = document.getElementById("zebra-btn");
  let items, notFound = [], sess = null, zplFilename = "labels.zpl";

  try {
    if (sessionId) {
      ({ items, sess } = await buildItemsFromSession(sessionId));
      const date = sess.session_date || new Date().toISOString().slice(0, 10);
      zplFilename = `labels_${date}_${sess.barcode_prefix}.zpl`;
      const labelCount = items.filter(it => !it.isSeparator).length;
      document.getElementById("header-title").textContent = `🖨 라벨 출력 — ${date}`;
      document.getElementById("header-sub").textContent =
        `총 ${labelCount}장` +
        (sess.start_barcode_num
          ? ` · ${sess.barcode_prefix}${sess.start_barcode_num} ~ ${sess.barcode_prefix}${sess.start_barcode_num + labelCount - 1}`
          : "");
    } else if (barcodesParam) {
      const barcodes = barcodesParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      ({ items, notFound } = await buildItemsFromBarcodes(barcodes));
      document.getElementById("header-title").textContent = "🖨 라벨 재출력";
      document.getElementById("header-sub").textContent = `총 ${items.length}장`;
    } else {
      document.getElementById("header-title").textContent = "잘못된 접근";
      zplBtn.disabled = true; zebraBtn.disabled = true;
      return;
    }
  } catch (e) {
    document.getElementById("header-title").textContent = "오류";
    document.getElementById("header-sub").textContent = e.message;
    zplBtn.disabled = true; zebraBtn.disabled = true;
    return;
  }

  if (notFound.length) {
    const box = document.getElementById("not-found-box");
    box.style.display = "block";
    document.getElementById("not-found-title").textContent =
      `⚠ DB에서 찾지 못한 바코드 ${notFound.length}개`;
    document.getElementById("not-found-list").textContent = notFound.join(", ");
  }

  renderPreview(items);

  const labelItems = items.filter(it => !it.isSeparator);
  const zplText = generateZpl(items);

  zplBtn.addEventListener("click", () => downloadZpl(zplText, zplFilename));
  zebraBtn.addEventListener("click", () => zebraPrint(zplText, labelItems.length));
}

main();
