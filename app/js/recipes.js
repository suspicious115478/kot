import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, setDoc, getDoc, deleteDoc,
  onSnapshot, orderBy, query, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";
if (restaurantId) {
  
}

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
  } catch (err) { showToast("Failed: " + err.message, true); }
});
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.logo) showLogoPreview(data.logo);
    if (data.brandColor) {
      const dot = document.getElementById("colorDot");
      if (dot) dot.style.background = data.brandColor;
    }
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let allMenuItems   = [];   // { id, name, price, image, categoryId, categoryName }
let allRawMats     = [];   // { id, name, unitId, description }
let unitMap        = {};   // unitId → { name, symbol }
let savedRecipes   = {};   // menuItemId → recipe doc data
let activeCatFilter = "all";
let activeItemId    = null;
let ingredients     = [];  // [{ rawId, rawName, qty, unitSymbol, unitName }]
let categoryMap     = {};  // catId → name

// ── Load units ────────────────────────────────────────────────────────────────
onSnapshot(
  query(collection(db, "restaurants", restaurantId, "inventory_units"), orderBy("createdAt")),
  (snap) => {
    unitMap = {};
    snap.forEach(d => { unitMap[d.id] = d.data(); });
    renderIngredientRows();
  }
);

// ── Load raw materials ────────────────────────────────────────────────────────
onSnapshot(
  query(collection(db, "restaurants", restaurantId, "inventory_raw"), orderBy("createdAt")),
  (snap) => {
    allRawMats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const warn = document.getElementById("noRawWarning");
    if (warn) warn.style.display = allRawMats.length === 0 ? "flex" : "none";
  }
);

// ── Load all menu items across all categories ─────────────────────────────────
let catUnsubscribers = [];

onSnapshot(
  query(collection(db, "restaurants", restaurantId, "categories"), orderBy("createdAt", "asc")),
  (catSnap) => {
    catUnsubscribers.forEach(u => u());
    catUnsubscribers = [];
    allMenuItems = [];
    categoryMap  = {};

    const cats = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    cats.forEach(cat => { categoryMap[cat.id] = cat.name; });

    buildCatFilter(cats);

    if (!cats.length) {
      renderMenuItems();
      return;
    }

    cats.forEach(cat => {
      const unsub = onSnapshot(
        query(
          collection(db, "restaurants", restaurantId, "categories", cat.id, "menu_items"),
          orderBy("createdAt", "desc")
        ),
        (itemSnap) => {
          allMenuItems = allMenuItems.filter(i => i.categoryId !== cat.id);
          itemSnap.docs.forEach(d => {
            allMenuItems.push({ id: d.id, ...d.data(), categoryName: cat.name });
          });
          renderMenuItems();
        }
      );
      catUnsubscribers.push(unsub);
    });
  }
);

// ── Load saved recipes (realtime) ─────────────────────────────────────────────
onSnapshot(
  collection(db, "restaurants", restaurantId, "recipes"),
  (snap) => {
    savedRecipes = {};
    snap.forEach(d => { savedRecipes[d.id] = d.data(); });
    renderMenuItems();
    if (activeItemId) {
      const hasSaved = !!savedRecipes[activeItemId];
      document.getElementById("recipeSavedBadge").style.display = hasSaved ? "flex" : "none";
      document.getElementById("clearRecipeBtn").style.display   = hasSaved ? "flex" : "none";
    }
  }
);

// ── Build category filter pills ───────────────────────────────────────────────
function buildCatFilter(cats) {
  const container = document.getElementById("catFilter");
  const allActive = activeCatFilter === "all" ? "active" : "";
  container.innerHTML = `<button class="cat-pill ${allActive}" data-cat="all">All</button>`;
  cats.forEach(cat => {
    const active = activeCatFilter === cat.id ? "active" : "";
    container.innerHTML += `<button class="cat-pill ${active}" data-cat="${cat.id}">${cat.name}</button>`;
  });
  container.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCatFilter = btn.dataset.cat;
      container.querySelectorAll(".cat-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderMenuItems();
    });
  });
}

