import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast
} from "./firebase.js";

import {
  collection, doc, addDoc, deleteDoc, updateDoc, getDoc,
  onSnapshot, serverTimestamp, query, orderBy, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Firestore refs ─────────────────────────────────────────────────────────────
// prepared_stocks: { menuItemId, menuItemName, menuItemPrice, categoryName, unitId, unitSymbol, stock, createdAt }
const prepRef   = collection(db, "restaurants", restaurantId, "prepared_stocks");
const unitsRef  = collection(db, "restaurants", restaurantId, "inventory_units");
const catsRef = collection(db, "restaurants", restaurantId, "categories");

// ── Local state ───────────────────────────────────────────────────────────────
let unitMap      = {};  // unitId → { name, symbol }
let prepDocs     = [];  // current prepared_stocks docs
let addedItemIds = new Set(); // menuItemIds already in prepared_stocks
let allMenuItems = [];  // for search
let categoryMap  = {};  // catId → name

// ── Load units ────────────────────────────────────────────────────────────────
onSnapshot(query(unitsRef, orderBy("createdAt")), snap => {
  unitMap = {};
  snap.forEach(d => { unitMap[d.id] = d.data(); });
});

// ── Load categories ───────────────────────────────────────────────────────────
onSnapshot(catsRef, snap => {
  categoryMap = {};
  snap.forEach(d => { categoryMap[d.id] = d.data().name || d.data().title || ""; });
});

// ── Load all menu items for search ────────────────────────────────────────────
onSnapshot(query(catsRef, orderBy("createdAt", "asc")), catSnap => {
  categoryMap = {};
  catSnap.forEach(d => { categoryMap[d.id] = d.data().name || ""; });

  // Har category ke menu_items load karo
  catSnap.docs.forEach(catDoc => {
    onSnapshot(
      query(
        collection(db, "restaurants", restaurantId, "categories", catDoc.id, "menu_items"),
        orderBy("createdAt", "desc")
      ),
      itemSnap => {
        // Pehle is category ke purane items hata do
        allMenuItems = allMenuItems.filter(i => i.categoryId !== catDoc.id);
        // Naye add karo
        itemSnap.docs.forEach(d => {
          allMenuItems.push({ id: d.id, ...d.data() });
        });
      }
    );
  });
});

// ── Live listener: prepared stocks ────────────────────────────────────────────
onSnapshot(query(prepRef, orderBy("createdAt")), snap => {
  prepDocs = snap.docs;
  addedItemIds = new Set(snap.docs.map(d => d.data().menuItemId));
  renderPrepList(snap.docs);
  // Refresh dropdown if open
  const dropdown = document.getElementById("searchDropdown");
  if (dropdown.style.display !== "none") {
    triggerSearch(document.getElementById("menuSearchInput").value.trim());
  }
});

// ── Render prepared stocks list ───────────────────────────────────────────────
function renderPrepList(docs) {
  const list  = document.getElementById("psList");
  const empty = document.getElementById("psEmpty");

  list.querySelectorAll(".ps-row").forEach(el => el.remove());

  if (!docs.length) {
    empty.style.display = "flex";
    empty.style.flexDirection = "column";
    empty.style.alignItems = "center";
    return;
  }
  empty.style.display = "none";

  docs.forEach(d => {
    const data    = d.data();
    const qty     = typeof data.stock === "number" ? data.stock : 0;
    const unit    = unitMap[data.unitId] || { symbol: data.unitSymbol || "", name: data.unitSymbol || "" };
    const qtyZero = qty <= 0;

    const row = document.createElement("div");
    row.className = "ps-row";

    // Price display
    const priceStr = data.menuItemPrice != null
      ? `₹${Number(data.menuItemPrice).toFixed(0)}`
      : "";

    // Image / emoji avatar
    const avatarInner = data.menuItemImage
      ? `<img src="${escHtml(data.menuItemImage)}" alt="" />`
      : `<span>${data.menuItemEmoji || "🍽️"}</span>`;

    row.innerHTML = `
      <!-- Col 1: Item info -->
      <div class="row-item-info">
        <div class="row-item-avatar">${avatarInner}</div>
        <div style="min-width:0;">
          <div class="row-item-name">${escHtml(data.menuItemName)}</div>
          ${priceStr ? `<div class="row-item-price">${priceStr}</div>` : ""}
        </div>
      </div>

      <!-- Col 2: Category -->
      <div>
        <span class="row-category-badge">${escHtml(data.categoryName || "—")}</span>
      </div>

      <!-- Col 3: Qty -->
      <div class="row-qty-wrap">
        <span class="row-qty-val ${qtyZero ? "row-qty-zero" : ""}">${formatQty(qty)}</span>
      </div>

      <!-- Col 4: Unit -->
      <div>
        ${unit.symbol ? `<span class="row-unit-badge">${escHtml(unit.symbol)}</span>` : `<span style="color:var(--muted);font-size:0.75rem;">—</span>`}
      </div>

      <!-- Col 5: Add Stock btn -->
      <div>
        <button class="ps-add-btn" data-id="${d.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Stock
        </button>
      </div>

      <!-- Col 6: Delete -->
      <div>
        <button class="ps-del-btn" data-id="${d.id}" data-name="${escHtml(data.menuItemName)}" title="Remove from prepared stocks">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `;

    row.querySelector(".ps-add-btn").addEventListener("click", () => {
      openAddModal(d.id, data.menuItemName, unit);
    });
    row.querySelector(".ps-del-btn").addEventListener("click", () => {
      deletePrepItem(d.id, data.menuItemName);
    });

    list.appendChild(row);
  });
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
const searchInput    = document.getElementById("menuSearchInput");
const searchClear    = document.getElementById("searchClear");
const searchDropdown = document.getElementById("searchDropdown");
const searchResults  = document.getElementById("searchResults");

let searchTimer = null;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  searchClear.style.display = q ? "flex" : "none";
  clearTimeout(searchTimer);
  if (!q) { hideDropdown(); return; }
  searchTimer = setTimeout(() => triggerSearch(q), 180);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.style.display = "none";
  hideDropdown();
  searchInput.focus();
});

