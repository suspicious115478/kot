import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, getDoc, onSnapshot, updateDoc, setDoc,
  arrayUnion,
  orderBy, query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo / brand color ────────────────────────────────────────────────────────
function showLogoPreview(src) {
  const preview = document.getElementById("logoPreview");
  const icon    = document.getElementById("logoIcon");
  preview.src = src; preview.style.display = "block"; icon.style.display = "none";
}
document.getElementById("logoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !restaurantId) return;
  showToast("Uploading logo...");
  try {
    const base64 = await compressImage(file, 300);
    await updateDoc(doc(db, "restaurants", restaurantId), { logo: base64 });
    showLogoPreview(base64);
    showToast("Logo saved! ✅");
  } catch (err) { showToast("Failed to save logo: " + err.message, true); }
});
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.logo) showLogoPreview(d.logo);
    if (d.brandColor) {
      const dot = document.getElementById("colorDot");
      if (dot) dot.style.background = d.brandColor;
    }
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let allItems      = [];
let selectedItem  = null;
let searchQuery   = "";
let activeCat     = "all";
let categoryUnsubs = [];
let categoryAvailability = {};  // ← add karo { catId: true/false }

// ── Load all items realtime ───────────────────────────────────────────────────
function loadAllItems() {
  if (!restaurantId) return;

  onSnapshot(
    query(collection(db, "restaurants", restaurantId, "categories"), orderBy("createdAt", "asc")),
    (catSnap) => {
      categoryUnsubs.forEach(u => u());
      categoryUnsubs = [];
      allItems = [];

     const categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
categoryAvailability = {};
categories.forEach(c => { categoryAvailability[c.id] = c.available !== false; });
buildCatPills(categories);

      if (!categories.length) { renderAllItems(); return; }

      categories.forEach(cat => {
        const unsub = onSnapshot(
          query(
            collection(db, "restaurants", restaurantId, "categories", cat.id, "menu_items"),
            orderBy("createdAt", "desc")
          ),
          (itemSnap) => {
            allItems = allItems.filter(i => i.categoryId !== cat.id);
            itemSnap.docs.forEach(d => {
              allItems.push({ id: d.id, categoryId: cat.id, categoryName: cat.name, ...d.data() });
            });
           renderAllItems();
renderActiveDiscounts();
autoRemoveUnavailableDiscounts();  // ← add karo
            if (selectedItem) {
              const refreshed = allItems.find(i => i.id === selectedItem.id && i.categoryId === selectedItem.categoryId);
              if (refreshed) {
                selectedItem = refreshed;
                updateRightPanel();
              }
            }
          }
        );
        categoryUnsubs.push(unsub);
      });
    }
  );
}

// ── Category filter pills ─────────────────────────────────────────────────────
function buildCatPills(categories) {
  const container = document.getElementById("catPills");
  container.innerHTML =
    `<button class="cat-pill ${activeCat === "all" ? "active" : ""}" data-cat="all">All</button>` +
    categories.map(c =>
      `<button class="cat-pill ${activeCat === c.id ? "active" : ""}" data-cat="${c.id}">${c.name}</button>`
    ).join("")
   

  container.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCat = btn.dataset.cat;
      container.querySelectorAll(".cat-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderAllItems();
    });
  });
}