// ── Render menu items list ────────────────────────────────────────────────────
// ── Render menu items GRID ────────────────────────────────────────────────────
function renderMenuItems() {
  const list      = document.getElementById("menuItemsList");
  const countEl   = document.getElementById("menuItemCount");
  const searchVal = document.getElementById("itemSearch").value.toLowerCase();

  let filtered = allMenuItems;
  if (activeCatFilter !== "all") filtered = filtered.filter(i => i.categoryId === activeCatFilter);
  if (searchVal) filtered = filtered.filter(i => i.name.toLowerCase().includes(searchVal));

  countEl.textContent = `${filtered.length} item${filtered.length !== 1 ? "s" : ""}`;

  if (!filtered.length) {
    list.innerHTML = `<div class="list-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg>No items found</div>`;
    return;
  }

  list.innerHTML = "";
  filtered.forEach(item => {
    const hasRecipe = !!savedRecipes[item.id];
    const isActive  = item.id === activeItemId;

    const card = document.createElement("div");
    card.className = "menu-item-card" + (isActive ? " active" : "");
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="mic-img-wrap">
        <img class="mic-img" src="${item.image || ''}" alt="${escHtml(item.name)}" loading="lazy" />
        ${hasRecipe ? '<span class="mic-dot" title="Recipe saved"></span>' : ''}
      </div>
      <div class="mic-name">${escHtml(item.name)}</div>
    `;
    card.addEventListener("click", () => selectItem(item));
    list.appendChild(card);
  });
}

// ── Select a menu item ────────────────────────────────────────────────────────
function selectItem(item) {
  activeItemId = item.id;
  ingredients  = [];

 document.querySelectorAll(".menu-item-card").forEach(r => {
    r.classList.toggle("active", r.dataset.id === item.id);
  });

  document.getElementById("editorItemImg").src   = item.image  || "";
  document.getElementById("editorItemName").textContent  = item.name;
  document.getElementById("editorItemCat").textContent   = item.categoryName || "";
  document.getElementById("editorItemPrice").textContent = `₹${item.price}`;

  const saved = savedRecipes[item.id];
  if (saved) {
    document.getElementById("recipeYield").value  = saved.yield || 1;
    document.getElementById("recipeNotes").value  = saved.notes || "";
    ingredients = (saved.ingredients || []).map(ing => ({ ...ing }));
    document.getElementById("recipeSavedBadge").style.display = "flex";
    document.getElementById("clearRecipeBtn").style.display   = "flex";
    document.getElementById("saveRecipeBtn").innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Update Recipe`;
  } else {
    document.getElementById("recipeYield").value  = 1;
    document.getElementById("recipeNotes").value  = "";
    ingredients = [];
    document.getElementById("recipeSavedBadge").style.display = "none";
    document.getElementById("clearRecipeBtn").style.display   = "none";
    document.getElementById("saveRecipeBtn").innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Recipe`;
  }

  document.getElementById("rawSearch").value = "";
  document.getElementById("rawDropdown").classList.remove("open");

  document.getElementById("editorEmpty").style.display   = "none";
  document.getElementById("editorContent").style.display = "block";

  renderIngredientRows();
}

// ── Raw material search dropdown ──────────────────────────────────────────────
const rawSearchInput = document.getElementById("rawSearch");
const rawDropdown    = document.getElementById("rawDropdown");

rawSearchInput.addEventListener("input", () => {
  const q = rawSearchInput.value.toLowerCase().trim();
  if (!q) { rawDropdown.classList.remove("open"); return; }

  const matches = allRawMats.filter(r => r.name.toLowerCase().includes(q));
  if (!matches.length) {
    rawDropdown.innerHTML = `<div class="raw-dropdown-empty">No raw materials found</div>`;
  } else {
    rawDropdown.innerHTML = matches.map(r => {
      const unit    = r.unitId ? (unitMap[r.unitId] || {}) : {};
      const unitStr = unit.symbol || unit.name || "—";
      const alreadyAdded = ingredients.some(i => i.rawId === r.id);
      return `
        <div class="raw-dropdown-item ${alreadyAdded ? "added" : ""}" data-id="${r.id}">
          <span class="raw-dropdown-name">${escHtml(r.name)}</span>
          <span class="raw-dropdown-unit">${escHtml(unitStr)}</span>
        </div>`;
    }).join("");
    rawDropdown.querySelectorAll(".raw-dropdown-item:not(.added)").forEach(el => {
      el.addEventListener("click", () => addIngredient(el.dataset.id));
    });
  }
  rawDropdown.classList.add("open");
});

document.addEventListener("click", (e) => {
  if (!rawSearchInput.contains(e.target) && !rawDropdown.contains(e.target)) {
    rawDropdown.classList.remove("open");
  }
});

rawSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { rawDropdown.classList.remove("open"); rawSearchInput.blur(); }
});

// ── Add ingredient ────────────────────────────────────────────────────────────
function addIngredient(rawId) {
  const raw = allRawMats.find(r => r.id === rawId);
  if (!raw) return;

  const unit = raw.unitId ? (unitMap[raw.unitId] || {}) : {};
  ingredients.push({
    rawId:      raw.id,
    rawName:    raw.name,
    qty:        "",
    unitId:     raw.unitId || "",
    unitName:   unit.name   || "",
    unitSymbol: unit.symbol || ""
  });

  rawSearchInput.value = "";
  rawDropdown.classList.remove("open");
  renderIngredientRows();

  setTimeout(() => {
    const inputs = document.querySelectorAll(".ing-qty-input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 50);
}

// ── Render ingredient rows ────────────────────────────────────────────────────
function renderIngredientRows() {
  const container = document.getElementById("ingredientRows");
  const emptyEl   = document.getElementById("ingredientEmpty");
  if (!container) return;

  container.innerHTML = "";

  if (!ingredients.length) {
    container.appendChild(emptyEl || createEmptyEl());
    if (emptyEl) emptyEl.style.display = "flex";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  ingredients.forEach((ing, idx) => {
    if (ing.unitId && unitMap[ing.unitId]) {
      ing.unitName   = unitMap[ing.unitId].name   || "";
      ing.unitSymbol = unitMap[ing.unitId].symbol || "";
    }
    const displayUnit = ing.unitSymbol || ing.unitName || "—";

    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.innerHTML = `
      <div>
        <div class="ing-name">${escHtml(ing.rawName)}</div>
      </div>
      <input
        type="number"
        class="ing-qty-input"
        value="${ing.qty}"
        placeholder="0"
        min="0"
        step="any"
        data-idx="${idx}"
      />
      <div class="ing-unit-label">${escHtml(displayUnit)}</div>
      <button class="ing-del-btn" data-idx="${idx}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;

    row.querySelector(".ing-qty-input").addEventListener("input", (e) => {
      ingredients[idx].qty = e.target.value;
    });
    row.querySelector(".ing-del-btn").addEventListener("click", () => {
      ingredients.splice(idx, 1);
      renderIngredientRows();
    });

    container.appendChild(row);
  });
}

