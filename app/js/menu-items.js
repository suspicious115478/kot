import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, addDoc, doc, updateDoc, onSnapshot, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ───────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo (sidebar chip) ───────────────────────────────────────────────────────
function showLogoPreview(src) {
  const preview = document.getElementById("logoPreview");
  const icon    = document.getElementById("logoIcon");
  preview.src           = src;
  preview.style.display = "block";
  icon.style.display    = "none";
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
  } catch (err) {
    showToast("Failed to save logo: " + err.message, true);
  }
});

// ── Realtime restaurant doc ───────────────────────────────────────────────────
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
let allItems      = [];
let activeFilter  = "all";
let categoryMap   = {};
let rowCounter    = 0; // always incrementing UID for rows

// ── Row template ──────────────────────────────────────────────────────────────
function rowHTML(uid) {
  return `
    <div class="item-row" id="row_${uid}" data-uid="${uid}">
      <div class="item-row-hd">
        <span class="row-num">Item 1</span>
        <button class="row-del-btn" data-uid="${uid}" title="Remove this item">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="field">
        <label>Item Name</label>
        <input type="text" class="row-name" placeholder="e.g. Paneer Tikka, Veg Burger" />
      </div>

      <div class="field row-hindi-field" id="hindiFld_${uid}" style="display:none;">
        <label style="display:flex;align-items:center;gap:8px;">
          Hindi Name
          <span class="row-hindi-status" id="hindiStatus_${uid}" style="font-size:11px;color:#aaa;font-weight:400;"></span>
        </label>
        <input type="text" class="row-name-hindi" id="hindiInput_${uid}" placeholder="हिंदी नाम" style="font-family:inherit;" />
        <div style="font-size:11px;color:#aaa;margin-top:4px;">Auto-transliterated · आप इसे एडिट कर सकते हैं</div>
      </div>

      <div class="field">
        <label>Price (₹)</label>
        <div class="price-wrap">
          <span class="price-prefix"></span>
          <input type="number" class="row-price" placeholder="249" min="0" />
        </div>
      </div>

      <div class="field">
        <label class="desc-label-row">
          Description
          <span class="char-counter" id="counter_${uid}">0/150</span>
        </label>
        <textarea
          class="row-desc"
          id="desc_${uid}"
          maxlength="150"
          placeholder="Short description of the dish (optional)..."
          rows="2"
        ></textarea>
      </div>

      <div class="field row-hindi-field" id="descHindiFld_${uid}" style="display:none;">
        <label style="display:flex;align-items:center;gap:8px;">
          Hindi Description
          <span class="row-hindi-status" id="descHindiStatus_${uid}" style="font-size:11px;color:#aaa;font-weight:400;"></span>
        </label>
        <textarea class="row-desc-hindi" id="descHindiInput_${uid}" placeholder="हिंदी विवरण" rows="2" style="font-family:inherit;"></textarea>
        <div style="font-size:11px;color:#aaa;margin-top:4px;">Auto-transliterated · आप इसे एडिट कर सकते हैं</div>
      </div>

      <div class="field">
        <label>Item Image</label>
        <label class="file-drop" for="rowImg_${uid}" id="fdrop_${uid}">
          <div class="file-drop-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
          <span class="file-drop-text">Choose an image or drop it here</span>
          <span class="file-drop-hint">JPG, PNG, WEBP · Max 5MB</span>
        </label>
        <input type="file" id="rowImg_${uid}" class="row-img-input" accept="image/*" />
        <div class="preview-wrap" id="prev_${uid}" style="display:none;">
          <img id="prevImg_${uid}" alt="Preview" />
          <button class="preview-remove" id="prevRm_${uid}" title="Remove image">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="field">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
          <label style="margin-bottom:0;">Customizations <span style="font-size:0.68rem;font-weight:400;color:var(--muted);">(optional)</span></label>
          <button type="button" class="add-custom-btn" data-uid="${uid}" style="font-size:0.72rem;font-weight:600;color:var(--dish-clr);background:var(--dish-bg);border:1px solid var(--dish-brd);border-radius:6px;padding:3px 9px;cursor:pointer;">+ Add</button>
        </div>
        <div class="custom-list" id="customList_${uid}"></div>
      </div>

    </div>
  `;
}

