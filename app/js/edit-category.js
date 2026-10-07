import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage, bindPreview
} from "./firebase.js";

import {
  collection, getDocs, doc, onSnapshot, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// URL params
const params     = new URLSearchParams(window.location.search);
const categoryId = params.get("id");
const catName    = params.get("name") || "Category";

if (!categoryId) window.location.href = "./edit-menu.html";

document.getElementById("pageTitle").textContent       = catName;
document.getElementById("topbarTitle").textContent     = catName;

bindPreview("editImage", "editPreview");

async function transliterateText(text) {
  try {
    const encoded = encodeURIComponent(text);
    const res  = await fetch(`https://inputtools.google.com/request?text=${encoded}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`, { headers: { Referer: "https://www.google.com/" } });
    const json = await res.json();
    if (json[0] === "SUCCESS") return json[1][0][1][0];
    return null;
  } catch { return null; }
}
let _nameHindiTimer = null;
let _descHindiTimer = null;

// ── Logo / brand color sync ────────────────────────────────────────────────────
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
    const data = snap.data();
    if (data.logo) showLogoPreview(data.logo);
    if (data.brandColor) {
      const dot = document.getElementById("colorDot");
      if (dot) dot.style.background = data.brandColor;
    }
  });
}

// ── Load items ─────────────────────────────────────────────────────────────────
async function loadItems() {
  if (!restaurantId || !categoryId) return;

  const snap = await getDocs(
    query(
      collection(db, "restaurants", restaurantId, "categories", categoryId, "menu_items"),
      orderBy("createdAt", "desc")
    )
  );

  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  window._itemsCache = items;
  const list  = document.getElementById("itemList");
  const chip  = document.getElementById("itemCountChip");
  if (chip) chip.textContent = items.length;

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🍽️</span>
        <span class="empty-title">No items in this category</span>
        <span class="empty-hint">Add dishes from the Menu Items page</span>
      </div>`;
    return;
  }

  list.innerHTML = items.map((item, i) => {
    const isAvailable = item.available !== false;
    return `
      <div class="item-row ${isAvailable ? "" : "unavailable"}" style="animation: fadeUp 0.3s ease ${i * 0.04}s forwards; opacity:0;">
        <img class="item-img" src="${item.image}" alt="${item.name}" loading="lazy" />
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-price">₹${item.price}</div>
          <span class="status-badge ${isAvailable ? "available" : "unavailable"}">
            ${isAvailable ? "● Available" : "● Unavailable"}
          </span>
        </div>
        <div class="manage-actions">
         <button class="action-btn edit" title="Edit"
  onclick="openEdit('${item.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
         <button class="action-btn toggle ${isAvailable ? "on" : ""}"
  style="width:auto; padding:0 10px; font-size:0.72rem; font-weight:600;"
  title="${isAvailable ? "Mark unavailable" : "Mark available"}"
  onclick="toggleItem('${item.id}', ${isAvailable})">
           ${isAvailable ? "Mark Unavailable" : "Mark Available"}
          </button>
          <button class="action-btn del" title="Delete"
            onclick="confirmDelete('${item.id}', '${item.name.replace(/'/g,"\\'")}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join("");
}

// ── Toggle ─────────────────────────────────────────────────────────────────────
window.toggleItem = async (id, currentlyAvailable) => {
  if (!restaurantId) return;
  try {
    await updateDoc(
      doc(db, "restaurants", restaurantId, "categories", categoryId, "menu_items", id),
      { available: !currentlyAvailable }
    );
    showToast(currentlyAvailable ? "Marked as unavailable" : "Marked as available ✅");
    await loadItems();
  } catch (err) { showToast("Failed to update: " + err.message, true); }
};

// ── Delete ─────────────────────────────────────────────────────────────────────
let _pendingDelete = null;

window.confirmDelete = (id, itemName) => {
  _pendingDelete = { id };
  document.getElementById("deleteMsg").textContent = `"${itemName}" will be permanently deleted.`;
  document.getElementById("deleteModal").classList.add("open");
};

