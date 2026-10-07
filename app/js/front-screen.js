import {
  db, requireAuth, getRestaurantId, showToast, compressImage
} from "./firebase.js";

import {
  doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();

const restaurantId = await getRestaurantId();
const heroInput         = document.getElementById("heroInput");
const heroPreview       = document.getElementById("heroPreview");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const changeHeroBtn     = document.getElementById("changeHeroBtn");
const ribbonInput       = document.getElementById("ribbonInput");
const saveBtn           = document.getElementById("saveFooterBtn");
const wordCountDisplay  = document.getElementById("wordCount");
const ribbonItemsEl     = document.getElementById("ribbonItems");

let currentHeroBase64 = null;  // ← yahan hero store hoga
let ribbonTags = [];
const MAX_TAGS = 12;
const tagBox   = document.getElementById("tagBox");
const tagInput = document.getElementById("ribbonInput");
const wordCount = document.getElementById("wordCount");
const tagHint   = document.getElementById("tagHint");

// ── 1. Firestore se data load ──────────────────────────────────
if (restaurantId) {
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId));
    if (snap.exists()) {
      const data = snap.data();

      // Hero image
      if (data.item1) {
        currentHeroBase64 = data.item1;          // ← zaruri line
        heroPreview.src = data.item1;
        heroPreview.style.display = "block";
        uploadPlaceholder.style.display = "none";
        changeHeroBtn.style.display = "flex";
      }

    // Ribbon text
if (data.item_names) {
  const loaded = data.item_names.split(",").map(i => i.trim()).filter(Boolean).slice(0, MAX_TAGS);
  ribbonTags.push(...loaded);
  renderTags();
}
    }
  } catch (err) {
    showToast("Failed to load data: " + err.message, true);
  }
}

// ── 2. Hero image upload ───────────────────────────────────────
document.getElementById("heroDropZone").addEventListener("click", () => heroInput.click());
changeHeroBtn.addEventListener("click", (e) => { e.stopPropagation(); heroInput.click(); });

heroInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast("Compressing image...");
    const base64 = await compressImage(file, 800);
    currentHeroBase64 = base64;                  // ← yahan store hoga
    heroPreview.src = base64;
    heroPreview.style.display = "block";
    uploadPlaceholder.style.display = "none";
    changeHeroBtn.style.display = "flex";
    showToast("Image ready! Click Save to apply.");
  } catch (err) {
    showToast("Image error: " + err.message, true);
  }
});

// Drag & drop
const heroDropZone = document.getElementById("heroDropZone");
heroDropZone.addEventListener("dragover", (e) => { e.preventDefault(); heroDropZone.classList.add("dragover"); });
heroDropZone.addEventListener("dragleave", () => heroDropZone.classList.remove("dragover"));
heroDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  heroDropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    const dt = new DataTransfer();
    dt.items.add(file);
    heroInput.files = dt.files;
    heroInput.dispatchEvent(new Event("change"));
  }
});

// ── 3. Ribbon preview + word count ────────────────────────────

// ── Tags render ────────────────────────────────────────────────
function renderTags() {
  tagBox.querySelectorAll(".tag-chip").forEach(el => el.remove());
  ribbonTags.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${tag}<button class="tag-chip-remove" data-i="${i}" title="Remove">✕</button>`;
    tagBox.insertBefore(chip, tagInput);
  });
  wordCount.textContent = `${ribbonTags.length} / ${MAX_TAGS}`;
  wordCount.classList.toggle("over", ribbonTags.length >= MAX_TAGS);
  tagHint.classList.toggle("at-limit", ribbonTags.length >= MAX_TAGS);
  tagInput.style.display = ribbonTags.length >= MAX_TAGS ? "none" : "";
  updateRibbonPreview();
}

function addTag(val) {
  const trimmed = val.trim();
  if (!trimmed || ribbonTags.length >= MAX_TAGS) return;
  ribbonTags.push(trimmed);
  tagInput.value = "";
  renderTags();
}

tagBox.addEventListener("click", () => tagInput.focus());

tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTag(tagInput.value.replace(/,$/, ""));
  }
  if (e.key === "Backspace" && tagInput.value === "" && ribbonTags.length) {
    ribbonTags.pop();
    renderTags();
  }
});

tagInput.addEventListener("blur", () => {
  if (tagInput.value.trim()) addTag(tagInput.value);
});

tagBox.addEventListener("click", (e) => {
  const btn = e.target.closest(".tag-chip-remove");
  if (!btn) return;
  ribbonTags.splice(Number(btn.dataset.i), 1);
  renderTags();
});

// ── Ribbon preview ─────────────────────────────────────────────
function updateRibbonPreview() {
  if (!ribbonTags.length) {
    ribbonItemsEl.innerHTML = `<span class="ribbon-item"><span class="ribbon-sep">✦</span> Add items above to see preview</span>`;
    return;
  }
  const doubled = [...ribbonTags, ...ribbonTags];
  ribbonItemsEl.innerHTML = doubled
    .map(i => `<span class="ribbon-item"><span class="ribbon-sep">✦</span> ${i}</span>`)
    .join("");
}

// ── 4. Save ────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  // Validation
  if (!currentHeroBase64) {
    showToast("Please upload a hero image first", true);
    return;
  }
 if (!ribbonTags.length) { showToast("Please add at least one ribbon item", true); return; }
  if (!restaurantId) {
    showToast("Restaurant ID not found, please log out and sign in again", true);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    await updateDoc(doc(db, "restaurants", restaurantId), {
      item1: currentHeroBase64,
     item_names: ribbonTags.join(", "),
      sync: true
    });
    showToast("Front Screen saved successfully! ✅");
  } catch (err) {
    showToast("Save failed: " + err.message, true);
    console.error("Firestore save error:", err);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Everything`;
  }
});