async function transliterateText(text) {
    try {
        const encoded = encodeURIComponent(text);
        const url = `https://inputtools.google.com/request?text=${encoded}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
        const res = await fetch(url, { headers: { "Referer": "https://www.google.com/" } });
        const json = await res.json();
        if (json[0] !== "SUCCESS") return null;
        return json[1][0][1][0];
    } catch (e) { return null; }
}

// ── Bind events for a single row ──────────────────────────────────────────────
function bindRowEvents(uid) {
  const row        = document.getElementById(`row_${uid}`);
  if (!row) return;

  // Char counter for description
  const textarea   = document.getElementById(`desc_${uid}`);
  const counter    = document.getElementById(`counter_${uid}`);
 const descHindiFld    = document.getElementById(`descHindiFld_${uid}`);
  const descHindiStatus = document.getElementById(`descHindiStatus_${uid}`);
  const descHindiInput  = document.getElementById(`descHindiInput_${uid}`);
  let   descHindiTimer  = null;

  textarea.addEventListener("input", () => {
    counter.textContent = `${textarea.value.length}/150`;
    const val = textarea.value.trim();
    clearTimeout(descHindiTimer);
    if (!val) {
      descHindiFld.style.display = "none";
      descHindiInput.value = "";
      return;
    }
    descHindiStatus.textContent = "translating...";
    descHindiFld.style.display = "block";
    descHindiTimer = setTimeout(async () => {
      const result = await transliterateText(val);
      if (result) {
        descHindiInput.value = result;
        descHindiStatus.textContent = "✓ auto";
      } else {
        descHindiStatus.textContent = "failed";
      }
    }, 500);
  });

  // yeh block add karo — existing fileInput listener se pehle
const nameInput    = row.querySelector(".row-name");
const hindiFld     = document.getElementById(`hindiFld_${uid}`);
const hindiStatus  = document.getElementById(`hindiStatus_${uid}`);
const hindiInput   = document.getElementById(`hindiInput_${uid}`);
let   hindiTimer   = null;

nameInput.addEventListener("input", () => {
    const val = nameInput.value.trim();
    clearTimeout(hindiTimer);
    if (!val) {
        hindiFld.style.display = "none";
        hindiInput.value = "";
        return;
    }
    hindiStatus.textContent = "translating...";
    hindiFld.style.display = "block";
    hindiTimer = setTimeout(async () => {
        const result = await transliterateText(val);
        if (result) {
            hindiInput.value = result;
            hindiStatus.textContent = "✓ auto";
        } else {
            hindiStatus.textContent = "failed";
        }
    }, 500);
});

  // File input & preview
  const fileInput  = document.getElementById(`rowImg_${uid}`);
  const fileDrop   = document.getElementById(`fdrop_${uid}`);
  const prevWrap   = document.getElementById(`prev_${uid}`);
  const prevImg    = document.getElementById(`prevImg_${uid}`);
  const prevRm     = document.getElementById(`prevRm_${uid}`);

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      prevImg.src            = ev.target.result;
      prevWrap.style.display = "block";
      fileDrop.style.display = "none";
    };
    reader.readAsDataURL(file);
  });

  prevRm.addEventListener("click", () => {
    fileInput.value        = "";
    prevImg.src            = "";
    prevWrap.style.display = "none";
    fileDrop.style.display = "flex";
  });

  // Drag & drop
  fileDrop.addEventListener("dragover",  (e) => { e.preventDefault(); fileDrop.classList.add("dragover"); });
  fileDrop.addEventListener("dragleave", ()  => fileDrop.classList.remove("dragover"));
  fileDrop.addEventListener("drop", (e) => {
    e.preventDefault(); fileDrop.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const dt = new DataTransfer(); dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change"));
    }
  });

  // Delete row button
  const delBtn = row.querySelector(".row-del-btn");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      row.style.animation = "rowFadeOut 0.2s ease forwards";
      setTimeout(() => {
        row.remove();
        refreshRowNumbers();
      }, 180);
    });
  }

  // Customizations
  const addCustomBtn = row.querySelector(".add-custom-btn");
  const customList   = document.getElementById(`customList_${uid}`);

  addCustomBtn.addEventListener("click", () => {
    const entry = document.createElement("div");
    entry.style.cssText = "margin-bottom:10px;";
    entry.innerHTML = `
  <div style="display:flex;gap:7px;align-items:center;margin-bottom:5px;">
    <input type="text" placeholder="e.g. Extra Cheese" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;font-family:inherit;background:var(--surface);color:var(--text);outline:none;" class="custom-name" />
    <input type="number" placeholder="₹0" min="0" style="width:80px;padding:8px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;font-family:inherit;background:var(--surface);color:var(--text);outline:none;" class="custom-price" />
    <input type="number" placeholder="Max" min="1" title="Max quantity user can add" style="width:64px;padding:8px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;font-family:inherit;background:var(--surface);color:var(--text);outline:none;" class="custom-maxqty" />
    <button type="button" style="width:26px;height:26px;border-radius:6px;background:var(--red-bg);border:1px solid var(--red-brd);color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onclick="this.closest('div[style]').remove()">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <input type="text" class="custom-name-l2" placeholder="हिंदी नाम (auto)" style="display:none;width:100%;padding:7px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.8rem;font-family:inherit;background:var(--surface2);color:var(--text);outline:none;" />
    `;
    customList.appendChild(entry);

    const nameInput = entry.querySelector(".custom-name");
    const l2Input   = entry.querySelector(".custom-name-l2");
    let   l2Timer   = null;

    nameInput.addEventListener("input", () => {
      const val = nameInput.value.trim();
      clearTimeout(l2Timer);
      if (!val) { l2Input.style.display = "none"; l2Input.value = ""; return; }
      l2Input.style.display = "block";
      l2Input.placeholder = "translating...";
      l2Timer = setTimeout(async () => {
        const result = await transliterateText(val);
        l2Input.value = result || "";
        l2Input.placeholder = "हिंदी नाम (auto)";
      }, 500);
    });
  });
}

// ── Add a new row ─────────────────────────────────────────────────────────────
function addRow() {
  const uid       = rowCounter++;
  const container = document.getElementById("itemRows");
  const div       = document.createElement("div");
  div.innerHTML   = rowHTML(uid);
  container.appendChild(div.firstElementChild);
  bindRowEvents(uid);
  refreshRowNumbers();

  // Scroll into view
  document.getElementById(`row_${uid}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Renumber visible rows ─────────────────────────────────────────────────────
function refreshRowNumbers() {
  const rows = document.querySelectorAll(".item-row");
  rows.forEach((row, i) => {
    const numEl  = row.querySelector(".row-num");
    const delBtn = row.querySelector(".row-del-btn");
    if (numEl)  numEl.textContent = `Item ${i + 1}`;
    // Hide delete on the only row; show on all others
    if (delBtn) delBtn.style.display = rows.length === 1 ? "none" : "flex";
  });
}

// ── Reset all rows to one fresh row ──────────────────────────────────────────
function resetRows() {
  const container  = document.getElementById("itemRows");
  container.innerHTML = "";
  rowCounter       = 0;
  addRow();
}

// ── Load categories into dropdown ────────────────────────────────────────────
if (restaurantId) {
  onSnapshot(
    query(collection(db, "restaurants", restaurantId, "categories"), orderBy("createdAt", "asc")),
    (snap) => {
      categoryMap = {};
      snap.docs.forEach(d => { categoryMap[d.id] = d.data().name; });

      const select    = document.getElementById("itemCategory");
      const uploadBtn = document.getElementById("uploadItemBtn");
      const addRowBtn = document.getElementById("addRowBtn");
      const warning   = document.getElementById("noCatWarning");

      if (snap.empty) {
        select.innerHTML         = '<option value="">— Create a category first —</option>';
        warning.style.display    = "flex";
        uploadBtn.disabled       = true;
        addRowBtn.disabled       = true;
        return;
      }

      warning.style.display = "none";
      uploadBtn.disabled    = false;
      addRowBtn.disabled    = false;

      select.innerHTML =
        '<option value="">— Select a category —</option>' +
        snap.docs.map(d =>
          `<option value="${d.id}" data-name="${d.data().name}">${d.data().name}</option>`
        ).join("");

      // Init first row on first load
      if (document.getElementById("itemRows").children.length === 0) {
        addRow();
      }

      buildFilterTabs(snap.docs.map(d => ({ id: d.id, name: d.data().name })));
    }
  );
}

// ── Add Another Item button ───────────────────────────────────────────────────
document.getElementById("addRowBtn").addEventListener("click", () => {
  addRow();
});

// ── Realtime items listener ───────────────────────────────────────────────────
let categoryUnsubs = [];

if (restaurantId) {
  onSnapshot(
    query(collection(db, "restaurants", restaurantId, "categories"), orderBy("createdAt", "asc")),
    (catSnap) => {
      categoryUnsubs.forEach(u => u());
      categoryUnsubs = [];
      allItems = [];

      const catIds = catSnap.docs.map(d => d.id);
      if (!catIds.length) { renderItems(); return; }

      catIds.forEach(catId => {
        const unsub = onSnapshot(
          query(
            collection(db, "restaurants", restaurantId, "categories", catId, "menu_items"),
            orderBy("createdAt", "desc")
          ),
          (itemSnap) => {
            allItems = allItems.filter(i => i.categoryId !== catId);
            itemSnap.docs.forEach(d => allItems.push({ id: d.id, ...d.data() }));
            allItems.sort((a, b) => b.createdAt - a.createdAt);
            renderItems();
          }
        );
        categoryUnsubs.push(unsub);
      });
    }
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────
function buildFilterTabs(categories) {
  const container = document.getElementById("filterTabs");
  const allTab    = `<button class="filter-tab ${activeFilter === "all" ? "active" : ""}" data-cat="all">All</button>`;
  const catTabs   = categories.map(c =>
    `<button class="filter-tab ${activeFilter === c.id ? "active" : ""}" data-cat="${c.id}">${c.name}</button>`
  ).join("");
  container.innerHTML = allTab + catTabs;

  container.querySelectorAll(".filter-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.cat;
      container.querySelectorAll(".filter-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderItems();
    });
  });
}

// ── Render items list ─────────────────────────────────────────────────────────
function renderItems() {
  const list      = document.getElementById("itemsList");
  const countChip = document.getElementById("itemCount");

  const filtered = activeFilter === "all"
    ? allItems
    : allItems.filter(i => i.categoryId === activeFilter);

  countChip.textContent = filtered.length === 1 ? "1 item" : `${filtered.length} items`;

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🍽️</span>
        <span class="empty-title">${activeFilter === "all" ? "No items yet" : "No items in this category"}</span>
        <span class="empty-hint">Add a dish using the form on the left</span>
      </div>`;
    return;
  }

  // ── Smart DOM diff — sirf naye cards add karo, existing untouched ──
  const existingIds = new Set(
    [...list.querySelectorAll(".item-card[data-id]")].map(el => el.dataset.id)
  );
  const newIds = new Set(filtered.map(item => item.id));

  // Remove cards jo ab filtered mein nahi hain
  list.querySelectorAll(".item-card[data-id]").forEach(el => {
    if (!newIds.has(el.dataset.id)) el.remove();
  });

  // Empty state hata do agar tha
  list.querySelector(".empty-state")?.remove();

  // Naye cards add karo (jo already exist karte hain unhe skip karo)
  filtered.forEach((item, i) => {
    if (existingIds.has(item.id)) return; // already hai, flicker nahi

    const card = document.createElement("div");
    card.className = "item-card";
    card.dataset.id = item.id;
    card.innerHTML = `
      <img class="item-thumb" src="${item.image}" alt="${item.name}" loading="lazy" />
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        ${item.description ? `<div class="item-desc">${item.description}</div>` : ""}
        <div class="item-meta">
          <span class="item-cat">${item.categoryName || categoryMap[item.categoryId] || "—"}</span>
          <span class="item-date">${new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        </div>
      </div>
      <div class="item-price">₹${item.price}</div>
    `;
    list.appendChild(card);
  });
}

// ── Upload all items ──────────────────────────────────────────────────────────
document.getElementById("uploadItemBtn").addEventListener("click", async () => {
  const categoryId = document.getElementById("itemCategory").value;
  if (!categoryId) return showToast("Please select a category", true);

  const selectedOption = document.getElementById("itemCategory").selectedOptions[0];
  const categoryName   = selectedOption.dataset.name || selectedOption.text;

  const rows = document.querySelectorAll(".item-row");

  // ── Validate all rows first ──
  const items = [];
  for (const row of rows) {
    const name  = row.querySelector(".row-name").value.trim();
    const price = row.querySelector(".row-price").value;
    const desc  = row.querySelector(".row-desc").value.trim();
    const file  = row.querySelector(".row-img-input").files[0];
    const rowNum = row.querySelector(".row-num").textContent;

    if (!name)                        return showToast(`${rowNum}: please enter a name`, true);
    if (!price || Number(price) <= 0) return showToast(`${rowNum}: please enter a valid price`, true);
    if (!file)                        return showToast(`${rowNum}: please select an image`, true);

const hindiVal  = row.querySelector(".row-name-hindi")?.value.trim() || null;
    const hindiDesc = row.querySelector(".row-desc-hindi")?.value.trim() || null;

    const customizations = [];
for (const entry of row.querySelectorAll(`#customList_${row.dataset.uid} > div`)) {
  const cName  = entry.querySelector(".custom-name")?.value.trim();
  const cPrice = entry.querySelector(".custom-price")?.value;
  if (cName) {
    const cNameL2 = entry.querySelector(".custom-name-l2")?.value.trim() || null;
   const cMaxQty = entry.querySelector(".custom-maxqty")?.value;
customizations.push({ name: cName, name_l2: cNameL2 || null, price: cPrice ? Number(cPrice) : 0, maxQty: cMaxQty ? Number(cMaxQty) : null });
  }
}

    items.push({ name, price: Number(price), desc, file, hindiName: hindiVal, hindiDesc, customizations });
  }

  // ── Upload ──
  const btn = document.getElementById("uploadItemBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Uploading ${items.length} item${items.length > 1 ? "s" : ""}...`;

  let uploaded = 0;
  try {
    if (!restaurantId) return showToast("Restaurant not found", true);

    for (const item of items) {
      const image = await compressImage(item.file, 400);
     await addDoc(
    collection(db, "restaurants", restaurantId, "categories", categoryId, "menu_items"),
    {
        name:          item.name,
        item_name_l2:  item.hindiName || null,
        price:         item.price,
        description:   item.desc,
        description_l2: item.hindiDesc || null,
        image,
        categoryId,
        categoryName,
        customizations: item.customizations.length ? item.customizations : [],
        available:     true,
        createdAt:     Date.now()
    }
);
      uploaded++;
    }

    showToast(`${uploaded} item${uploaded > 1 ? "s" : ""} uploaded successfully! 🍽️`);
    resetRows();

  } catch (e) {
    showToast(e.message || "An error occurred", true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      Upload Items`;
  }
});