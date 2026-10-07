import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast
} from "./firebase.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ───────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo + brand color ────────────────────────────────────────────────────────
const restDoc = await getDoc(doc(db, "restaurants", restaurantId));
if (restDoc.exists()) {
  const data = restDoc.data();
  if (data.logo) {
    const preview = document.getElementById("logoPreview");
    const icon    = document.getElementById("logoIcon");
    preview.src = data.logo; preview.style.display = "block"; icon.style.display = "none";
  }
  if (data.brandColor) {
    const dot = document.getElementById("colorDot");
    if (dot) dot.style.background = data.brandColor;
  }
}

// ── Elements ──────────────────────────────────────────────────────────────────
const keyIdInput     = document.getElementById("keyId");
const keySecretInput = document.getElementById("keySecret");
const upiIdInput     = document.getElementById("upiId");
const saveBtn        = document.getElementById("saveBtn");
const testBtn        = document.getElementById("testBtn");
const clearBtn       = document.getElementById("clearBtn");
const toggleSecret   = document.getElementById("toggleSecret");
const testModeBtn    = document.getElementById("testModeBtn");
const liveModeBtn    = document.getElementById("liveModeBtn");
const modeBadge      = document.getElementById("modeBadge");
const liveWarning    = document.getElementById("liveWarning");
const keyIdHint      = document.getElementById("keyIdHint");
const statusBadge    = document.getElementById("statusBadge");
const displayKeyId   = document.getElementById("displayKeyId");
const displaySecret  = document.getElementById("displaySecret");
const displayUpi     = document.getElementById("displayUpi");
const displayMode    = document.getElementById("displayMode");
const displayUpdated = document.getElementById("displayUpdated");

let currentMode = "test"; // "test" | "live"

// ── Mode toggle ───────────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;

  testModeBtn.classList.toggle("active", mode === "test");
  liveModeBtn.classList.toggle("active", mode === "live");

  if (mode === "test") {
    modeBadge.textContent = "Test Mode";
    modeBadge.classList.remove("live");
    liveWarning.style.display = "none";
    keyIdHint.textContent = "starts with rzp_test_";
    keyIdInput.placeholder = "rzp_test_xxxxxxxxxxxx";
  } else {
    modeBadge.textContent = "Live Mode";
    modeBadge.classList.add("live");
    liveWarning.style.display = "flex";
    keyIdHint.textContent = "starts with rzp_live_";
    keyIdInput.placeholder = "rzp_live_xxxxxxxxxxxx";
  }
}

testModeBtn.addEventListener("click", () => setMode("test"));
liveModeBtn.addEventListener("click", () => setMode("live"));

// ── Show/hide secret ──────────────────────────────────────────────────────────
toggleSecret.addEventListener("click", () => {
  const isPassword = keySecretInput.type === "password";
  keySecretInput.type = isPassword ? "text" : "password";
  document.getElementById("eyeIcon").style.opacity = isPassword ? "0.4" : "1";
});

// ── Load existing keys from Firestore ─────────────────────────────────────────
async function loadSavedKeys() {
  try {
    const snap = await getDoc(
      doc(db, "restaurants", restaurantId, "settings", "razorpay")
    );

    if (!snap.exists()) {
      updateStatusCard(null);
      return;
    }

    const data = snap.data();
    updateStatusCard(data);

    // Pre-fill form
    if (data.keyId)  keyIdInput.value  = data.keyId;
    if (data.upiId)  upiIdInput.value  = data.upiId;
    if (data.mode)   setMode(data.mode);

    // Secret — show masked placeholder if saved
    if (data.hasSecret) {
      keySecretInput.placeholder = "••••••••• (saved — enter new to change)";
    }

    // Show test connection button if keys exist
    testBtn.style.display = "flex";

  } catch (err) {
    console.error("Load error:", err);
  }
}