function createEmptyEl() {
  const el = document.createElement("div");
  el.id = "ingredientEmpty";
  el.className = "ingredient-empty";
  el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Search and add raw materials above`;
  return el;
}

// ── Save recipe ───────────────────────────────────────────────────────────────
document.getElementById("saveRecipeBtn").addEventListener("click", async () => {
  if (!activeItemId) return;

  for (const ing of ingredients) {
    if (!ing.qty || Number(ing.qty) <= 0) {
      showToast(`Enter quantity for "${ing.rawName}"`, true);
      return;
    }
  }

  const btn = document.getElementById("saveRecipeBtn");
  btn.disabled = true;
  const origHTML = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span> Saving...`;

  try {
    const yieldVal = parseInt(document.getElementById("recipeYield").value) || 1;
    const notes    = document.getElementById("recipeNotes").value.trim();
    const activeItem = allMenuItems.find(i => i.id === activeItemId);

    const recipeData = {
      menuItemId:   activeItemId,
      menuItemName: activeItem?.name || "",
      categoryId:   activeItem?.categoryId || "",
      categoryName: activeItem?.categoryName || "",
      yield:        yieldVal,
      notes,
      ingredients:  ingredients.map(ing => ({
        rawId:      ing.rawId,
        rawName:    ing.rawName,
        qty:        parseFloat(ing.qty),
        unitId:     ing.unitId || "",
        unitName:   ing.unitName || "",
        unitSymbol: ing.unitSymbol || ""
      })),
      updatedAt: Date.now()
    };

    await setDoc(
      doc(db, "restaurants", restaurantId, "recipes", activeItemId),
      recipeData
    );

    showToast("Recipe saved! 🍳");
    document.getElementById("recipeSavedBadge").style.display = "flex";
    document.getElementById("clearRecipeBtn").style.display   = "flex";
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Update Recipe`;
  } catch (err) {
    showToast("Failed: " + err.message, true);
    btn.innerHTML = origHTML;
  } finally {
    btn.disabled = false;
  }
});

// ── Delete recipe ─────────────────────────────────────────────────────────────
document.getElementById("clearRecipeBtn").addEventListener("click", async () => {
  if (!activeItemId) return;
  if (!confirm("Delete this recipe?")) return;

  try {
    await deleteDoc(doc(db, "restaurants", restaurantId, "recipes", activeItemId));
    ingredients = [];
    document.getElementById("recipeYield").value  = 1;
    document.getElementById("recipeNotes").value  = "";
    document.getElementById("recipeSavedBadge").style.display = "none";
    document.getElementById("clearRecipeBtn").style.display   = "none";
    document.getElementById("copyRecipeBtn").style.display    = "none";
    document.getElementById("saveRecipeBtn").innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Recipe`;
    renderIngredientRows();
    showToast("Recipe deleted");
  } catch (err) {
    showToast("Failed: " + err.message, true);
  }
});