// Close dropdown on outside click
document.addEventListener("click", e => {
  if (!e.target.closest(".search-card")) hideDropdown();
});

function hideDropdown() {
  searchDropdown.style.display = "none";
  searchResults.innerHTML = "";
}

function triggerSearch(q) {
  if (!q) { hideDropdown(); return; }

  const lower = q.toLowerCase();
  const matched = allMenuItems.filter(item =>
    (item.name || item.title || "").toLowerCase().includes(lower)
  ).slice(0, 8);

  renderSearchResults(matched);
  searchDropdown.style.display = "block";
}

function renderSearchResults(items) {
  searchResults.innerHTML = "";

  if (!items.length) {
    searchResults.innerHTML = `<div class="search-no-results">No menu items found for this search</div>`;
    return;
  }

  items.forEach(item => {
    const isAdded = addedItemIds.has(item.id);
    const itemName = item.name || item.title || "Unnamed";
    const catName  = categoryMap[item.categoryId] || item.categoryName || "";
    const price    = item.price != null ? `₹${Number(item.price).toFixed(0)}` : "";

    const el = document.createElement("div");
    el.className = `search-result-item${isAdded ? " already-added" : ""}`;

    const avatarInner = item.image
      ? `<img src="${escHtml(item.image)}" alt="" />`
      : `<span>${item.emoji || "🍽️"}</span>`;

    el.innerHTML = `
      <div class="result-avatar">${avatarInner}</div>
      <div class="result-info">
        <div class="result-name">${escHtml(itemName)}</div>
        <div class="result-meta">${[catName, price].filter(Boolean).join(" • ")}</div>
      </div>
      ${isAdded
        ? `<div class="result-added-badge">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
             Added
           </div>`
        : `<button class="result-add-btn" data-id="${item.id}">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
             Add
           </button>`
      }
    `;

    if (!isAdded) {
      el.querySelector(".result-add-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        addMenuItemToPrepared(item);
      });
    }

    searchResults.appendChild(el);
  });
}

// ── Add menu item to prepared stocks ─────────────────────────────────────────
async function addMenuItemToPrepared(item) {
  if (addedItemIds.has(item.id)) {
    showToast("Already in prepared stocks", true);
    return;
  }
  openUnitSelectModal(item);
}

// ── UNIT SELECT MODAL ─────────────────────────────────────────────
let pendingItem = null;

function openUnitSelectModal(item) {
  pendingItem = item;
  document.getElementById("unitModalItemName").textContent = item.name || item.title || "Unnamed";

  const unitList = document.getElementById("unitSelectList");
  unitList.innerHTML = "";

  const units = Object.entries(unitMap);
  if (!units.length) {
    unitList.innerHTML = `<div style="padding:20px;text-align:center;font-size:0.78rem;color:var(--muted);">No units found — add units in Inventory first</div>`;
  } else {
    units.forEach(([id, u]) => {
      const btn = document.createElement("button");
      btn.className = "unit-select-btn";
      btn.innerHTML = `
        <span class="unit-select-name">${escHtml(u.name)}</span>
        ${u.symbol ? `<span class="unit-select-symbol">${escHtml(u.symbol)}</span>` : ""}
      `;
      btn.addEventListener("click", () => confirmAddWithUnit(id, u));
      unitList.appendChild(btn);
    });
  }

  const noUnitBtn = document.createElement("button");
  noUnitBtn.className = "unit-select-btn unit-select-none";
  noUnitBtn.innerHTML = `<span class="unit-select-name" style="color:var(--muted);">No unit (count only)</span>`;
  noUnitBtn.addEventListener("click", () => confirmAddWithUnit("", { name: "", symbol: "" }));
  unitList.appendChild(noUnitBtn);

  document.getElementById("unitSelectOverlay").classList.add("open");
}

