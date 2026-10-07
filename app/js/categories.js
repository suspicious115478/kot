import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, addDoc, doc, updateDoc, onSnapshot, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ─────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ────────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo (sidebar chip) ────────────────────────────────────────────────────────
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

// ── Realtime restaurant doc (logo + brandColor) ───────────────────────────────
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

// ── Image preview (form) ───────────────────────────────────────────────────────
const catImageInput  = document.getElementById("catImage");
const catPreviewImg  = document.getElementById("catPreview");
const previewWrap    = document.getElementById("previewWrap");
const previewRemove  = document.getElementById("previewRemove");
const fileDrop       = document.getElementById("fileDrop");

catImageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    catPreviewImg.src      = ev.target.result;
    previewWrap.style.display = "block";
    fileDrop.style.display    = "none";
  };
  reader.readAsDataURL(file);
});

previewRemove.addEventListener("click", () => {
  catImageInput.value       = "";
  catPreviewImg.src         = "";
  previewWrap.style.display = "none";
  fileDrop.style.display    = "flex";
});

// Drag & drop on file-drop zone
fileDrop.addEventListener("dragover",  (e) => { e.preventDefault(); fileDrop.classList.add("dragover"); });
fileDrop.addEventListener("dragleave", ()  => fileDrop.classList.remove("dragover"));
fileDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  fileDrop.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    const dt = new DataTransfer();
    dt.items.add(file);
    catImageInput.files = dt.files;
    catImageInput.dispatchEvent(new Event("change"));
  }
});

// ── Realtime categories listener ──────────────────────────────────────────────
if (restaurantId) {
  onSnapshot(
    query(
      collection(db, "restaurants", restaurantId, "categories"),
      orderBy("createdAt", "desc")
    ),
    (snap) => {
      const categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCategories(categories);
    }
  );
}

function renderCategories(categories) {
  const grid      = document.getElementById("categoryGrid");
  const countChip = document.getElementById("catCount");

  countChip.textContent =
    categories.length === 1 ? "1 category" : `${categories.length} categories`;

  if (!categories.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <span class="empty-title">No categories yet</span>
        <span class="empty-hint"> Add your first category using the form on the left</span>
      </div>`;
    return;
  }

  grid.innerHTML = categories.map(cat => `
    <div class="cat-card">
      <img class="cat-card-img" src="${cat.image}" alt="${cat.name}" loading="lazy" />
      <div class="cat-card-body">
        <div class="cat-card-name">${cat.name}</div>
        <div class="cat-card-meta">${new Date(cat.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}</div>
        <span class="cat-card-badge">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Category
        </span>
      </div>
    </div>
  `).join("");
}

// ── Transliteration preview ────────────────────────────────────────────────
let transTimer = null;

function buildTranslitField() {
  const field = document.createElement("div");
  field.className = "field";
  field.id = "translitField";
  field.style.display = "none";
  field.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;">
      Hindi Name
      <span id="transStatus" style="font-size:11px;color:#aaa;font-weight:400;"></span>
    </label>
    <input type="text" id="catNameHindi" placeholder="हिंदी नाम" 
           style="font-family:inherit;font-size:15px;" />
    <div style="font-size:11px;color:#aaa;margin-top:4px;">
      Auto-transliterated · आप इसे एडिट कर सकते हैं
    </div>
  `;
  // catName field ke baad insert karo
  const catNameField = document.getElementById("catName").closest(".field");
  catNameField.insertAdjacentElement("afterend", field);
}

buildTranslitField();

async function transliterateText(text) {
  try {
    const encoded = encodeURIComponent(text);
    const url = `https://inputtools.google.com/request?text=${encoded}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
    const res = await fetch(url, {
      headers: { "Referer": "https://www.google.com/" }
    });
    const json = await res.json();
    if (json[0] !== "SUCCESS") return null;
    return json[1][0][1][0]; // first suggestion
  } catch (e) {
    return null;
  }
}

document.getElementById("catName").addEventListener("input", (e) => {
  const val = e.target.value.trim();
  const field = document.getElementById("translitField");
  const status = document.getElementById("transStatus");
  const hindiInput = document.getElementById("catNameHindi");

  clearTimeout(transTimer);

  if (!val) {
    field.style.display = "none";
    hindiInput.value = "";
    return;
  }

  status.textContent = "translating...";
  field.style.display = "block";

  transTimer = setTimeout(async () => {
    const result = await transliterateText(val);
    if (result) {
      hindiInput.value = result;
      status.textContent = "✓ auto";
    } else {
      status.textContent = "failed";
    }
  }, 500);
});

// ── Save category ──────────────────────────────────────────────────────────────
document.getElementById("saveCatBtn").addEventListener("click", async () => {
  const catName = document.getElementById("catName").value.trim();
  const file    = catImageInput.files[0];

  if (!catName) return showToast("Please enter a category name", true);
  if (!file)    return showToast("Please select an image", true);

  const btn = document.getElementById("saveCatBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    const image = await compressImage(file, 600);
    if (!restaurantId) return showToast("Restaurant not found", true);

   const hindiName = document.getElementById("catNameHindi").value.trim();
await addDoc(collection(db, "restaurants", restaurantId, "categories"), {
  name: catName,
  category_name_l2: hindiName || null,
  image,
  available: true,
  createdAt: Date.now()
});

    showToast(`"${catName}" saved! ✅`, false);

    // Reset form
    document.getElementById("catName").value = "";
    catImageInput.value       = "";
    catPreviewImg.src         = "";
    previewWrap.style.display = "none";
    fileDrop.style.display    = "flex";
    document.getElementById("catNameHindi").value = "";
document.getElementById("translitField").style.display = "none";

  } catch (e) {
    showToast(e.message || "Something went wrong", true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Category`;
  }
});