// ── Item search ───────────────────────────────────────────────────────────────
document.getElementById("itemSearch").addEventListener("input", renderMenuItems);

// ═══════════════════════════════════════════════════════════════════════════════
// ── COPY RECIPE FEATURE ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

let copySourceItemId = null;
let copyTargetItemId = null;

const copyModal        = document.getElementById("copyModal");
const copyFromSearch   = document.getElementById("copyFromSearch");
const copyFromDropdown = document.getElementById("copyFromDropdown");
const copyToSearch     = document.getElementById("copyToSearch");
const copyToDropdown   = document.getElementById("copyToDropdown");
const copyConfirmBtn   = document.getElementById("copyConfirmBtn");

// Open modal — fully blank, user selects both FROM and TO
document.getElementById("copyRecipeBtn").addEventListener("click", () => {
  copySourceItemId = null;
  copyTargetItemId = null;

  // Reset FROM
  copyFromSearch.value = "";
  copyFromSearch.closest('.copy-to-search-wrap').style.display = "";
  copyFromDropdown.classList.remove("open");
  copyFromDropdown.innerHTML = "";
  document.getElementById("copyFromSelected").style.display  = "none";
  document.getElementById("copyFromIngCount").textContent    = "";
  document.getElementById("copyFromNoRecipeWarn").style.display = "none";

  // Reset TO
  copyToSearch.value = "";
  copyToSearch.closest('.copy-to-search-wrap').style.display = "";
  copyToDropdown.classList.remove("open");
  copyToDropdown.innerHTML = "";
  document.getElementById("copyToSelected").style.display      = "none";
  document.getElementById("copyToOverwriteWarn").style.display = "none";

  copyConfirmBtn.disabled = true;
  copyModal.style.display = "flex";
  setTimeout(() => copyFromSearch.focus(), 120);
});

// Close modal
function closeCopyModal() {
  copyModal.style.display = "none";
}
document.getElementById("copyModalClose").addEventListener("click", closeCopyModal);
document.getElementById("copyCancelBtn").addEventListener("click", closeCopyModal);
copyModal.addEventListener("click", (e) => {
  if (e.target === copyModal) closeCopyModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && copyModal.style.display !== "none") closeCopyModal();
});

// ── FROM search ───────────────────────────────────────────────────────────────
copyFromSearch.addEventListener("input", () => {
  const q = copyFromSearch.value.toLowerCase().trim();
  if (!q) { copyFromDropdown.classList.remove("open"); return; }

  // Only show items that have a saved recipe
  const candidates = allMenuItems.filter(i =>
    savedRecipes[i.id] && i.name.toLowerCase().includes(q)
  );

  if (!candidates.length) {
    copyFromDropdown.innerHTML = `<div class="copy-to-dropdown-empty">No items with a saved recipe found</div>`;
  } else {
    copyFromDropdown.innerHTML = candidates.map(item => {
      const ingCount = savedRecipes[item.id]?.ingredients?.length || 0;
      return `
        <div class="copy-to-dropdown-item" data-id="${item.id}">
          <img src="${item.image || ''}" alt="" loading="lazy" />
          <div class="copy-to-dropdown-item-info">
            <div class="copy-to-dropdown-item-name">${escHtml(item.name)}</div>
            <div class="copy-to-dropdown-item-cat">${escHtml(item.categoryName || '')}</div>
          </div>
          <span class="has-recipe-dot" title="${ingCount} ingredients"></span>
        </div>`;
    }).join("");
    copyFromDropdown.querySelectorAll(".copy-to-dropdown-item").forEach(el => {
      el.addEventListener("click", () => selectCopySource(el.dataset.id));
    });
  }
  copyFromDropdown.classList.add("open");
});

