import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast
} from "./firebase.js";

import {
  collection, doc, addDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy, limit, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Firestore refs ─────────────────────────────────────────────────────────────
const rawRef      = collection(db, "restaurants", restaurantId, "inventory_raw");
const unitsRef     = collection(db, "restaurants", restaurantId, "inventory_units");
const removalsRef = collection(db, "restaurants", restaurantId, "stock_removals");

// ── Local state ───────────────────────────────────────────────────────────────
let unitMap   = {};  // unitId → { name, symbol }
let rawMatMap = {};  // rawId → { name, unitId, unitSymbol }

// ── Load units ────────────────────────────────────────────────────────────────
onSnapshot(query(unitsRef, orderBy("createdAt")), snap => {
  unitMap = {};
  snap.forEach(d => { unitMap[d.id] = d.data(); });
  renderRawOptions();
});

// ── Load raw materials → populate dropdown ─────────────────────────────────────
onSnapshot(query(rawRef, orderBy("name")), snap => {
  rawMatMap = {};
  snap.forEach(d => {
    const data = d.data();
    const unit = data.unitId ? (unitMap[data.unitId] || {}) : {};
    rawMatMap[d.id] = {
      name:       data.name,
      unitId:     data.unitId || "",
      unitSymbol: unit.symbol || unit.name || "",
      stock:      typeof data.stock === "number" ? data.stock : 0
    };
  });
  renderRawOptions();
});

function renderRawOptions() {
  refreshAllSelects();
}

// ── Remove from stock ────────────────────────────────────────────────────────
// Purana poora listener replace karo:
document.getElementById("removeConfirmBtn").addEventListener("click", async () => {
  const rows = document.querySelectorAll("#removeItemsContainer .so-form-row");
  const note = document.getElementById("removeNoteInput").value.trim();
  const items = [];

  for (const row of rows) {
    const rawId = row.querySelector(".row-mat-select").value;
    const qty   = parseFloat(row.querySelector(".row-qty-input").value);
    if (!rawId && !row.querySelector(".row-qty-input").value) continue; // empty row skip
    if (!rawId) { showToast("Select a material for each row", true); return; }
    if (!Number.isFinite(qty) || qty <= 0) { showToast("Enter a valid positive quantity for each row", true); return; }
    if (!rawMatMap[rawId]) { showToast("Material not found", true); return; }
    items.push({ rawId, qty });
  }

  if (!items.length) { showToast("Add at least one item", true); return; }

  for (const { rawId, qty } of items) {
    const mat = rawMatMap[rawId];
    if (qty > mat.stock) {
      showToast(`Not enough stock for "${mat.name}" — only ${formatQty(mat.stock)} available`, true);
      return;
    }
  }

  const btn = document.getElementById("removeConfirmBtn");
  btn.disabled = true;

  try {
    for (const { rawId, qty } of items) {
      const mat = rawMatMap[rawId];
      const rawDocRef = doc(db, "restaurants", restaurantId, "inventory_raw", rawId);
      let prevStock = 0, newStock = 0;

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(rawDocRef);
        prevStock = snap.exists() && typeof snap.data().stock === "number" ? snap.data().stock : 0;
        if (qty > prevStock) {
          throw new Error(`Not enough stock for "${mat.name}" — only ${formatQty(prevStock)} available`);
        }
        newStock = prevStock - qty;
        tx.update(rawDocRef, { stock: newStock });
      });

      await addDoc(removalsRef, {
        rawId,
        rawName:    mat.name,
        qty,
        unitSymbol: mat.unitSymbol || "",
        note:       note || "",
        createdAt:  serverTimestamp()
      });

      const histRef = collection(db, "restaurants", restaurantId, "inventory_raw", rawId, "stock_history");
      await addDoc(histRef, {
        type:      "deduct",
        qty,
        prevQty:   prevStock,
        newQty:    newStock,
        note:      note ? `Manual removal — ${note}` : "Manual removal",
        createdAt: serverTimestamp()
      });
    }

    showToast(`${items.length} item${items.length > 1 ? "s" : ""} removed ✅`);

    // Reset rows
    document.getElementById("removeItemsContainer").innerHTML = "";
    rowCount = 0;
    addRow();
    document.getElementById("removeNoteInput").value = "";
  } catch (err) {
    showToast("Failed: " + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ── Recent removals — show last 5, auto-clean anything older ──────────────────
onSnapshot(query(removalsRef, orderBy("createdAt", "desc"), limit(10)), (snap) => {
  const docs = snap.docs;
  renderRemovals(docs.slice(0, 5));

  // Database lean rakhne ke liye — 5 se zyada purane entries hata do
  if (docs.length > 5) {
    docs.slice(5).forEach(d => {
      deleteDoc(doc(db, "restaurants", restaurantId, "stock_removals", d.id)).catch(() => {});
    });
  }
});

function renderRemovals(docs) {
  const list  = document.getElementById("removalsList");
  const empty = document.getElementById("removalsEmpty");

  list.querySelectorAll(".so-hist-row").forEach(el => el.remove());

  if (!docs.length) {
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";

  docs.forEach(d => {
    const data    = d.data();
    const ts      = data.createdAt?.toDate();
    const timeStr = ts ? formatTime(ts) : "—";

    const row = document.createElement("div");
    row.className = "so-hist-row";
    row.innerHTML = `
      <div class="so-hist-dot"></div>
      <div class="so-hist-info">
        <div class="so-hist-line">
          <span class="so-hist-name">${escHtml(data.rawName)}</span>
          <span class="so-hist-qty">-${formatQty(data.qty)}${data.unitSymbol ? " " + escHtml(data.unitSymbol) : ""}</span>
        </div>
        ${data.note ? `<div class="so-hist-reason">${escHtml(data.note)}</div>` : ""}
        <div class="so-hist-time">${timeStr}</div>
      </div>
    `;
    list.appendChild(row);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatQty(n) {
  return Number.isInteger(n) ? n : parseFloat(n.toFixed(3));
}



// ── Multi-item rows ───────────────────────────────────────────────────────────
function buildRowHTML(idx) {
  return `
    <div class="so-form-row" id="removeRow_${idx}" style="align-items:flex-end;margin-bottom:10px;">
      <div class="so-field" style="margin-bottom:0;">
        <label>Raw Material</label>
        <select class="so-input so-select row-mat-select">
          <option value="">— select material —</option>
        </select>
      </div>
     <div class="so-field" style="max-width:140px;margin-bottom:0;">
        <label>Quantity</label>
        <input type="number" class="so-input row-qty-input" placeholder="e.g. 2" min="0.001" step="any" inputmode="decimal" onkeydown="if(event.key==='-'||event.key==='+'||event.key==='e')event.preventDefault();" oninput="if(this.value<0)this.value='';" />
      </div>
      <button class="row-del-btn" data-idx="${idx}" title="Remove row" style="flex-shrink:0;width:36px;height:38px;border-radius:9px;border:1px solid var(--red-brd);background:var(--red-bg);color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;margin-bottom:0;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
}

let rowCount = 0;

function addRow() {
  const container = document.getElementById("removeItemsContainer");
  const idx = rowCount++;
  const div = document.createElement("div");
  div.innerHTML = buildRowHTML(idx);
  const row = div.firstElementChild;
  container.appendChild(row);

  // Populate select
  const sel = row.querySelector(".row-mat-select");
  Object.entries(rawMatMap).forEach(([id, m]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = m.unitSymbol ? `${m.name} (${m.unitSymbol})` : m.name;
    sel.appendChild(opt);
  });

  // Delete button
  row.querySelector(".row-del-btn").addEventListener("click", () => {
    row.remove();
    refreshDelBtns();
  });

  refreshDelBtns();
}

function refreshDelBtns() {
  const rows = document.querySelectorAll("#removeItemsContainer .so-form-row");
  rows.forEach(r => {
    const btn = r.querySelector(".row-del-btn");
    if (btn) btn.style.display = rows.length === 1 ? "none" : "flex";
  });
}

function refreshAllSelects() {
  document.querySelectorAll(".row-mat-select").forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">— select material —</option>`;
    Object.entries(rawMatMap).forEach(([id, m]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = m.unitSymbol ? `${m.name} (${m.unitSymbol})` : m.name;
      sel.appendChild(opt);
    });
    if (prev && rawMatMap[prev]) sel.value = prev;
  });
}

// Initial row
addRow();

document.getElementById("addMoreItemBtn").addEventListener("click", addRow);

function formatTime(date) {
  const now  = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60)    return "Just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}