import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast
} from "./firebase.js";

import {
  doc, getDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ─────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ────────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo + brandColor realtime ─────────────────────────────────────────────────
function showLogoPreview(src) {
  const preview = document.getElementById("logoPreview");
  const icon    = document.getElementById("logoIcon");
  preview.src           = src;
  preview.style.display = "block";
  icon.style.display    = "none";
}

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

// ── State ──────────────────────────────────────────────────────────────────────
let currentSavedLayout = null; // Firebase mein jo save hai
let selectedLayout     = null; // User ne abhi kya select kiya

// ── DOM refs ───────────────────────────────────────────────────────────────────
const cardClassic  = document.getElementById("card-classic");
const cardSingle   = document.getElementById("card-single");
const radioClassic = document.getElementById("radio-classic");
const radioSingle  = document.getElementById("radio-single");
const chipClassic  = document.getElementById("chip-classic");
const chipSingle   = document.getElementById("chip-single");
const saveBtn      = document.getElementById("saveLayoutBtn");
const saveHint     = document.getElementById("saveHint");
const statusText   = document.getElementById("statusText");

// ── Load current layout from Firebase ─────────────────────────────────────────
async function loadCurrentLayout() {
  if (!restaurantId) return;
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId));
    if (snap.exists()) {
      const data = snap.data();
      currentSavedLayout = data.kioskLayout || null;
    } else {
      currentSavedLayout = null;
    }
  } catch (e) {
    currentSavedLayout = null;
  }
  renderUI();
}

// ── Render UI based on state ───────────────────────────────────────────────────
function renderUI() {
  // Status bar update
  if (currentSavedLayout === "classic") {
    statusText.textContent = "Active layout: Classic Layout";
  } else if (currentSavedLayout === "single_window") {
    statusText.textContent = "Active layout: Single Window";
  } else {
   statusText.textContent = "No layout is currently set";

  }

  // Reset all cards
  cardClassic.classList.remove("selected", "selected-blue");
  cardSingle.classList.remove("selected", "selected-blue");
  radioClassic.classList.remove("checked");
  radioSingle.classList.remove("checked");
  chipClassic.style.display = "none";
  chipSingle.style.display  = "none";

  // Show "Currently Active" chip for saved layout
  if (currentSavedLayout === "classic") {
    chipClassic.style.display = "inline-flex";
  } else if (currentSavedLayout === "single_window") {
    chipSingle.style.display = "inline-flex";
  }

  // Show selected state (user's current choice)
  if (selectedLayout === "classic") {
    cardClassic.classList.add("selected");
    radioClassic.classList.add("checked");
  } else if (selectedLayout === "single_window") {
    cardSingle.classList.add("selected-blue");
    radioSingle.classList.add("checked");
  }

  // Save button state
  if (selectedLayout && selectedLayout !== currentSavedLayout) {
    saveBtn.disabled = false;
   saveHint.textContent = selectedLayout === "classic"
  ? "Classic Layout selected"
  : "Single Window selected";

  } else if (selectedLayout && selectedLayout === currentSavedLayout) {
    saveBtn.disabled = true;
   saveHint.textContent = "This layout is already active";
  } else {
    saveBtn.disabled = true;
   saveHint.textContent = "Please select a layout first";
  }
}

// ── Card click handlers ────────────────────────────────────────────────────────
cardClassic.addEventListener("click", () => {
  selectedLayout = "classic";
  renderUI();
});

cardSingle.addEventListener("click", () => {
  selectedLayout = "single_window";
  renderUI();
});

// ── Save layout to Firebase ────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  if (!selectedLayout || !restaurantId) return;

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    await updateDoc(doc(db, "restaurants", restaurantId), {
      kioskLayout: selectedLayout
    });

    currentSavedLayout = selectedLayout;
    const layoutName = selectedLayout === "classic" ? "Classic Layout" : "Single Window";
    showToast(`${layoutName} saved successfully! ✅`);
    renderUI();

  } catch (err) {
   showToast("Failed to save: " + err.message, true);
    saveBtn.disabled = false;
  } finally {
    saveBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Layout`;
  }
});

// ── Kitchen receipt toggle ─────────────────────────────────────────────────────
const receiptToggle = document.getElementById("receiptToggle");
const receiptTrack  = document.getElementById("receiptTrack");
const receiptThumb  = document.getElementById("receiptThumb");

function updateReceiptToggleUI(enabled) {
  receiptTrack.style.background = enabled ? "#16A34A" : "var(--border2)";
  receiptThumb.style.transform  = enabled ? "translateX(24px)" : "translateX(0)";
}

// Load current value
if (restaurantId) {
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId));
    if (snap.exists()) {
      const val = snap.data().kreceipt === true;
      receiptToggle.checked = val;
      updateReceiptToggleUI(val);
    }
  } catch (_) {}
}

receiptToggle.addEventListener("change", async () => {
  const enabled = receiptToggle.checked;
  updateReceiptToggleUI(enabled);
  try {
    await updateDoc(doc(db, "restaurants", restaurantId), { kreceipt: enabled });
    showToast(enabled ? "Kitchen receipt enabled ✅" : "Kitchen receipt disabled");
  } catch (err) {
    showToast("Failed: " + err.message, true);
    receiptToggle.checked = !enabled;
    updateReceiptToggleUI(!enabled);
  }
});

// ── Init ───────────────────────────────────────────────────────────────────────
await loadCurrentLayout();