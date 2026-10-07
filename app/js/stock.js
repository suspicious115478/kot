import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast
} from "./firebase.js";

import {
  collection, doc, addDoc, deleteDoc, updateDoc, setDoc,
  onSnapshot, serverTimestamp, query, orderBy, getDoc, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();

document.getElementById("restaurantLabel").textContent = name || "My Restaurant";
if (restaurantId) {

}

// ── Firestore refs ─────────────────────────────────────────────────────────────
const rawRef      = collection(db, "restaurants", restaurantId, "inventory_raw");
const dsoRef      = collection(db, "restaurants", restaurantId, "dso_config");
const restDocRef = doc(db, "restaurants", restaurantId);
const unitsRef    = collection(db, "restaurants", restaurantId, "inventory_units");
const removalsRef = collection(db, "restaurants", restaurantId, "stock_removals");

// ── Local state ───────────────────────────────────────────────────────────────
let unitMap = {};   // unitId → { name, symbol }
let dsoSavedState = {};  // rawId → { checked, qty }

async function loadDsoState() {
  const snap = await getDocs(dsoRef);
  dsoSavedState = {};
  snap.forEach(d => { dsoSavedState[d.id] = d.data(); });
}
await loadDsoState();
let rawDocs = [];   // latest snapshot docs
let searchQuery = "";

document.getElementById("stockSearchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderStock(rawDocs);
});
// ── Stock Mode ────────────────────────────────────────────────────────────────
let currentStockMode = "manual"; // default

async function loadStockMode() {
  const snap = await getDoc(restDocRef);
  if (snap.exists() && snap.data().stockMode) {
    currentStockMode = snap.data().stockMode;
  }
  applyModeUI(currentStockMode);
}
await loadStockMode();

function applyModeUI(mode) {
  const autoBtn   = document.getElementById("modeAutoBtn");
  const manualBtn = document.getElementById("modeManualBtn");
  const dailyBtn  = document.getElementById("applyDailyOutBtn");
  const stockOutLink = document.querySelector('a[href="./stock-out.html"]');

  if (mode === "auto") {
    autoBtn.style.background   = "var(--accent)";
    autoBtn.style.color        = "#fff";
    manualBtn.style.background = "var(--surface2)";
    manualBtn.style.color      = "var(--text2)";
    // Manual buttons hide karo
    if (dailyBtn)     dailyBtn.style.display    = "none";
    if (stockOutLink) stockOutLink.style.display = "none";
  } else {
    manualBtn.style.background = "var(--text)";
    manualBtn.style.color      = "#fff";
    autoBtn.style.background   = "var(--surface2)";
    autoBtn.style.color        = "var(--text2)";
    // Manual buttons show karo
    if (dailyBtn)     dailyBtn.style.display    = "inline-flex";
    if (stockOutLink) stockOutLink.style.display = "inline-flex";
  }
}

document.getElementById("modeAutoBtn").addEventListener("click", async () => {
  if (currentStockMode === "auto") return;
  currentStockMode = "auto";
  await updateDoc(restDocRef, { stockMode: "auto" });
  applyModeUI("auto");
  showToast("Auto mode on — orders will deduct stock automatically ✅");
});

document.getElementById("modeManualBtn").addEventListener("click", async () => {
  if (currentStockMode === "manual") return;
  currentStockMode = "manual";
  await updateDoc(restDocRef, { stockMode: "manual" });
  applyModeUI("manual");
  showToast("Manual mode on — use Daily Stock Out to manage stock ✅");
});

// ── Load units first ──────────────────────────────────────────────────────────
// AFTER
onSnapshot(query(unitsRef, orderBy("createdAt")), (snap) => {
  unitMap = {};
  snap.forEach(d => { unitMap[d.id] = d.data(); });
  if (rawDocs.length) renderStock(rawDocs);
});

onSnapshot(query(rawRef, orderBy("createdAt")), (snap) => {
  rawDocs = snap.docs;
  // Wait a tick so unitMap is populated first
  setTimeout(() => renderStock(rawDocs), 0);
});