document.addEventListener("click", (e) => {
  if (!copyFromSearch.contains(e.target) && !copyFromDropdown.contains(e.target)) {
    copyFromDropdown.classList.remove("open");
  }
});

function selectCopySource(itemId) {
  const item = allMenuItems.find(i => i.id === itemId);
  if (!item) return;

  copySourceItemId = itemId;
  copyFromDropdown.classList.remove("open");
  copyFromSearch.closest('.copy-to-search-wrap').style.display = "none";

  document.getElementById("copyFromImg").src = item.image || "";
  document.getElementById("copyFromName").textContent = item.name;
  document.getElementById("copyFromCat").textContent  = item.categoryName || "";
  document.getElementById("copyFromSelected").style.display = "flex";

  const srcRecipe = savedRecipes[itemId];
  const ingCount  = srcRecipe?.ingredients?.length || 0;
  document.getElementById("copyFromIngCount").textContent =
    ingCount > 0 ? `${ingCount} ingredient${ingCount !== 1 ? "s" : ""}` : "";
  document.getElementById("copyFromNoRecipeWarn").style.display =
    srcRecipe ? "none" : "flex";

  updateCopyConfirmState();
  // Focus TO search next
  if (!copyTargetItemId) setTimeout(() => copyToSearch.focus(), 80);
}

document.getElementById("copyFromClear").addEventListener("click", () => {
  copySourceItemId = null;
  document.getElementById("copyFromSelected").style.display  = "none";
  document.getElementById("copyFromIngCount").textContent    = "";
  document.getElementById("copyFromNoRecipeWarn").style.display = "none";
  copyFromSearch.closest('.copy-to-search-wrap').style.display = "";
copyFromSearch.value = "";
  copyFromSearch.value = "";
  updateCopyConfirmState();
  copyFromSearch.focus();
});

// ── TO search ─────────────────────────────────────────────────────────────────
copyToSearch.addEventListener("input", () => {
  const q = copyToSearch.value.toLowerCase().trim();
  if (!q) { copyToDropdown.classList.remove("open"); return; }

  const candidates = allMenuItems.filter(i =>
    i.id !== copySourceItemId && i.name.toLowerCase().includes(q)
  );

  if (!candidates.length) {
    copyToDropdown.innerHTML = `<div class="copy-to-dropdown-empty">No items found</div>`;
  } else {
    copyToDropdown.innerHTML = candidates.map(item => {
      const hasDot = savedRecipes[item.id]
        ? `<span class="has-recipe-dot" title="Has existing recipe"></span>` : "";
      return `
        <div class="copy-to-dropdown-item" data-id="${item.id}">
          <img src="${item.image || ''}" alt="" loading="lazy" />
          <div class="copy-to-dropdown-item-info">
            <div class="copy-to-dropdown-item-name">${escHtml(item.name)}</div>
            <div class="copy-to-dropdown-item-cat">${escHtml(item.categoryName || '')}</div>
          </div>
          ${hasDot}
        </div>`;
    }).join("");
    copyToDropdown.querySelectorAll(".copy-to-dropdown-item").forEach(el => {
      el.addEventListener("click", () => selectCopyTarget(el.dataset.id));
    });
  }
  copyToDropdown.classList.add("open");
});

document.addEventListener("click", (e) => {
  if (!copyToSearch.contains(e.target) && !copyToDropdown.contains(e.target)) {
    copyToDropdown.classList.remove("open");
  }
});

