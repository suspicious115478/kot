import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, getDoc, setDoc, onSnapshot,
  orderBy, query, updateDoc
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
  showToast("Logo saved successfully! ✅");
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
const MAX_FEATURED = 5;
let allItems        = [];     // { id, name, price, image, categoryId, categoryName }
let selectedIds     = new Set();
let searchQuery     = "";
let activeCat       = "all";

// ── Load existing featured items from Firestore ───────────────────────────────
let preloadedFeaturedData = []; // saved snapshot data

async function loadExistingFeatured() {
  if (!restaurantId) return;
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId, "featured", "items"));
    if (snap.exists()) {
      const data = snap.data();
      if (data.featuredItems) {
        data.featuredItems.forEach(id => selectedIds.add(id));
      }
      if (data.featuredItemsData) {
        preloadedFeaturedData = data.featuredItemsData;
      }
    }
  } catch (e) {
    console.warn("Could not load featured items:", e);
  }
}

// ── Load all menu items across all categories ─────────────────────────────────
let categoryUnsubs = [];

function loadAllItems() {
  if (!restaurantId) return;

  onSnapshot(
    query(collection(db, "restaurants", restaurantId, "categories"), orderBy("createdAt", "asc")),
    (catSnap) => {
      // Unsubscribe old
      categoryUnsubs.forEach(u => u());
      categoryUnsubs = [];
      allItems = [];

      const categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      buildCatPills(categories);

      if (!categories.length) {
        renderAllItems();
        return;
      }

      let loadedCats = 0;
      categories.forEach(cat => {
        const unsub = onSnapshot(
          query(
            collection(db, "restaurants", restaurantId, "categories", cat.id, "menu_items"),
            orderBy("createdAt", "desc")
          ),
          (itemSnap) => {
            // Replace this cat's items
            allItems = allItems.filter(i => i.categoryId !== cat.id);
            itemSnap.docs.forEach(d => {
              allItems.push({
                id:           d.id,
                categoryId:   cat.id,
                categoryName: cat.name,
                ...d.data()
              });
            });
            loadedCats++;
            renderAllItems();
          }
        );
        categoryUnsubs.push(unsub);
      });
    }
  );
}

// ── Build category filter pills ───────────────────────────────────────────────
function buildCatPills(categories) {
  const container = document.getElementById("catPills");
  container.innerHTML =
    `<button class="cat-pill ${activeCat === "all" ? "active" : ""}" data-cat="all">All</button>` +
    categories.map(c =>
      `<button class="cat-pill ${activeCat === c.id ? "active" : ""}" data-cat="${c.id}">${c.name}</button>`
    ).join("");

  container.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCat = btn.dataset.cat;
      container.querySelectorAll(".cat-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderAllItems();
    });
  });
}

// ── Render all items (filtered + searched) ────────────────────────────────────
function renderAllItems() {
  const container = document.getElementById("allItemsList");
  const isMaxed   = selectedIds.size >= MAX_FEATURED;

  let items = allItems;

  // Category filter
  if (activeCat !== "all") {
    items = items.filter(i => i.categoryId === activeCat);
  }

  // Search filter
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q));
  }

  if (!items.length) {
    container.innerHTML = `<div class="no-results">🔍 No items found — try a different search</div>`;
    return;
  }

  container.innerHTML = items.map((item, idx) => {
    const isSelected = selectedIds.has(item.id);
    const classes    = [
      "selectable-item",
      isSelected ? "selected" : "",
      (isMaxed && !isSelected) ? "maxed" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${classes}" data-id="${item.id}" style="animation-delay:${idx * 30}ms">
        <div class="star-badge">★</div>
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
          </div>
        </div>
        <span class="item-price-sm">₹${item.price}</span>
      </div>`;
  }).join("");

  // Click events
  container.querySelectorAll(".selectable-item:not(.maxed)").forEach(el => {
    el.addEventListener("click", () => toggleItem(el.dataset.id));
  });
}

// ── Toggle item selection ─────────────────────────────────────────────────────
function toggleItem(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    if (selectedIds.size >= MAX_FEATURED) {
     showToast("You can select up to 5 items only", true);
      return;
    }
    selectedIds.add(id);
  }
  renderAllItems();
  renderFeaturedList();
  updateCounter();
  updateSaveBtn();
}

// ── Render featured list (right panel) ────────────────────────────────────────
function renderFeaturedList() {
  const container = document.getElementById("featuredList");

  if (!selectedIds.size) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⭐</span>
        <span class="empty-title">No items selected</span>
        <span class="empty-hint">Select items from the left — maximum 5</span>
      </div>`;
    return;
  }

  // allItems se milao, nahi mila toh preloaded snapshot use karo
  const selectedItems = [...selectedIds].map(id => {
    return allItems.find(i => i.id === id)
      || preloadedFeaturedData.find(i => i.id === id)
      || null;
  }).filter(Boolean);

  container.innerHTML = selectedItems.map((item, idx) => `
    <div class="featured-item-card" data-id="${item.id}">
      <span class="feat-rank">#${idx + 1}</span>
      <img class="feat-thumb" src="${item.image || ''}" alt="${item.name}" loading="lazy" />
      <div class="feat-info">
        <div class="feat-name">${item.name}</div>
        <div class="feat-cat">${item.categoryName || "—"} · ₹${item.price}</div>
      </div>
      <button class="feat-remove" data-id="${item.id}" title="Remove">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join("");

  container.querySelectorAll(".feat-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleItem(btn.dataset.id);
    });
  });
}

// ── Update slot counter ───────────────────────────────────────────────────────
function updateCounter() {
  document.getElementById("selectedCount").textContent = selectedIds.size;
  for (let i = 0; i < MAX_FEATURED; i++) {
    const slot = document.getElementById(`slot${i}`);
    if (slot) slot.className = `slot${i < selectedIds.size ? " filled" : ""}`;
  }
}

// ── Save button state ─────────────────────────────────────────────────────────
function updateSaveBtn() {
  document.getElementById("saveBtn").disabled = selectedIds.size === 0;
}

// ── Save to Firestore ─────────────────────────────────────────────────────────
document.getElementById("saveBtn").addEventListener("click", async () => {
  if (!restaurantId || !selectedIds.size) return;

  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    // Save featured item IDs + their snapshot data for easy display on customer side
    const featuredItems = [...selectedIds];
    const featuredData  = featuredItems.map(id => {
      const item = allItems.find(i => i.id === id);
      return {
        id:           item.id,
        name:         item.name,
        price:        item.price,
        image:        item.image || "",
        categoryName: item.categoryName || "",
        categoryId:   item.categoryId || ""
      };
    });

    await setDoc(doc(db, "restaurants", restaurantId, "featured", "items"), {
      featuredItems:     featuredItems,
      featuredItemsData: featuredData,
      featuredUpdatedAt: Date.now()
    });
   showToast(`${featuredItems.length} featured items saved successfully! ⭐`);
  } catch (e) {
    showToast("Save failed: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Featured Items`;
    updateSaveBtn();
  }
});

// ── Search input ──────────────────────────────────────────────────────────────
const searchInput  = document.getElementById("searchInput");
const clearSearch  = document.getElementById("clearSearch");

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  clearSearch.style.display = searchQuery ? "flex" : "none";
  renderAllItems();
});

clearSearch.addEventListener("click", () => {
  searchInput.value  = "";
  searchQuery        = "";
  clearSearch.style.display = "none";
  searchInput.focus();
  renderAllItems();
});

// ── Init ──────────────────────────────────────────────────────────────────────
await loadExistingFeatured();
updateCounter();
updateSaveBtn();
renderFeaturedList();
loadAllItems();