function updateStatusCard(data) {
  if (!data || !data.keyId) {
    statusBadge.textContent = "Not Connected";
    statusBadge.className   = "status-badge disconnected";
    displayKeyId.textContent   = "—";
    displaySecret.textContent  = "—";
    displayUpi.textContent     = "—";
    displayMode.textContent    = "—";
    displayUpdated.textContent = "—";
    return;
  }

  statusBadge.textContent = "Connected";
  statusBadge.className   = "status-badge connected";

  // Mask key_id — show first 12 chars + ***
  displayKeyId.textContent = data.keyId
    ? data.keyId.substring(0, 14) + "••••••"
    : "—";

  displaySecret.textContent = data.hasSecret ? "••••••••••••••••" : "—";
  displayUpi.textContent    = data.upiId || "—";
  displayMode.textContent   = data.mode === "live" ? "🟢 Live" : "🟡 Test";

  if (data.updatedAt?.toDate) {
    displayUpdated.textContent = data.updatedAt.toDate().toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } else {
    displayUpdated.textContent = "—";
  }
}

await loadSavedKeys();

// ── Save keys ─────────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  const keyId     = keyIdInput.value.trim();
  const keySecret = keySecretInput.value.trim();
  const upiId     = upiIdInput.value.trim();

  // Validation
  if (!keyId) {
   showToast("Key ID is required", true); return;
  }
  if (currentMode === "test" && !keyId.startsWith("rzp_test_")) {
     showToast("In test mode, Key ID must start with rzp_test_", true);return;
  }
  if (currentMode === "live" && !keyId.startsWith("rzp_live_")) {
   showToast("In live mode, Key ID must start with rzp_live_", true); return;
  }
  if (!upiId) {
   showToast("UPI ID (VPA) is required", true); return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner"></span> Saving...`;

  try {
    const payload = {
      keyId,
      upiId,
      mode:      currentMode,
      updatedAt: serverTimestamp(),
      hasSecret: false,
    };

    // Sirf agar naya secret enter kiya ho tab save karo
    if (keySecret && keySecret.length > 0) {
      payload.keySecret = keySecret;
      payload.hasSecret = true;
    }

    await setDoc(
      doc(db, "restaurants", restaurantId, "settings", "razorpay"),
      payload,
      { merge: true }
    );

  showToast("Payment settings saved successfully! ✅");
    keySecretInput.value = "";
    keySecretInput.placeholder = "••••••••• (saved — enter new to change)";
    testBtn.style.display = "flex";

    // Refresh status
    const snap = await getDoc(
      doc(db, "restaurants", restaurantId, "settings", "razorpay")
    );
    updateStatusCard(snap.data());

  } catch (err) {
    showToast("Save failed: " + err.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Keys`;
  }
});

// ── Test connection ───────────────────────────────────────────────────────────
// Sirf key_id validate karte hain — key_secret server pe hi test ho sakti hai
// Client side pe hum sirf format check karte hain
testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  testBtn.innerHTML = `<span class="spinner-green"></span> Testing...`;

  try {
    const snap = await getDoc(
      doc(db, "restaurants", restaurantId, "settings", "razorpay")
    );

    if (!snap.exists() || !snap.data().keyId) {
    showToast("Please save the keys first", true);
      return;
    }

    const { keyId, mode } = snap.data();
    const isValidFormat = mode === "test"
      ? keyId.startsWith("rzp_test_")
      : keyId.startsWith("rzp_live_");

    if (!isValidFormat) {
   showToast(`Invalid Key ID format — it must start with rzp_${mode}_ for ${mode} mode`, true);
      return;
    }

    // Format valid hai
  showToast(`✅ Key ID format is valid (${mode} mode). Full verification requires a test order.`);

  } catch (err) {
    showToast("Test failed: " + err.message, true);
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      Test Connection`;
  }
});

// ── Clear keys ────────────────────────────────────────────────────────────────
clearBtn.addEventListener("click", async () => {
  const confirmed = confirm("Are you sure you want to delete the payment keys? Payments will be disabled on the kiosk.");
  if (!confirmed) return;

  try {
    await setDoc(
      doc(db, "restaurants", restaurantId, "settings", "razorpay"),
      {}  // empty document
    );
    keyIdInput.value     = "";
    keySecretInput.value = "";
    upiIdInput.value     = "";
    keySecretInput.placeholder = "••••••••••••••••••••";
    testBtn.style.display = "none";
    updateStatusCard(null);
   showToast("Keys deleted successfully");
  } catch (err) {
   showToast("Delete failed: " + err.message, true);
  }
});