// ── Render stock rows ─────────────────────────────────────────────────────────
function renderStock(docs) {
  const list  = document.getElementById("stockList");
  const empty = document.getElementById("stockEmpty");

  // DSO state save karo before clearing

list.querySelectorAll(".stock-row").forEach(el => el.remove());

  const filteredDocs = searchQuery
    ? docs.filter(d => (d.data().name || "").toLowerCase().includes(searchQuery))
    : docs;

  if (!docs.length) {
    empty.style.display = "block";
    empty.querySelector("p").textContent = "No raw materials found";
    empty.querySelector("small").textContent = "Add materials on the Inventory page first";
    return;
  }

  if (!filteredDocs.length) {
    empty.style.display = "block";
    empty.querySelector("p").textContent = "No matches found";
    empty.querySelector("small").textContent = `No material matches "${searchQuery}"`;
    return;
  }
  empty.style.display = "none";

  filteredDocs.forEach(d => {
    const data     = d.data();
    const unit = data.unitId
  ? (unitMap[data.unitId] || { symbol: data.unitSymbol || "", name: data.unitSymbol || "" })
  : { symbol: data.unitSymbol || "", name: data.unitSymbol || "" };
    const qty      = typeof data.stock === "number" ? data.stock : 0;
    const qtyClass = qty <= 0 ? "row-qty qty-zero" : "row-qty";

    const row = document.createElement("div");
    row.className = "stock-row";
    row.innerHTML = `
      <div>
        <div class="row-name">${escHtml(data.name)}</div>
        ${data.description ? `<div class="row-desc">${escHtml(data.description)}</div>` : ""}
      </div>

      <div class="${qtyClass}">
        <span class="qty-val">${formatQty(qty)}</span>
        ${unit.symbol ? `<span class="qty-unit">${escHtml(unit.symbol)}</span>` : ""}
      </div>

      <div>
        <button class="add-qty-btn" data-id="${d.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Stock
        </button>
      </div>

      <div class="dso-cell">
        <input type="checkbox" class="dso-check" data-id="${d.id}" title="Include in Daily Stock Out" />
       <input type="number" class="dso-qty" data-id="${d.id}" placeholder="qty" min="0.001" step="any" inputmode="decimal" onkeydown="if(event.key==='-'||event.key==='+'||event.key==='e')event.preventDefault();" oninput="if(this.value<0)this.value='';" />
      </div>

      <div>
        <button class="row-icon-btn del-btn" data-id="${d.id}" title="Delete material">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>

      <div>
        <button class="row-icon-btn hist-btn" data-id="${d.id}" data-name="${escHtml(data.name)}" title="View history">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 3 12 9 6"/><path d="M21 12H3"/></svg>
        </button>
      </div>
    `;

    row.querySelector(".add-qty-btn").addEventListener("click", () => openAddModal(d.id, data.name, unit));
    row.querySelector(".del-btn").addEventListener("click", () => deleteMaterial(d.id, data.name));
    row.querySelector(".hist-btn").addEventListener("click", () => openHistory(d.id, data.name, qty, unit));
    row.querySelector(".dso-check").addEventListener("change", async (e) => {
  dsoSavedState[d.id] = { ...( dsoSavedState[d.id] || {}), checked: e.target.checked };
  await setDoc(doc(dsoRef, d.id), dsoSavedState[d.id]);
});

row.querySelector(".dso-qty").addEventListener("input", async (e) => {
  const val = e.target.value;
  if (val && parseFloat(val) > 0) {
    row.querySelector(".dso-check").checked = true;
    dsoSavedState[d.id] = { checked: true, qty: val };
  } else {
    dsoSavedState[d.id] = { ...(dsoSavedState[d.id] || {}), qty: val };
  }
  await setDoc(doc(dsoRef, d.id), dsoSavedState[d.id]);
});

    list.appendChild(row);
    // DSO state restore karo
if (dsoSavedState[d.id]) {
  row.querySelector(".dso-check").checked = dsoSavedState[d.id].checked || false;
  row.querySelector(".dso-qty").value = dsoSavedState[d.id].qty || "";
}
  });
}

function formatQty(n) {
  return Number.isInteger(n) ? n : parseFloat(n.toFixed(3));
}

// ── ADD QUANTITY MODAL ────────────────────────────────────────────────────────
let activeRawId   = null;
let activeRawUnit = {};

