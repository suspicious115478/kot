import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, updateDoc, getDoc,
  onSnapshot, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ───────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();

document.getElementById("restaurantLabel").textContent = name || "My Restaurant";
if (restaurantId) {
  document.getElementById("statRestId").textContent =
    restaurantId.slice(0, 6).toUpperCase();
}

// ── Logo ──────────────────────────────────────────────────────────────────────
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

// ── Realtime listener — restaurant doc (logo + brandColor + live) ─────────────
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    // Logo
    if (data.logo) showLogoPreview(data.logo);

    // Brand color dot
    if (data.brandColor) {
      const dot = document.getElementById("colorDot");
      if (dot) dot.style.background = data.brandColor;
    }
  });
}

// ── Realtime listener — categories count ─────────────────────────────────────
if (restaurantId) {
  onSnapshot(
    collection(db, "restaurants", restaurantId, "categories"),
    async (catSnap) => {
      document.getElementById("statCategories").textContent = catSnap.size;
      updateItemCount(catSnap.docs.map(d => d.id));
    }
  );
}


// ── Sync button ───────────────────────────────────────────────────────────────
const syncBtn = document.getElementById("syncBtn");
if (syncBtn && restaurantId) {
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing...";
    try {
      await updateDoc(doc(db, "restaurants", restaurantId), { sync: true });
      syncBtn.textContent = "✓ Synced!";
      setTimeout(() => {
        syncBtn.textContent = "Sync Changes";
        syncBtn.disabled = false;
      }, 2000);
    } catch (err) {
      syncBtn.textContent = "Failed";
      showToast("Sync failed: " + err.message, true);
      setTimeout(() => {
        syncBtn.textContent = "Sync Changes";
        syncBtn.disabled = false;
      }, 2000);
    }
  });
}

// ── Per-category item count (realtime) ───────────────────────────────────────
let categoryUnsubs = [];
let itemCounts     = {};

async function updateItemCount(categoryIds) {
  if (!categoryIds.length) {
    document.getElementById("statItems").textContent = "0";
    return;
  }
  try {
    const counts = await Promise.all(
      categoryIds.map(id =>
        getCountFromServer(collection(db, "restaurants", restaurantId, "categories", id, "menu_items"))
      )
    );
    const total = counts.reduce((sum, c) => sum + c.data().count, 0);
    document.getElementById("statItems").textContent = total;
  } catch (err) {
    document.getElementById("statItems").textContent = "—";
  }
}