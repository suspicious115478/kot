import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast
} from "./firebase.js";

import {
  collection, doc, addDoc, deleteDoc, updateDoc, getDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();

document.getElementById("restaurantLabel").textContent = name || "My Restaurant";


// ── Firestore refs ─────────────────────────────────────────────────────────────
const unitsRef = collection(db, "restaurants", restaurantId, "inventory_units");
const rawRef   = collection(db, "restaurants", restaurantId, "inventory_raw");

// ── Helpers ──────────────────────────────────────────────────────────────────
function setCount(id, n, singular, plural) {
  document.getElementById(id).textContent = `${n} ${n === 1 ? singular : plural}`;
}

// ── UNITS ─────────────────────────────────────────────────────────────────────
let unitMap = {}; // id → { name, symbol }
let rawDocs = []; // latest snapshot docs — used by CSV import

onSnapshot(query(unitsRef, orderBy("createdAt")), (snap) => {
  unitMap = {};
  snap.forEach(d => { unitMap[d.id] = d.data(); });

  setCount("unitCount", snap.size, "unit", "units");
  renderUnits(snap.docs);
  refreshRawUnitSelect();
});

function renderUnits(docs) {
  const list  = document.getElementById("unitList");
  const empty = document.getElementById("unitEmpty");

  // Remove old items (keep empty placeholder)
  list.querySelectorAll(".list-item").forEach(el => el.remove());

  if (!docs.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  docs.forEach(d => {
    const data = d.data();
    const item = document.createElement("div");
    item.className = "list-item";
    // AFTER
    item.style.cssText = "display:inline-flex; align-items:center; gap:6px; padding:6px 10px 6px 8px; background:var(--surface2); border:1px solid var(--border); border-radius:8px;";
    item.innerHTML = `
      <span class="item-dot unit-dot"></span>
      <span style="font-size:0.82rem; font-weight:600; color:var(--text);">${escHtml(data.name)}</span>
      ${data.symbol ? `<span class="item-badge unit-badge" style="margin:0;">${escHtml(data.symbol)}</span>` : ""}
      <button class="item-del" data-id="${d.id}" title="Delete" style="margin-left:2px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    `;
    item.querySelector(".item-del").addEventListener("click", () => deleteUnit(d.id));
    list.appendChild(item);
  });
}

document.getElementById("addUnitBtn").addEventListener("click", async () => {
  const nameEl   = document.getElementById("unitName");
  const symbolEl = document.getElementById("unitSymbol");
  const name     = nameEl.value.trim();
  const symbol   = symbolEl.value.trim();

  if (!name) { showToast("Unit name required", true); nameEl.focus(); return; }
  if (!symbol) { showToast("Unit symbol required", true); symbolEl.focus(); return; }

  const btn = document.getElementById("addUnitBtn");
  btn.disabled = true;
  try {
    await addDoc(unitsRef, { name, symbol, createdAt: serverTimestamp() });
    nameEl.value = "";
    symbolEl.value = "";
    showToast("Unit added ✅");
  } catch (err) {
    showToast("Failed: " + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

async function deleteUnit(id) {
  try {
    await deleteDoc(doc(db, "restaurants", restaurantId, "inventory_units", id));
    showToast("Unit deleted");
  } catch (err) {
    showToast("Delete failed: " + err.message, true);
  }
}

// ── RAW MATERIALS ─────────────────────────────────────────────────────────────
onSnapshot(query(rawRef, orderBy("createdAt")), (snap) => {
  rawDocs = snap.docs;
  setCount("rawCount", snap.size, "item", "items");
  renderRaw(snap.docs);
});

// AFTER
function renderRaw(docs) {
  const list  = document.getElementById("rawList");
  const empty = document.getElementById("rawEmpty");

  list.querySelectorAll(".list-item").forEach(el => el.remove());
  empty.style.display = "none";
  return;

  docs.forEach(d => {
    const data   = d.data();
    const unit   = data.unitId ? (unitMap[data.unitId]?.name || "") : "";
    const symbol = data.unitId ? (unitMap[data.unitId]?.symbol || "") : "";

    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <span class="item-dot raw-dot"></span>
      <div class="item-info">
        <div class="item-name">${escHtml(data.name)}</div>
        ${data.description ? `<div class="item-meta">${escHtml(data.description)}</div>` : ""}
      </div>
      ${unit ? `<span class="item-badge" style="background:#F0FDF4;color:#16A34A;border:1px solid #BBF7D0;">${escHtml(unit)}${symbol ? ` (${escHtml(symbol)})` : ""}</span>` : ""}
      <button class="item-del" data-id="${d.id}" title="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    `;
    item.querySelector(".item-del").addEventListener("click", () => deleteRaw(d.id));
    list.appendChild(item);
  });
}

document.getElementById("addRawBtn").addEventListener("click", async () => {
  const nameEl = document.getElementById("rawName");
  const unitEl = document.getElementById("rawUnit");
  const descEl = document.getElementById("rawDesc");

  const name  = nameEl.value.trim();
  const unitId = unitEl.value;
  const desc  = descEl.value.trim();

  if (!name) { showToast("Material name required", true); nameEl.focus(); return; }
  if (!unitId) { showToast("Please select a unit", true); unitEl.focus(); return; }

  const btn = document.getElementById("addRawBtn");
  btn.disabled = true;
  try {
    await addDoc(rawRef, { name, unitId, description: desc, createdAt: serverTimestamp() });
    nameEl.value = "";
    unitEl.value = "";
    descEl.value = "";
    showToast("Raw material added ✅");
  } catch (err) {
    showToast("Failed: " + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

async function deleteRaw(id) {
  try {
    await deleteDoc(doc(db, "restaurants", restaurantId, "inventory_raw", id));
    showToast("Material deleted");
  } catch (err) {
    showToast("Delete failed: " + err.message, true);
  }
}

// ── Refresh unit dropdown in raw material form ─────────────────────────────────
function refreshRawUnitSelect() {
  const sel = document.getElementById("rawUnit");
  const prev = sel.value;
  sel.innerHTML = `<option value="">— select unit —</option>`;
  Object.entries(unitMap).forEach(([id, data]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = data.symbol ? `${data.name} (${data.symbol})` : data.name;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ══════════════════════════════════════════════════════════════════
// ── CSV IMPORT ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

const CSV_HEADERS = ["name", "unit_symbol", "description"];
let csvParsedRows = []; // { name, unit_symbol, description, status, unitId? }

// ── Download template ─────────────────────────────────────────────
document.getElementById("downloadTemplateBtn").addEventListener("click", () => {
 const content = [
    "name,unit_symbol,opening_stock,description",
    "# Instructions: Fill your data below. Delete this comment row before importing.",
    "# name = Required. Material name (e.g. Tomatoes)",
    "# unit_symbol = Must match an existing unit symbol (e.g. kg, litre, pcs). Leave blank if none.",
    "# opening_stock = Optional. Current quantity on hand (numeric). Leave blank for 0.",
    "# description = Optional. Any notes about this material.",
    "Tomatoes,kg,25,Fresh roma tomatoes",
    "Onions,kg,10,",
    "Olive Oil,litre,5,Extra virgin",
    "Salt,gm,,",
  ].join("\n");
  const blob = new Blob([content], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "raw_materials_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Open / close modal ────────────────────────────────────────────
const csvOverlay = document.getElementById("csvImportOverlay");

document.getElementById("importCsvBtn").addEventListener("click", () => {
  csvParsedRows = [];
  document.getElementById("csvPreviewWrap").style.display = "none";
  document.getElementById("csvPreviewRows").innerHTML = "";
  document.getElementById("csvSummary").textContent = "";
  document.getElementById("csvConfirmBtn").disabled = true;
  document.getElementById("csvConfirmBtn").style.opacity = "0.4";
  resetDropZone();
  csvOverlay.style.display = "flex";
});

function closeCsvModal() { csvOverlay.style.display = "none"; }
document.getElementById("csvModalClose").addEventListener("click", closeCsvModal);
document.getElementById("csvCancelBtn").addEventListener("click", closeCsvModal);
csvOverlay.addEventListener("click", e => { if (e.target === csvOverlay) closeCsvModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && csvOverlay.style.display === "flex") closeCsvModal();
});

// ── Drop zone ─────────────────────────────────────────────────────
const dropZone = document.getElementById("csvDropZone");
const fileInput = document.getElementById("csvFileInput");

function resetDropZone() {
  dropZone.style.borderColor = "var(--border2)";
  dropZone.style.background  = "transparent";
}

dropZone.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.style.borderColor = "var(--green)";
  dropZone.style.background  = "var(--green-bg)";
});
dropZone.addEventListener("dragleave", resetDropZone);
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  resetDropZone();
  const file = e.dataTransfer.files[0];
  if (file) handleCsvFile(file);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleCsvFile(fileInput.files[0]);
});

// ── Parse CSV ─────────────────────────────────────────────────────
function handleCsvFile(file) {
  if (!file.name.endsWith(".csv")) {
    showToast("Only .csv files allowed", true); return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    parseCsv(text);
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) { showToast("CSV is empty", true); return; }

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const nameIdx  = headers.indexOf("name");
  const unitIdx  = headers.indexOf("unit_symbol");
  const descIdx  = headers.indexOf("description");
  const qtyIdx   = headers.indexOf("opening_stock");

  if (nameIdx === -1) {
    showToast("CSV must have a 'name' column", true); return;
  }

  const dataLines = lines.slice(1).slice(0, 500);
  csvParsedRows = [];

  // Build existing name → docId map for duplicate detection
  const existingNameMap = {};
  rawDocs.forEach(d => {
    existingNameMap[d.data().name.trim().toLowerCase()] = d.id;
  });

  dataLines.forEach(line => {
    const cols        = parseCsvLine(line);
    const name        = cols[nameIdx]?.trim() || "";
    const unitSymbol  = unitIdx !== -1 ? (cols[unitIdx]?.trim()  || "") : "";
    const description = descIdx !== -1 ? (cols[descIdx]?.trim()  || "") : "";
    const qtyRaw      = qtyIdx  !== -1 ? (cols[qtyIdx]?.trim()   || "") : "";
    const stock       = qtyRaw !== "" && !isNaN(parseFloat(qtyRaw)) ? parseFloat(qtyRaw) : null;

    if (!name) return;

    let unitId = "", unitMatchName = "";
    if (unitSymbol) {
      const match = Object.entries(unitMap).find(
        ([, u]) => u.symbol?.toLowerCase() === unitSymbol.toLowerCase()
               ||  u.name?.toLowerCase()   === unitSymbol.toLowerCase()
      );
      if (match) { unitId = match[0]; unitMatchName = match[1].symbol || match[1].name; }
    }

    const existingDocId = existingNameMap[name.toLowerCase()] || null;

    csvParsedRows.push({
      name, unitSymbol, unitId, unitMatchName, description,
      stock,                          // null = no qty given
      existingDocId,                  // null = new material
      unitNotFound: unitSymbol && !unitId
    });
  });

  if (!csvParsedRows.length) {
    showToast("No valid rows found in CSV", true); return;
  }

  renderCsvPreview();
}

function parseCsvLine(line) {
  const result = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { result.push(cur); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// ── Render preview ────────────────────────────────────────────────
function renderCsvPreview() {
  const container = document.getElementById("csvPreviewRows");
  const summary   = document.getElementById("csvSummary");
  container.innerHTML = "";

  // Update preview header to show Stock column
  container.closest("div").previousElementSibling.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 70px 60px 80px;gap:0;background:var(--surface2);border-bottom:1px solid var(--border);padding:8px 14px;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);">
      <div>Name</div><div>Unit</div><div>Stock</div><div>Status</div>
    </div>`;

  let warnCount = 0, updateCount = 0, newCount = 0;

  csvParsedRows.forEach(row => {
    const isUpdate   = !!row.existingDocId;
    const hasWarn    = row.unitNotFound;
    if (hasWarn)   warnCount++;
    if (isUpdate)  updateCount++;
    else           newCount++;

    const statusHtml = isUpdate
      ? `<span style="font-size:0.65rem;font-weight:600;color:#1D4ED8;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:99px;padding:1px 7px;">Update</span>`
      : hasWarn
        ? `<span style="font-size:0.65rem;font-weight:600;color:#D97706;background:#FFFBEB;border:1px solid #FDE68A;border-radius:99px;padding:1px 7px;">New ⚠</span>`
        : `<span style="font-size:0.65rem;font-weight:600;color:var(--green);background:var(--green-bg);border:1px solid var(--green-brd);border-radius:99px;padding:1px 7px;">New</span>`;

    const unitDisplay = row.unitMatchName
      ? `<span style="font-size:0.72rem;color:var(--green);font-weight:600;">${escHtml(row.unitMatchName)}</span>`
      : row.unitSymbol
        ? `<span style="font-size:0.72rem;color:var(--muted);">${escHtml(row.unitSymbol)} <span style="color:#D97706;">✗</span></span>`
        : `<span style="font-size:0.72rem;color:var(--muted);">—</span>`;

    const stockDisplay = row.stock !== null
      ? `<span style="font-size:0.78rem;font-weight:600;color:var(--text);">${row.stock}</span>`
      : `<span style="font-size:0.72rem;color:var(--muted);">—</span>`;

    const el = document.createElement("div");
    el.style.cssText = "display:grid;grid-template-columns:1fr 70px 60px 80px;gap:0;padding:8px 14px;border-bottom:1px solid var(--border);align-items:center;font-size:0.76rem;";
    el.innerHTML = `
      <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">${escHtml(row.name)}</div>
      <div>${unitDisplay}</div>
      <div>${stockDisplay}</div>
      <div>${statusHtml}</div>
    `;
    container.appendChild(el);
  });

  const last = container.lastChild;
  if (last) last.style.borderBottom = "none";

  const total = csvParsedRows.length;
  const parts = [];
  if (newCount)    parts.push(`${newCount} new`);
  if (updateCount) parts.push(`${updateCount} update`);
  if (warnCount)   parts.push(`${warnCount} unmatched unit`);
  summary.textContent = `${total} row${total !== 1 ? "s" : ""} — ${parts.join(" • ")}`;

  document.getElementById("csvPreviewWrap").style.display = "block";
  const btn = document.getElementById("csvConfirmBtn");
  btn.disabled = false;
  btn.style.opacity = "1";
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Import ${total} item${total !== 1 ? "s" : ""}`;
}

// ── Confirm import ────────────────────────────────────────────────
document.getElementById("csvConfirmBtn").addEventListener("click", async () => {
  if (!csvParsedRows.length) return;

  const btn = document.getElementById("csvConfirmBtn");
  btn.disabled = true;
  btn.style.opacity = "0.6";
  btn.innerHTML = `<span style="font-size:0.8rem;">Importing...</span>`;

  let added = 0, updated = 0, skipped = 0;

  for (const row of csvParsedRows) {
    try {
      if (row.existingDocId) {
        // ── UPDATE existing material ──────────────────────────────
        const rawDocRef = doc(db, "restaurants", restaurantId, "inventory_raw", row.existingDocId);
        const payload = {
          unitId:      row.unitId      || "",
          description: row.description || ""
        };
        // Only update stock if a value was provided
       if (row.stock !== null) {
          const snap = await getDoc(rawDocRef);
          const prevQty = snap.exists() && typeof snap.data().stock === "number"
            ? snap.data().stock : 0;
          const newQty = prevQty + row.stock;
          payload.stock = newQty;
          const histRef = collection(db, "restaurants", restaurantId, "inventory_raw", row.existingDocId, "stock_history");
          await addDoc(histRef, {
            type: "add", qty: row.stock,
            prevQty, newQty,
            note: "CSV import", createdAt: serverTimestamp()
          });
        }
        await updateDoc(rawDocRef, payload);
        updated++;
      } else {
        // ── ADD new material ──────────────────────────────────────
        const payload = {
          name:        row.name,
          unitId:      row.unitId      || "",
          description: row.description || "",
          createdAt:   serverTimestamp()
        };
        if (row.stock !== null) payload.stock = row.stock;

        const newRef = await addDoc(rawRef, payload);

        // Write opening stock history if qty given
        if (row.stock !== null && row.stock > 0) {
          const histRef = collection(db, "restaurants", restaurantId, "inventory_raw", newRef.id, "stock_history");
          await addDoc(histRef, {
            type: "add", qty: row.stock,
            prevQty: 0, newQty: row.stock,
            note: "Opening stock (CSV import)", createdAt: serverTimestamp()
          });
        }
        added++;
      }
    } catch (err) {
      skipped++;
    }
  }

  closeCsvModal();
  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  if (parts.length) showToast(`Import done — ${parts.join(", ")} ✅`);
  if (skipped)      showToast(`${skipped} rows failed`, true);
});