function selectCopyTarget(itemId) {
  const item = allMenuItems.find(i => i.id === itemId);
  if (!item) return;

  copyTargetItemId = itemId;
  copyToDropdown.classList.remove("open");
  copyToSearch.closest('.copy-to-search-wrap').style.display = "none";

  document.getElementById("copyToImg").src = item.image || "";
  document.getElementById("copyToName").textContent = item.name;
  document.getElementById("copyToCat").textContent  = item.categoryName || "";
  document.getElementById("copyToSelected").style.display = "flex";

  const hasExisting = !!savedRecipes[itemId];
  document.getElementById("copyToOverwriteWarn").style.display = hasExisting ? "flex" : "none";

  updateCopyConfirmState();
}

document.getElementById("copyToClear").addEventListener("click", () => {
  copyTargetItemId = null;
  document.getElementById("copyToSelected").style.display      = "none";
  document.getElementById("copyToOverwriteWarn").style.display = "none";
  copyToSearch.closest('.copy-to-search-wrap').style.display = "";
copyToSearch.value = "";
  copyToSearch.value = "";
  updateCopyConfirmState();
  copyToSearch.focus();
});

function updateCopyConfirmState() {
  const srcOk = copySourceItemId && !!savedRecipes[copySourceItemId];
  copyConfirmBtn.disabled = !(srcOk && copyTargetItemId);
}