// ── Render all items (left panel) ─────────────────────────────────────────────
function renderAllItems() {
  const container = document.getElementById("allItemsList");

 let items = allItems;
if (activeCat !== "all") items = items.filter(i => i.categoryId === activeCat);
items = items.filter(i => i.available !== false && categoryAvailability[i.categoryId] !== false);
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q));
  }

  if (!items.length) {
    container.innerHTML = `<div class="no-results">🔍 No items found</div>`;
    return;
  }

  container.innerHTML = items.map((item, idx) => {
    const isSelected   = selectedItem && selectedItem.id === item.id && selectedItem.categoryId === item.categoryId;
    const hasDiscount  = item.discountedPrice != null && item.discountedPrice < item.price;
    const pct          = hasDiscount ? Math.round((1 - item.discountedPrice / item.price) * 100) : 0;

    const classes = [
      "selectable-item",
      isSelected ? "selected" : "",
      hasDiscount ? "has-discount" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${classes}" data-id="${item.id}" data-catid="${item.categoryId}" style="animation-delay:${idx * 25}ms">
        <div class="item-check">
          <svg class="check-mark" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1.5,5 4,7.5 8.5,2.5"/>
          </svg>
        </div>
        <img class="item-thumb-sm" src="${item.image || ''}" alt="${item.name}" loading="lazy" />
        <div class="item-info-sm">
          <div class="item-name-sm">${item.name}</div>
          <div class="item-meta-sm">
            <span class="item-cat-sm">${item.categoryName || "—"}</span>
            ${hasDiscount ? `<span class="orig-price-sm">₹${item.price}</span>` : ""}
            ${hasDiscount ? `<span class="disc-badge-sm">-${pct}%</span>` : ""}
          </div>
        </div>
        <span class="item-price-sm">${hasDiscount ? `₹${item.discountedPrice}` : `₹${item.price}`}</span>
      </div>`;
  }).join("");

  container.querySelectorAll(".selectable-item").forEach(el => {
    el.addEventListener("click", () => {
      const id    = el.dataset.id;
      const catId = el.dataset.catid;
      const item  = allItems.find(i => i.id === id && i.categoryId === catId);
      if (!item) return;

      if (selectedItem && selectedItem.id === id && selectedItem.categoryId === catId) {
        selectedItem = null;
      } else {
        selectedItem = item;
      }
      renderAllItems();
      updateRightPanel();
    });
  });
}

// ── Update right panel based on selection ────────────────────────────────────
function updateRightPanel() {
  const previewEl    = document.getElementById("selectionPreview");
  const discInput    = document.getElementById("discountInput");
  const applyBtn     = document.getElementById("applyBtn");
  const removeBtn    = document.getElementById("removeBtn");
  const previewRow   = document.getElementById("discPreviewRow");

  if (!selectedItem) {
    previewEl.className = "no-selection-hint";
    previewEl.innerHTML = `<span class="hint-icon">👆</span> Select an item from the list to apply a discount`;
    discInput.disabled  = true;
    discInput.value     = "";
    applyBtn.disabled   = true;
    removeBtn.classList.remove("visible");
    previewRow.classList.add("hidden");
    return;
  }

  const item = selectedItem;
  const hasDiscount = item.discountedPrice != null && item.discountedPrice < item.price;

  previewEl.className = "selected-item-preview";
  previewEl.innerHTML = `
    <img src="${item.image || ''}" alt="${item.name}" />
    <div style="flex:1; min-width:0;">
      <div class="sel-item-name">${item.name}</div>
      <div class="sel-item-price">Original: ₹${item.price}</div>
    </div>`;

  discInput.disabled = false;
  discInput.value    = hasDiscount ? item.discountedPrice : "";

  if (hasDiscount) {
    removeBtn.classList.add("visible");
  } else {
    removeBtn.classList.remove("visible");
  }

  updateDiscountPreview();
}

// ── Live discount preview ─────────────────────────────────────────────────────
function updateDiscountPreview() {
  const discInput  = document.getElementById("discountInput");
  const previewRow = document.getElementById("discPreviewRow");
  const applyBtn   = document.getElementById("applyBtn");
  const dpOrig     = document.getElementById("dpOrig");
  const dpFinal    = document.getElementById("dpFinal");
  const dpPct      = document.getElementById("dpPct");

  if (!selectedItem) { previewRow.classList.add("hidden"); applyBtn.disabled = true; return; }

  const val = parseFloat(discInput.value);
  const origPrice = selectedItem.price;

  if (!val || val <= 0 || val >= origPrice) {
    previewRow.classList.add("hidden");
    applyBtn.disabled = true;
    return;
  }

  const pct = Math.round((1 - val / origPrice) * 100);
  dpOrig.textContent  = `₹${origPrice}`;
  dpFinal.textContent = `₹${val}`;
  dpPct.textContent   = `-${pct}% off`;
  previewRow.classList.remove("hidden");
  applyBtn.disabled = false;
}

document.getElementById("discountInput").addEventListener("input", updateDiscountPreview);

// ── Helper: restaurant node mein discountedItemIds sync karo ─────────────────
/**
 * Yeh function restaurants/{restaurantId} document mein ek
 * `discountedItemIds` array maintain karta hai.
 *
 * Structure:
 * discountedItemIds: [
 *   {
 *     itemId:          "abc123",
 *     categoryId:      "cat456",
 *     name:            "Paneer Tikka",
 *     price:           299,
 *     discountedPrice: 199,
 *     discountPercent: 33
 *   },
 *   ...
 * ]
 *
 * Koi bhi baaki app sirf yeh ek field read karke saare
 * discounted items ki info instantly paa sakti hai —
 * poora menu traverse karne ki zaroorat nahi.
 */
async function syncDiscountedItemIds(action, itemData) {
  if (!restaurantId) return;

  const restRef = doc(db, "restaurants", restaurantId);

  if (action === "add") {
    // Pehle existing array fetch karo — agar same item pehle se hai toh
    // uski purani entry hata ke nayi entry daalo (price update case)
    const snap     = await getDoc(restRef);
    const existing = snap.exists() ? (snap.data().discountedItemIds || []) : [];
    const filtered = existing.filter(
      i => !(i.itemId === itemData.itemId && i.categoryId === itemData.categoryId)
    );
    filtered.push(itemData);

    await setDoc(restRef, { discountedItemIds: filtered }, { merge: true });

  } else if (action === "remove") {
    // Sirf iss item ki entry hata do
    const snap     = await getDoc(restRef);
    const existing = snap.exists() ? (snap.data().discountedItemIds || []) : [];
    const filtered = existing.filter(
      i => !(i.itemId === itemData.itemId && i.categoryId === itemData.categoryId)
    );

    await updateDoc(restRef, { discountedItemIds: filtered });
  }
}

// ── Apply discount ────────────────────────────────────────────────────────────
document.getElementById("applyBtn").addEventListener("click", async () => {
  if (!selectedItem || !restaurantId) return;

  const val = parseFloat(document.getElementById("discountInput").value);
  if (!val || val <= 0 || val >= selectedItem.price) {
    return showToast("Enter a valid discounted price (less than original)", true);
  }

  const btn = document.getElementById("applyBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  const pct = Math.round((1 - val / selectedItem.price) * 100);

  try {
    // 1️⃣ Menu item update karo (existing behavior)
    await updateDoc(
      doc(db, "restaurants", restaurantId, "categories", selectedItem.categoryId, "menu_items", selectedItem.id),
      {
        discountedPrice:   val,
        discountPercent:   pct,
        discountAppliedAt: Date.now()
      }
    );

    // 2️⃣ Restaurant node mein discountedItemIds sync karo
   await syncDiscountedItemIds("add", {
      itemId:          selectedItem.id,
      categoryId:      selectedItem.categoryId,
      name:            selectedItem.name,
      price:           selectedItem.price,
      discountedPrice: val,
      discountPercent: pct
    });
    
    showToast(`Discount applied! ₹${selectedItem.price} → ₹${val} (-${pct}%) ✅`);
  } catch (e) {
    showToast("Failed to apply discount: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Apply Discount`;
  }
});