document.getElementById("deleteCancelBtn").addEventListener("click", () => {
  document.getElementById("deleteModal").classList.remove("open");
  _pendingDelete = null;
});
document.getElementById("deleteModalBg").addEventListener("click", () => {
  document.getElementById("deleteModal").classList.remove("open");
  _pendingDelete = null;
});

document.getElementById("deleteConfirmBtn").addEventListener("click", async () => {
  if (!_pendingDelete || !restaurantId) return;
  const btn = document.getElementById("deleteConfirmBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Deleting...';
  try {
    await deleteDoc(
      doc(db, "restaurants", restaurantId, "categories", categoryId, "menu_items", _pendingDelete.id)
    );
    showToast("Item deleted 🗑️");
    document.getElementById("deleteModal").classList.remove("open");
    _pendingDelete = null;
    await loadItems();
  } catch (err) {
    showToast("Failed to delete: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Delete";
  }
});

// ── Edit ───────────────────────────────────────────────────────────────────────
let _editId = null;

window.openEdit = (id) => {
  const item = (window._itemsCache || []).find(i => i.id === id);
  if (!item) return;
  _editId = id;

  document.getElementById("editName").value       = item.name;
  document.getElementById("editPrice").value      = item.price;
  document.getElementById("editDesc").value       = item.description || "";
  document.getElementById("editDescCounter").textContent = `${(item.description || "").length} / 150`;
  document.getElementById("editNameHindi").value  = item.item_name_l2 || "";
  document.getElementById("editDescHindi").value  = item.description_l2 || "";
  document.getElementById("editNameHindiStatus").textContent = "";
  document.getElementById("editDescHindiStatus").textContent = "(optional)";
  document.getElementById("editImage").value      = "";
  document.getElementById("editPreview").style.display = "none";

  // Customizations populate karo
  const editCustomList = document.getElementById("editCustomList");
  editCustomList.innerHTML = "";
  (item.customizations || []).forEach(cus => addEditCustomRow(cus.name, cus.price, cus.name_l2));

  document.getElementById("editModal").classList.add("open");

  // Name transliteration
  document.getElementById("editName").oninput = () => {
    clearTimeout(_nameHindiTimer);
    const val = document.getElementById("editName").value.trim();
    if (!val) { document.getElementById("editNameHindiStatus").textContent = ""; return; }
    document.getElementById("editNameHindiStatus").textContent = "translating...";
    _nameHindiTimer = setTimeout(async () => {
      const result = await transliterateText(val);
      if (result) { document.getElementById("editNameHindi").value = result; document.getElementById("editNameHindiStatus").textContent = "✓ auto"; }
      else document.getElementById("editNameHindiStatus").textContent = "";
    }, 500);
  };

  // Description transliteration
  document.getElementById("editDesc").oninput = () => {
    clearTimeout(_descHindiTimer);
    const val = document.getElementById("editDesc").value.trim();
    const len = document.getElementById("editDesc").value.length;
    const counter = document.getElementById("editDescCounter");
    counter.textContent = `${len} / 150`;
    counter.style.color = len >= 140 ? "var(--red)" : "var(--muted)";
    if (!val) { document.getElementById("editDescHindiStatus").textContent = "(optional)"; return; }
    document.getElementById("editDescHindiStatus").textContent = "translating...";
    _descHindiTimer = setTimeout(async () => {
      const result = await transliterateText(val);
      if (result) { document.getElementById("editDescHindi").value = result; document.getElementById("editDescHindiStatus").textContent = "✓ auto"; }
      else document.getElementById("editDescHindiStatus").textContent = "(optional)";
    }, 500);
  };
};

// document.getElementById("editDesc").addEventListener("input", () => {
//   const len = document.getElementById("editDesc").value.length;
//   const counter = document.getElementById("editDescCounter");
//   counter.textContent = `${len} / 150`;
//   counter.style.color = len >= 140 ? "var(--red)" : "var(--muted)";
// });



function addEditCustomRow(name = "", price = "", l2 = "") {
  const editCustomList = document.getElementById("editCustomList");
  const entry = document.createElement("div");
  entry.style.cssText = "margin-bottom:10px;";
  entry.innerHTML = `
    <div style="display:flex;gap:7px;align-items:center;margin-bottom:5px;">
      <input type="text" placeholder="e.g. Extra Cheese" value="${name}" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;font-family:inherit;background:var(--surface);color:var(--text);outline:none;" class="edit-custom-name" />
      <input type="number" placeholder="₹0" min="0" value="${price}" style="width:80px;padding:8px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;font-family:inherit;background:var(--surface);color:var(--text);outline:none;" class="edit-custom-price" />
      <button type="button" style="width:26px;height:26px;border-radius:6px;background:var(--red-bg);border:1px solid var(--red-brd);color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onclick="this.closest('div[style]').remove()">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <input type="text" class="edit-custom-name-l2" placeholder="हिंदी नाम (auto)" value="${l2}" style="width:100%;padding:7px 11px;border:1px solid var(--border);border-radius:8px;font-size:0.8rem;font-family:inherit;background:var(--surface2);color:var(--text);outline:none;" />
  `;
  editCustomList.appendChild(entry);

  const nameInput = entry.querySelector(".edit-custom-name");
  const l2Input   = entry.querySelector(".edit-custom-name-l2");
  let   l2Timer   = null;

  nameInput.addEventListener("input", () => {
    const val = nameInput.value.trim();
    clearTimeout(l2Timer);
    if (!val) { l2Input.value = ""; return; }
    l2Input.placeholder = "translating...";
    l2Timer = setTimeout(async () => {
      const result = await transliterateText(val);
      l2Input.value = result || "";
      l2Input.placeholder = "हिंदी नाम (auto)";
    }, 500);
  });
}

document.getElementById("editAddCustomBtn").addEventListener("click", () => {
  addEditCustomRow();
});

document.getElementById("editModalClose").addEventListener("click", () => {
  document.getElementById("editModal").classList.remove("open");
  _editId = null;
});
document.getElementById("editModalBg").addEventListener("click", () => {
  document.getElementById("editModal").classList.remove("open");
  _editId = null;
});

document.getElementById("editSaveBtn").addEventListener("click", async () => {
  const newName  = document.getElementById("editName").value.trim();
  const newPrice = document.getElementById("editPrice").value;
  const file     = document.getElementById("editImage").files[0];

  if (!newName)                           return showToast("Please enter a name", true);
  if (!newPrice || Number(newPrice) <= 0) return showToast("Please enter a valid price", true);
  if (!_editId || !restaurantId)          return;

  const btn = document.getElementById("editSaveBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
  const newDesc      = document.getElementById("editDesc").value.trim();
    const newHindiName = document.getElementById("editNameHindi").value.trim();
    const newDescHindi = document.getElementById("editDescHindi").value.trim();
    const customizations = [];
    document.querySelectorAll("#editCustomList > div").forEach(entry => {
      const cName  = entry.querySelector(".edit-custom-name")?.value.trim();
      const cPrice = entry.querySelector(".edit-custom-price")?.value;
      const cL2    = entry.querySelector(".edit-custom-name-l2")?.value.trim() || null;
      if (cName) customizations.push({ name: cName, name_l2: cL2, price: cPrice ? Number(cPrice) : 0 });
    });
    const updateData   = { name: newName, price: Number(newPrice), description: newDesc, item_name_l2: newHindiName || null, description_l2: newDescHindi || null, customizations };
    if (file) updateData.image = await compressImage(file, 400);
    await updateDoc(
      doc(db, "restaurants", restaurantId, "categories", categoryId, "menu_items", _editId),
      updateData
    );
    showToast(`"${newName}" updated ✅`);
    document.getElementById("editModal").classList.remove("open");
    _editId = null;
    await loadItems();
  } catch (err) {
    showToast("Failed to save: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Save Changes";
  }
});

await loadItems();