function closeUnitSelectModal() {
  document.getElementById("unitSelectOverlay").classList.remove("open");
  pendingItem = null;
}

document.getElementById("unitSelectCancel").addEventListener("click", closeUnitSelectModal);
document.getElementById("unitSelectOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("unitSelectOverlay")) closeUnitSelectModal();
});

async function confirmAddWithUnit(unitId, unitData) {
  if (!pendingItem) return;
  const item = pendingItem;
  closeUnitSelectModal();

  const itemName   = item.name || item.title || "Unnamed";
  const catName    = categoryMap[item.categoryId] || item.categoryName || "";
  const unitSymbol = unitData.symbol || unitData.name || "";

  try {
    await addDoc(prepRef, {
      menuItemId:    item.id,
      menuItemName:  itemName,
      menuItemPrice: item.price ?? null,
      menuItemImage: item.image || "",
      menuItemEmoji: item.emoji || "",
      categoryId:    item.categoryId || "",
      categoryName:  catName,
      unitId,
      unitSymbol,
      stock:         0,
      createdAt:     serverTimestamp()
    });
    showToast(`${itemName} added ✅`);
    hideDropdown();
    searchInput.value = "";  
    searchClear.style.display = "none";
  } catch (err) {
    showToast("Failed: " + err.message, true);
  }
}

// ── DELETE prepared stock entry ───────────────────────────────────────────────
async function deletePrepItem(prepId, itemName) {
  if (!confirm(`Remove "${itemName}" from prepared stocks?`)) return;
  try {
    await deleteDoc(doc(db, "restaurants", restaurantId, "prepared_stocks", prepId));
    showToast(`${itemName} removed`);
  } catch (err) {
    showToast("Delete failed: " + err.message, true);
  }
}

// ── ADD QTY MODAL ─────────────────────────────────────────────────────────────
let activePrepId   = null;
let activePrepUnit = {};

function openAddModal(prepId, itemName, unit) {
  activePrepId   = prepId;
  activePrepUnit = unit;

  document.getElementById("modalItemName").textContent = itemName;

  const unitBadge = document.getElementById("modalUnitBadge");
  if (unit.symbol) {
    unitBadge.textContent  = unit.symbol;
    unitBadge.style.display = "inline-flex";
  } else {
    unitBadge.style.display = "none";
  }

  document.getElementById("addQtyAmount").value = "";
  document.getElementById("addQtyNote").value   = "";
  document.getElementById("addQtyOverlay").classList.add("open");
  setTimeout(() => document.getElementById("addQtyAmount").focus(), 240);
}

function closeAddModal() {
  document.getElementById("addQtyOverlay").classList.remove("open");
  activePrepId = null;
}

document.getElementById("addQtyCancel").addEventListener("click", closeAddModal);
document.getElementById("addQtyOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("addQtyOverlay")) closeAddModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("addQtyOverlay").classList.contains("open")) closeAddModal();
});

document.getElementById("addQtyConfirm").addEventListener("click", async () => {
  if (!activePrepId) return;

  const amtEl = document.getElementById("addQtyAmount");
  const amt   = parseFloat(amtEl.value);

  if (!amt || amt <= 0) {
    showToast("Enter a valid quantity", true);
    amtEl.focus();
    return;
  }

  const btn  = document.getElementById("addQtyConfirm");
  const note = document.getElementById("addQtyNote").value.trim();
  btn.disabled = true;

  try {
    const prepDocRef = doc(db, "restaurants", restaurantId, "prepared_stocks", activePrepId);
    const snap       = await getDoc(prepDocRef);
    const currentQty = snap.exists() && typeof snap.data().stock === "number"
      ? snap.data().stock : 0;
    const newQty = currentQty + amt;

    await updateDoc(prepDocRef, { stock: newQty });

    // Write history sub-collection
    const histRef = collection(db, "restaurants", restaurantId, "prepared_stocks", activePrepId, "stock_history");
    await addDoc(histRef, {
      type:      "add",
      qty:       amt,
      prevQty:   currentQty,
      newQty,
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

// ── Enter key on qty input submits modal ──────────────────────────────────────
document.getElementById("addQtyAmount").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("addQtyConfirm").click();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatQty(n) {
  return Number.isInteger(n) ? n : parseFloat(n.toFixed(3));
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}