// ── Confirm copy ──────────────────────────────────────────────────────────────
copyConfirmBtn.addEventListener("click", async () => {
  if (!copySourceItemId || !copyTargetItemId) return;

  const srcRecipe  = savedRecipes[copySourceItemId];
  if (!srcRecipe) { showToast("Source recipe not found", true); return; }

  const targetItem = allMenuItems.find(i => i.id === copyTargetItemId);
  if (!targetItem) return;

  copyConfirmBtn.disabled = true;
  const origHTML = copyConfirmBtn.innerHTML;
  copyConfirmBtn.innerHTML = `<span class="spinner"></span> Copying...`;

  try {
    const newRecipe = {
      menuItemId:   copyTargetItemId,
      menuItemName: targetItem.name,
      categoryId:   targetItem.categoryId || "",
      categoryName: targetItem.categoryName || "",
      yield:        srcRecipe.yield || 1,
      notes:        srcRecipe.notes || "",
      ingredients:  (srcRecipe.ingredients || []).map(ing => ({ ...ing })),
      updatedAt:    Date.now(),
      copiedFrom:   copySourceItemId
    };

    await setDoc(
      doc(db, "restaurants", restaurantId, "recipes", copyTargetItemId),
      newRecipe
    );

    closeCopyModal();
    showToast(`Recipe copied to "${targetItem.name}" 📋`);

    // Open target item in editor so user can add extra ingredients
    selectItem(targetItem);

  } catch (err) {
    showToast("Copy failed: " + err.message, true);
    copyConfirmBtn.innerHTML = origHTML;
    copyConfirmBtn.disabled  = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── BULK ADD FEATURE ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

let bulkSelectedRaw   = null;  // { id, name, unitId, unitName, unitSymbol }
let bulkSelectedItems = new Set(); // Set of menuItemIds
let bulkFilteredItems = [];

const bulkModal      = document.getElementById("bulkAddModal");
const bulkRawSearch  = document.getElementById("bulkRawSearch");
const bulkRawDrop    = document.getElementById("bulkRawDropdown");
const bulkItemSearch = document.getElementById("bulkItemSearch");
const bulkConfirmBtn = document.getElementById("bulkConfirmBtn");

// Open modal
document.getElementById("bulkAddBtn").addEventListener("click", () => {
  bulkSelectedRaw   = null;
  bulkSelectedItems = new Set();

  bulkRawSearch.value = "";
  bulkRawSearch.style.display = "";
  bulkRawDrop.classList.remove("open");
  document.getElementById("bulkRawSelected").style.display = "none";
  document.getElementById("bulkQtyInput").value = "";
  document.getElementById("bulkQtyUnit").textContent = "";
  document.getElementById("bulkItemSearch").value = "";

  bulkFilteredItems = [...allMenuItems];
  renderBulkItems();
  updateBulkConfirm();

  bulkModal.style.display = "flex";
  setTimeout(() => bulkRawSearch.focus(), 120);
});

// Close modal
function closeBulkModal() { bulkModal.style.display = "none"; }
document.getElementById("bulkAddClose").addEventListener("click", closeBulkModal);
document.getElementById("bulkCancelBtn").addEventListener("click", closeBulkModal);
bulkModal.addEventListener("click", e => { if (e.target === bulkModal) closeBulkModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && bulkModal.style.display !== "none") closeBulkModal();
});

// Raw material search
bulkRawSearch.addEventListener("input", () => {
  const q = bulkRawSearch.value.toLowerCase().trim();
  if (!q) { bulkRawDrop.classList.remove("open"); return; }

  const matches = allRawMats.filter(r => r.name.toLowerCase().includes(q));
  if (!matches.length) {
    bulkRawDrop.innerHTML = `<div class="raw-dropdown-empty">No raw materials found</div>`;
  } else {
    bulkRawDrop.innerHTML = matches.map(r => {
      const unit = r.unitId ? (unitMap[r.unitId] || {}) : {};
      return `<div class="raw-dropdown-item" data-id="${r.id}">
        <span class="raw-dropdown-name">${escHtml(r.name)}</span>
        <span class="raw-dropdown-unit">${escHtml(unit.symbol || unit.name || "—")}</span>
      </div>`;
    }).join("");
    bulkRawDrop.querySelectorAll(".raw-dropdown-item").forEach(el => {
      el.addEventListener("click", () => selectBulkRaw(el.dataset.id));
    });
  }
  bulkRawDrop.classList.add("open");
});

document.addEventListener("click", e => {
  if (!bulkRawSearch.contains(e.target) && !bulkRawDrop.contains(e.target))
    bulkRawDrop.classList.remove("open");
});

function selectBulkRaw(rawId) {
  const raw = allRawMats.find(r => r.id === rawId);
  if (!raw) return;
  const unit = raw.unitId ? (unitMap[raw.unitId] || {}) : {};
  bulkSelectedRaw = { id: raw.id, name: raw.name, unitId: raw.unitId || "", unitName: unit.name || "", unitSymbol: unit.symbol || "" };

  bulkRawSearch.style.display = "none";
  bulkRawDrop.classList.remove("open");
  document.getElementById("bulkRawName").textContent = raw.name;
  document.getElementById("bulkRawUnitBadge").textContent = unit.symbol || unit.name || "";
  document.getElementById("bulkRawSelected").style.display = "flex";
  document.getElementById("bulkQtyUnit").textContent = unit.symbol ? `${unit.symbol} per serving` : "per serving";

  updateBulkConfirm();
  setTimeout(() => document.getElementById("bulkQtyInput").focus(), 80);
}

document.getElementById("bulkRawClear").addEventListener("click", () => {
  bulkSelectedRaw = null;
  document.getElementById("bulkRawSelected").style.display = "none";
  bulkRawSearch.style.display = "";
  bulkRawSearch.value = "";
  document.getElementById("bulkQtyUnit").textContent = "";
  updateBulkConfirm();
  bulkRawSearch.focus();
});

// Item search filter
bulkItemSearch.addEventListener("input", () => {
  const q = bulkItemSearch.value.toLowerCase();
  bulkFilteredItems = allMenuItems.filter(i => i.name.toLowerCase().includes(q));
  renderBulkItems();
});

// Render item checklist
function renderBulkItems() {
  const list = document.getElementById("bulkItemsList");
  if (!bulkFilteredItems.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-size:0.78rem;color:var(--muted);">No items found</div>`;
    return;
  }
  list.innerHTML = bulkFilteredItems.map(item => {
    const checked  = bulkSelectedItems.has(item.id) ? "checked" : "";
    const hasDot   = savedRecipes[item.id]
      ? `<span class="recipe-dot" title="Already has recipe" style="margin-left:auto;"></span>` : "";
    return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.1s;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <input type="checkbox" data-id="${item.id}" ${checked} style="width:14px;height:14px;flex-shrink:0;accent-color:#534AB7;cursor:pointer;" />
      <img src="${item.image || ''}" style="width:30px;height:30px;border-radius:7px;object-fit:cover;border:1px solid var(--border);background:var(--surface2);flex-shrink:0;" loading="lazy" />
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.name)}</div>
        <div style="font-size:0.67rem;color:var(--muted);">${escHtml(item.categoryName || '')}</div>
      </div>
      ${hasDot}
    </label>`;
  }).join("");

  list.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) bulkSelectedItems.add(cb.dataset.id);
      else bulkSelectedItems.delete(cb.dataset.id);
      updateBulkConfirm();
    });
  });
}

// Select all toggle
document.getElementById("bulkSelectAll").addEventListener("click", () => {
  const allSelected = bulkFilteredItems.every(i => bulkSelectedItems.has(i.id));
  if (allSelected) {
    bulkFilteredItems.forEach(i => bulkSelectedItems.delete(i.id));
  } else {
    bulkFilteredItems.forEach(i => bulkSelectedItems.add(i.id));
  }
  renderBulkItems();
  updateBulkConfirm();
});

function updateBulkConfirm() {
  const n = bulkSelectedItems.size;
  document.getElementById("bulkSelCount").textContent = n > 0 ? `${n} selected` : "";
  document.getElementById("bulkSelectAll").textContent =
    (n > 0 && bulkFilteredItems.every(i => bulkSelectedItems.has(i.id))) ? "Deselect all" : "Select all";

  const canSubmit = bulkSelectedRaw && n > 0;
  bulkConfirmBtn.disabled = !canSubmit;
  bulkConfirmBtn.textContent = canSubmit
    ? `Add to ${n} item${n !== 1 ? "s" : ""}` : "Add Ingredient";
  if (canSubmit) {
    const overwrite = [...bulkSelectedItems].filter(id => {
      const r = savedRecipes[id];
      return r && r.ingredients?.some(ing => ing.rawId === bulkSelectedRaw.id);
    }).length;
    document.getElementById("bulkFooterNote").textContent =
      overwrite > 0
        ? `⚠ ${overwrite} item${overwrite > 1 ? "s" : ""} already have this ingredient — qty will be updated`
        : `Will add to ${n} recipe${n !== 1 ? "s" : ""}`;
  } else {
    document.getElementById("bulkFooterNote").textContent = "";
  }
}

// Confirm bulk add
bulkConfirmBtn.addEventListener("click", async () => {
  if (!bulkSelectedRaw || !bulkSelectedItems.size) return;

  const qty = parseFloat(document.getElementById("bulkQtyInput").value);
  if (!qty || qty <= 0) {
    showToast("Enter a valid quantity", true);
    document.getElementById("bulkQtyInput").focus();
    return;
  }

  bulkConfirmBtn.disabled = true;
  const origText = bulkConfirmBtn.textContent;
  bulkConfirmBtn.textContent = "Saving...";

  let successCount = 0;
  const errors = [];

  for (const itemId of bulkSelectedItems) {
    try {
      const item    = allMenuItems.find(i => i.id === itemId);
      if (!item) continue;

      const existing = savedRecipes[itemId];
      let ings = existing ? [...(existing.ingredients || [])] : [];

      // Remove old entry for this raw if exists, then add updated
      ings = ings.filter(ing => ing.rawId !== bulkSelectedRaw.id);
      ings.push({
        rawId:      bulkSelectedRaw.id,
        rawName:    bulkSelectedRaw.name,
        qty:        qty,
        unitId:     bulkSelectedRaw.unitId,
        unitName:   bulkSelectedRaw.unitName,
        unitSymbol: bulkSelectedRaw.unitSymbol
      });

      const recipeData = existing
        ? { ...existing, ingredients: ings, updatedAt: Date.now() }
        : {
            menuItemId:   itemId,
            menuItemName: item.name,
            categoryId:   item.categoryId   || "",
            categoryName: item.categoryName || "",
            yield:        1,
            notes:        "",
            ingredients:  ings,
            updatedAt:    Date.now()
          };

      await setDoc(
        doc(db, "restaurants", restaurantId, "recipes", itemId),
        recipeData
      );
      successCount++;
    } catch (err) {
      errors.push(err.message);
    }
  }

  closeBulkModal();
  if (successCount > 0) showToast(`${bulkSelectedRaw.name} added to ${successCount} item${successCount !== 1 ? "s" : ""} ✅`);
  if (errors.length)    showToast(`${errors.length} item(s) failed`, true);

  // Refresh editor if active item was in selection
  if (activeItemId && bulkSelectedItems.has(activeItemId)) {
    const item = allMenuItems.find(i => i.id === activeItemId);
    if (item) selectItem(item);
  }
});

// ── Escape HTML ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}