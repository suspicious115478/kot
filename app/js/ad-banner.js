import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  doc,
  updateDoc,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();

document.getElementById("logoutBtn")
  .addEventListener("click", handleLogout);

// ── Restaurant info ───────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();

const name = await getRestaurantName();

document.getElementById("restaurantLabel").textContent =
  name || "My Restaurant";

// ── Logo (sidebar chip) ───────────────────────────────────────────────────────
function showLogoPreview(src) {

  const preview = document.getElementById("logoPreview");

  const icon = document.getElementById("logoIcon");

  preview.src = src;

  preview.style.display = "block";

  icon.style.display = "none";
}

document.getElementById("logoInput")
  .addEventListener("change", async (e) => {

    const file = e.target.files[0];

    if (!file || !restaurantId) return;

    showToast("Uploading logo...");

    try {

      const base64 = await compressImage(file, 300);

      await updateDoc(
        doc(db, "restaurants", restaurantId),
        {
          logo: base64
        }
      );

      showLogoPreview(base64);

      showToast("Logo saved! ✅");

    } catch (err) {

      showToast(
        "Failed to save logo: " + err.message,
        true
      );
    }
  });

// ── Backend (S3 uploads yahin se hote hain) ────────────────────────────────────
const BACKEND_URL = "https://payment-server-1zt6.onrender.com";

// ── Banner slots state ──────────────────────────────────────────────────────────
const TOTAL_SLOTS = 6;
let bannerImages = new Array(TOTAL_SLOTS).fill(""); // url per slot, "" = khaali
let bannerIntervalSec = 3; // default 3 sec
const slotsGrid     = document.getElementById("bannerSlotsGrid");
const durationInput = document.getElementById("bannerDurationInput");

function extFromUrl(url) {
  const match = url.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1] : "jpg";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read error"));
    reader.onload  = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function renderSlots() {
  slotsGrid.innerHTML = "";
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const slotNum = i + 1;
    const url = bannerImages[i];
    const slotEl = document.createElement("div");
    slotEl.className = "banner-slot" + (url ? " filled" : "");

    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Banner " + slotNum;
      slotEl.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.className = "banner-slot-remove";
      removeBtn.type = "button";
      removeBtn.title = "Remove image";
      removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeSlot(slotNum);
      });
      slotEl.appendChild(removeBtn);
    } else {
      const empty = document.createElement("div");
      empty.className = "banner-slot-empty-icon";
      empty.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <span>Slot ${slotNum}</span>
      `;
      slotEl.appendChild(empty);
      slotEl.addEventListener("click", () => triggerSlotUpload(slotNum));
    }

    slotsGrid.appendChild(slotEl);
  }
}

function triggerSlotUpload(slotNum) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleSlotFile(slotNum, file);
  });
  input.click();
}

async function handleSlotFile(slotNum, file) {
  if (!restaurantId) return;

  if (file.size > 8 * 1024 * 1024) {
    showToast("Please use an image under 8MB.", true);
    return;
  }

  const slotIndex = slotNum - 1;
  const slotEl = slotsGrid.children[slotIndex];
  const overlay = document.createElement("div");
  overlay.className = "banner-slot-uploading";
  overlay.innerHTML = `<span class="spinner"></span>`;
  if (slotEl) slotEl.appendChild(overlay);

  try {
    const base64 = await fileToBase64(file);

    const res = await fetch(`${BACKEND_URL}/upload-banner-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, slot: slotNum, base64 })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || "Upload failed");

    bannerImages[slotIndex] = data.url;
    await saveBannerImages();
    showToast("Banner uploaded! 🎉");
  } catch (err) {
    showToast("Upload failed: " + err.message, true);
  } finally {
    renderSlots();
  }
}

async function removeSlot(slotNum) {
  if (!restaurantId) return;
  if (!confirm("Remove this banner image?")) return;

  const slotIndex = slotNum - 1;
  const url = bannerImages[slotIndex];
  if (!url) return;

  try {
    await fetch(`${BACKEND_URL}/delete-banner-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, slot: slotNum, ext: extFromUrl(url) })
    });
  } catch (err) {
    console.error("S3 delete failed:", err);
  }

  bannerImages[slotIndex] = "";
  await saveBannerImages();
  showToast("Banner removed.");
  renderSlots();
}

async function saveBannerImages() {
  await setDoc(
    doc(db, "restaurants", restaurantId, "settings", "adBanner"),
    { images: bannerImages, intervalSeconds: bannerIntervalSec, updatedAt: Date.now() },
    { merge: true }
  );
}

async function saveDuration() {
  if (!restaurantId) return;
  const val = parseInt(durationInput.value, 10);
  bannerIntervalSec = (!isNaN(val) && val > 0) ? val : 3;
  try {
    await setDoc(
      doc(db, "restaurants", restaurantId, "settings", "adBanner"),
      { intervalSeconds: bannerIntervalSec, updatedAt: Date.now() },
      { merge: true }
    );
    showToast("Slide duration saved! ⏱️");
  } catch (err) {
    showToast("Failed to save duration: " + err.message, true);
  }
}

if (durationInput) {
  durationInput.addEventListener("change", saveDuration);
}

renderSlots();

// ── Realtime listener — banner slots ────────────────────────────────────────────
if (restaurantId) {
  onSnapshot(
    doc(db, "restaurants", restaurantId, "settings", "adBanner"),
    (snap) => {
      if (!snap.exists()) {
        bannerImages = new Array(TOTAL_SLOTS).fill("");
        renderSlots();
        return;
      }
      const data = snap.data();
      if (Array.isArray(data.images)) {
        const next = new Array(TOTAL_SLOTS).fill("");
        for (let i = 0; i < TOTAL_SLOTS; i++) next[i] = data.images[i] || "";
        bannerImages = next;
      }
      if (typeof data.intervalSeconds === "number" && data.intervalSeconds > 0) {
        bannerIntervalSec = data.intervalSeconds;
        if (durationInput) durationInput.value = bannerIntervalSec;
      }
      renderSlots();
    }
  );
}


// ── Realtime restaurant data ─────────────────────────────────────────────────
if (restaurantId) {

  // logo + brand color
  onSnapshot(
    doc(db, "restaurants", restaurantId),
    (snap) => {

      if (!snap.exists()) return;

      const data = snap.data();

      // logo
      if (data.logo) {
        showLogoPreview(data.logo);
      }

      // brand color
      if (data.brandColor) {

        const dot =
          document.getElementById("colorDot");

        if (dot) {
          dot.style.background = data.brandColor;
        }
      }
    }
  );

}