function openAddModal(rawId, rawName, unit) {
  activeRawId   = rawId;
  activeRawUnit = unit;
  document.getElementById("addQtySubtitle").textContent = `Adding to: ${rawName}`;
  document.getElementById("addQtyAmount").value = "";
  document.getElementById("addQtyNote").value   = "";
  document.getElementById("addQtyOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
  setTimeout(() => document.getElementById("addQtyAmount").focus(), 250);
}

function closeAddModal() {
  document.getElementById("addQtyOverlay").classList.remove("open");
  document.body.style.overflow = "";
  activeRawId = null;
}

document.getElementById("addQtyCancel").addEventListener("click", closeAddModal);
document.getElementById("addQtyOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("addQtyOverlay")) closeAddModal();
});

document.getElementById("addQtyConfirm").addEventListener("click", async () => {
  const amtEl = document.getElementById("addQtyAmount");
  const amt   = parseFloat(amtEl.value);

  if (!Number.isFinite(amt) || amt <= 0) {
    showToast("Enter a valid positive quantity", true);
    amtEl.focus();
    return;
  }

  const btn  = document.getElementById("addQtyConfirm");
  const note = document.getElementById("addQtyNote").value.trim();
  btn.disabled = true;

  try {
    const rawDocRef  = doc(db, "restaurants", restaurantId, "inventory_raw", activeRawId);
    const rawSnap    = await getDoc(rawDocRef);
    const currentQty = rawSnap.exists() && typeof rawSnap.data().stock === "number"
      ? rawSnap.data().stock : 0;
    const newQty = currentQty + amt;

    // Update stock
    await updateDoc(rawDocRef, { stock: newQty });

    // Write to history sub-collection
    const histRef = collection(db, "restaurants", restaurantId, "inventory_raw", activeRawId, "stock_history");
    await addDoc(histRef, {
      type:      "add",
      qty:       amt,
      prevQty:   currentQty,
      newQty:    newQty,
      note:      note || "",
      createdAt: serverTimestamp()
    });

    showToast(`+${formatQty(amt)} added ✅`);
    closeAddModal();
  } catch (err) {
    showToast("Failed: " + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ── DAILY STOCK OUT (bulk, table ke checkboxes se) ─────────────────────────────
document.getElementById("applyDailyOutBtn").addEventListener("click", async () => {
  const checks = document.querySelectorAll(".dso-check:checked");
  if (!checks.length) { showToast("Tick at least one material", true); return; }

  const items = [];
  checks.forEach(cb => {
    const rawId = cb.dataset.id;
    const qtyEl = document.querySelector(`.dso-qty[data-id="${rawId}"]`);
    const qty   = parseFloat(qtyEl?.value);
    if (Number.isFinite(qty) && qty > 0) items.push({ rawId, qty });
  });

  if (!items.length) { showToast("Enter quantity for ticked materials", true); return; }

  const btn = document.getElementById("applyDailyOutBtn");
  btn.disabled = true;
  const origHTML = btn.innerHTML;
  btn.innerHTML = `<span style="font-size:0.8rem;">Processing...</span>`;

  let done = 0;
  let skipped = [];
  try {
    for (const { rawId, qty } of items) {
      const rawDoc     = rawDocs.find(d => d.id === rawId);
      const matName    = rawDoc?.data().name   || "";
      const matUnitId  = rawDoc?.data().unitId || "";
      const unitSymbol = matUnitId ? (unitMap[matUnitId]?.symbol || unitMap[matUnitId]?.name || "") : "";

      const rawDocRef = doc(db, "restaurants", restaurantId, "inventory_raw", rawId);
      let prevStock = 0, newStock = 0;

      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(rawDocRef);
          prevStock = snap.exists() && typeof snap.data().stock === "number" ? snap.data().stock : 0;
          if (qty > prevStock) throw new Error("INSUFFICIENT_STOCK");
          newStock = prevStock - qty;
          tx.update(rawDocRef, { stock: newStock });
        });
      } catch (txErr) {
        if (txErr.message === "INSUFFICIENT_STOCK") {
          skipped.push(`${matName} (only ${formatQty(prevStock)} left)`);
          continue;
        }
        throw txErr;
      }

      // Material ki apni poori history
      const histRef = collection(db, "restaurants", restaurantId, "inventory_raw", rawId, "stock_history");
      await addDoc(histRef, {
        type:      "deduct",
        qty,
        prevQty:   prevStock,
        newQty:    newStock,
        note:      "Daily Stock Out",
        createdAt: serverTimestamp()
      });

      // Stock Out page ke "Recent Removals" feed mein bhi entry
      await addDoc(removalsRef, {
        rawId,
        rawName:    matName,
        qty,
        unitSymbol,
        note:       "Daily Stock Out",
        createdAt:  serverTimestamp()
      });

      done++;
    }

    if (skipped.length) {
      showToast(`${done} updated, skipped: ${skipped.join(", ")}`, true);
    } else {
      showToast(`${done} material${done !== 1 ? "s" : ""} updated ✅`);
    }
  } catch (err) {
    showToast(`Failed after ${done} update${done !== 1 ? "s" : ""}: ` + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
});

// ── DELETE MATERIAL ───────────────────────────────────────────────────────────
async function deleteMaterial(rawId, rawName) {
  if (!confirm(`Delete "${rawName}"? This will also remove its stock history.`)) return;
  try {
    await deleteDoc(doc(db, "restaurants", restaurantId, "inventory_raw", rawId));
    showToast("Material deleted");
  } catch (err) {
    showToast("Delete failed: " + err.message, true);
  }
}

// ── HISTORY DRAWER ────────────────────────────────────────────────────────────
let histUnsubscribe = null;

function openHistory(rawId, rawName, currentQty, unit) {
  document.getElementById("drawerMaterialName").textContent = rawName;
  document.getElementById("drawerQtyVal").textContent = formatQty(currentQty);
  document.getElementById("drawerQtyUnit").textContent = unit.symbol || unit.name || "";
  document.getElementById("histDrawerOverlay").classList.add("open");
  document.body.style.overflow = "hidden";

  // Unsubscribe previous listener
  if (histUnsubscribe) { histUnsubscribe(); histUnsubscribe = null; }

  const histRef = collection(db, "restaurants", restaurantId, "inventory_raw", rawId, "stock_history");
  histUnsubscribe = onSnapshot(query(histRef, orderBy("createdAt", "desc")), (snap) => {
    // Keep qty bar live
    const doc = rawDocs.find(d => d.id === rawId);
    if (doc) {
      const q = typeof doc.data().stock === "number" ? doc.data().stock : 0;
      document.getElementById("drawerQtyVal").textContent = formatQty(q);
    }
    renderHistory(snap.docs);
  });
}

function renderHistory(docs) {
  const body  = document.getElementById("drawerBody");
  const empty = document.getElementById("histEmpty");

  body.querySelectorAll(".hist-entry").forEach(el => el.remove());

  if (!docs.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  docs.forEach(d => {
    const data = d.data();
    const ts   = data.createdAt?.toDate();
    const timeStr = ts ? formatTime(ts) : "—";
    const isAdd  = data.type === "add";

    const entry = document.createElement("div");
    entry.className = "hist-entry";
    entry.innerHTML = `
      <div class="hist-dot-wrap">
        <span class="hist-dot ${isAdd ? "add" : "del"}"></span>
      </div>
      <div class="hist-info">
        <div class="hist-action">
          ${isAdd ? "Added" : "Removed"}
          <span class="hist-qty-change ${isAdd ? "add" : "del"}">
            ${isAdd ? "+" : "-"}${formatQty(Math.abs(data.qty))}
          </span>
          &nbsp;→&nbsp; <span style="color:var(--text2); font-size:0.8rem;">${formatQty(data.newQty)}</span>
        </div>
        ${data.note ? `<div class="hist-note">${escHtml(data.note)}</div>` : ""}
        <div class="hist-time">${timeStr}</div>
      </div>
    `;
    body.appendChild(entry);
  });
}

function closeHistory() {
  document.getElementById("histDrawerOverlay").classList.remove("open");
  document.body.style.overflow = "";
  if (histUnsubscribe) { histUnsubscribe(); histUnsubscribe = null; }
}

document.getElementById("drawerClose").addEventListener("click", closeHistory);
document.getElementById("histDrawerOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("histDrawerOverlay")) closeHistory();
});

// ── Time formatter ────────────────────────────────────────────────────────────
function formatTime(date) {
  const now   = new Date();
  const diff  = Math.floor((now - date) / 1000);
  if (diff < 60)  return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}