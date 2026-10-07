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

bindPreview("editImage", "editPreview");

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

// ── Load & render categories ──────────────────────────────────────────────────
async function loadCategories() {
  if (!restaurantId) return;

  const snap = await getDocs(
    query(collection(db, "restaurants", restaurantId, "categories"), orderBy("createdAt", "desc"))
  );

  const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  window._catsCache = cats;
  const list = document.getElementById("categoryList");
  const chip = document.getElementById("catCountChip");
  if (chip) chip.textContent = cats.length;

  if (!cats.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <span class="empty-title">No categories yet</span>
        <span class="empty-hint">Add categories first from the Categories page</span>
      </div>`;
    return;
  }

  list.innerHTML = cats.map((cat, i) => {
    const isAvailable = cat.available !== false;
    return `
      <div class="cat-row ${isAvailable ? "" : "unavailable"}" style="animation: fadeUp 0.3s ease ${i * 0.04}s forwards; opacity:0;">
        <img class="cat-row-img" src="${cat.image}" alt="${cat.name}" loading="lazy" />
        <div class="cat-row-info">
          <div class="cat-row-name">${cat.name}</div>
          <span class="status-badge ${isAvailable ? "available" : "unavailable"}">
            ${isAvailable ? "● Available" : "● Unavailable"}
          </span>
        </div>
        <div class="manage-actions">
          <button class="action-btn edit" title="Edit" onclick="openEdit('${cat.id}', '${cat.name.replace(/'/g,"\\'")}', event)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
         <button class="action-btn toggle ${isAvailable ? "on" : ""}"
  style="width:auto; padding:0 10px; font-size:0.72rem; font-weight:600;"
  title="${isAvailable ? "Mark unavailable" : "Mark available"}"
  onclick="toggleCat('${cat.id}', ${isAvailable}, event)">
           ${isAvailable ? "Mark Unavailable" : "Mark Available"}
          </button>
          <button class="action-btn del" title="Delete" onclick="confirmDelete('${cat.id}', '${cat.name.replace(/'/g,"\\'")}', event)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
        <span class="cat-arrow" onclick="goToCategory('${cat.id}', '${cat.name.replace(/'/g,"\\'")}')">→</span>
      </div>`;
  }).join("");

  list.querySelectorAll(".cat-row").forEach((row, i) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".manage-actions") || e.target.closest(".cat-arrow")) return;
      const cat = cats[i];
      window.location.href = `./edit-category.html?id=${cat.id}&name=${encodeURIComponent(cat.name)}`;
    });
  });
}

window.goToCategory = (id, name) => {
  window.location.href = `./edit-category.html?id=${id}&name=${encodeURIComponent(name)}`;
};

// ── Toggle availability ────────────────────────────────────────────────────────
window.toggleCat = async (id, currentlyAvailable, e) => {
  e.stopPropagation();
  if (!restaurantId) return;
  try {
    await updateDoc(doc(db, "restaurants", restaurantId, "categories", id), { available: !currentlyAvailable });
    showToast(currentlyAvailable ? "Marked as unavailable" : "Marked as available ✅");
    await loadCategories();
  } catch (err) { showToast("Failed to update: " + err.message, true); }
};

// ── Delete ────────────────────────────────────────────────────────────────────
let _pendingDelete = null;

window.confirmDelete = (id, itemName, e) => {
  e.stopPropagation();
  _pendingDelete = { id };
  document.getElementById("deleteMsg").textContent =
    `"${itemName}" and all its menu items will be permanently deleted.`;
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
    await deleteDoc(doc(db, "restaurants", restaurantId, "categories", _pendingDelete.id));
    showToast("Category deleted 🗑️");
    document.getElementById("deleteModal").classList.remove("open");
    _pendingDelete = null;
    await loadCategories();
  } catch (err) {
    showToast("Failed to delete: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Delete";
  }
});

// ── Edit ──────────────────────────────────────────────────────────────────────
let _editId = null;

let _catHindiTimer = null;

window.openEdit = (id, currentName, e) => {
  e.stopPropagation();
  _editId = id;

  // Current data cache se lo
  const snap = window._catsCache?.find(c => c.id === id);

  document.getElementById("editName").value        = currentName;
  document.getElementById("editCatNameHindi").value = snap?.category_name_l2 || "";
  document.getElementById("editCatHindiStatus").textContent = "";
  document.getElementById("editImage").value        = "";
  document.getElementById("editPreview").style.display = "none";
  document.getElementById("editModal").classList.add("open");

  // Transliteration on name input
  const nameEl   = document.getElementById("editName");
  const hindiEl  = document.getElementById("editCatNameHindi");
  const statusEl = document.getElementById("editCatHindiStatus");

  nameEl.oninput = () => {
    clearTimeout(_catHindiTimer);
    if (!nameEl.value.trim()) { statusEl.textContent = ""; return; }
    statusEl.textContent = "translating...";
    _catHindiTimer = setTimeout(async () => {
      try {
        const encoded = encodeURIComponent(nameEl.value.trim());
        const res  = await fetch(`https://inputtools.google.com/request?text=${encoded}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`, { headers: { Referer: "https://www.google.com/" } });
        const json = await res.json();
        if (json[0] === "SUCCESS") { hindiEl.value = json[1][0][1][0]; statusEl.textContent = "✓ auto"; }
        else statusEl.textContent = "";
      } catch { statusEl.textContent = ""; }
    }, 500);
  };
};

document.getElementById("editModalClose").addEventListener("click", () => {
  document.getElementById("editModal").classList.remove("open");
  _editId = null;
});
document.getElementById("editModalBg").addEventListener("click", () => {
  document.getElementById("editModal").classList.remove("open");
  _editId = null;
});

document.getElementById("editSaveBtn").addEventListener("click", async () => {
  const newName = document.getElementById("editName").value.trim();
  const file    = document.getElementById("editImage").files[0];
  if (!newName) return showToast("Please enter a name", true);
  if (!_editId || !restaurantId) return;

  const btn = document.getElementById("editSaveBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    const hindiName  = document.getElementById("editCatNameHindi").value.trim();
    const updateData = { name: newName, category_name_l2: hindiName || null };
    if (file) updateData.image = await compressImage(file, 600);
    await updateDoc(doc(db, "restaurants", restaurantId, "categories", _editId), updateData);
    showToast(`"${newName}" updated ✅`);
    document.getElementById("editModal").classList.remove("open");
    _editId = null;
    await loadCategories();
  } catch (err) {
    showToast("Failed to save: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Save Changes";
  }
});

await loadCategories();