// ── Remove discount ───────────────────────────────────────────────────────────
document.getElementById("removeBtn").addEventListener("click", async () => {
  if (!selectedItem || !restaurantId) return;

  const btn = document.getElementById("removeBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Removing...';

  try {
    // 1️⃣ Menu item se discount fields hata do (existing behavior)
    await updateDoc(
      doc(db, "restaurants", restaurantId, "categories", selectedItem.categoryId, "menu_items", selectedItem.id),
      {
        discountedPrice:   null,
        discountPercent:   null,
        discountAppliedAt: null
      }
    );

    // 2️⃣ Restaurant node ke discountedItemIds se yeh item hata do
    await syncDiscountedItemIds("remove", {
      itemId:     selectedItem.id,
      categoryId: selectedItem.categoryId
    });

    showToast("Discount removed — item restored to original price ✅");
    document.getElementById("discountInput").value = "";
  } catch (e) {
    showToast("Failed to remove discount: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      Remove Discount`;
  }
});

// ── Render active discounts (right panel bottom) ──────────────────────────────
function renderActiveDiscounts() {
  const container = document.getElementById("activeDiscList");
  const countEl   = document.getElementById("activeDiscCount");

  const discountedItems = allItems.filter(i => i.discountedPrice != null && i.discountedPrice < i.price);
  countEl.textContent = discountedItems.length;

  if (!discountedItems.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <span class="empty-icon">🏷️</span>
        <span class="empty-title">No active discounts</span>
        <span class="empty-hint">Applied discounts will appear here</span>
      </div>`;
    return;
  }

 container.innerHTML = discountedItems.map(item => `
    <div class="disc-item-card" style="cursor:pointer;" data-id="${item.id}" data-catid="${item.categoryId}">
      <img class="disc-item-thumb" src="${item.image || ''}" alt="${item.name}" loading="lazy" />
      <div class="disc-item-info">
        <div class="disc-item-name">${item.name}</div>
        <div class="disc-item-prices">
          <span class="disc-orig">₹${item.price}</span>
          <span class="disc-final">₹${item.discountedPrice}</span>
          <span class="disc-pct">-${item.discountPercent || Math.round((1 - item.discountedPrice / item.price) * 100)}%</span>
        </div>
      </div>
    </div>
 `).join("");

  container.querySelectorAll(".disc-item-card").forEach(el => {
    el.addEventListener("click", () => {
      const id    = el.dataset.id;
      const catId = el.dataset.catid;
      const item  = allItems.find(i => i.id === id && i.categoryId === catId);
      if (!item) return;
      selectedItem = item;
      renderAllItems();
      updateRightPanel();
      document.querySelector(".discount-form-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
const searchInput = document.getElementById("searchInput");
const clearSearch = document.getElementById("clearSearch");

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  clearSearch.style.display = searchQuery ? "flex" : "none";
  renderAllItems();
});
clearSearch.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  clearSearch.style.display = "none";
  searchInput.focus();
  renderAllItems();
});

async function autoRemoveUnavailableDiscounts() {
  if (!restaurantId) return;
 const toRemove = allItems.filter(i =>
  (i.available === false || categoryAvailability[i.categoryId] === false) &&
  i.discountedPrice != null &&
  i.discountedPrice < i.price
);
  for (const item of toRemove) {
    try {
      await updateDoc(
        doc(db, "restaurants", restaurantId, "categories", item.categoryId, "menu_items", item.id),
        { discountedPrice: null, discountPercent: null, discountAppliedAt: null }
      );
      await syncDiscountedItemIds("remove", { itemId: item.id, categoryId: item.categoryId });
    } catch (e) {
      console.warn("Auto-remove discount failed:", item.name, e.message);
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadAllItems();

// ── Ad discount % ─────────────────────────────────────────────────────────────
async function loadAdDiscount() {
  if (!restaurantId) return;
  const snap = await getDoc(doc(db, "restaurants", restaurantId));
  if (snap.exists() && snap.data().discount_p_ad != null)
    document.getElementById("adDiscInput").value = snap.data().discount_p_ad;
}

document.getElementById("saveAdDiscBtn").addEventListener("click", async () => {
  const val    = parseInt(document.getElementById("adDiscInput").value);
  const status = document.getElementById("adDiscStatus");
  if (!val || val < 1 || val > 100) {
    status.style.color = "#e53935";
    status.textContent = "Please enter a value between 1 and 100";
    return;
  }
  const btn = document.getElementById("saveAdDiscBtn");
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    await updateDoc(doc(db, "restaurants", restaurantId), { discount_p_ad: val });
    status.style.color = "#2e7d32";
   status.textContent = `Saved — ${val}% will appear in ads ✅`;
  } catch (e) {
    status.style.color = "#e53935";
    status.textContent = "Failed: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Save";
  }
});

loadAdDiscount();