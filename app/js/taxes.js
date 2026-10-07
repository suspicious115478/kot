import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  doc, getDoc, setDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();

document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo + brand color (sidebar) ─────────────────────────────────────────────
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.logo) {
      const preview = document.getElementById("logoPreview");
      const icon    = document.getElementById("logoIcon");
      preview.src = data.logo; preview.style.display = "block"; icon.style.display = "none";
    }
    if (data.brandColor) {
      const dot = document.getElementById("colorDot");
      if (dot) dot.style.background = data.brandColor;
    }
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let serviceType  = "percent";
let packingType  = "percent";
let otherCharges = [];

// ── Taxes doc reference ───────────────────────────────────────────────────────
const taxesDocRef = () => doc(db, "restaurants", restaurantId, "taxes", "config");

// ── Service charge type pills ─────────────────────────────────────────────────
document.querySelectorAll(".type-pill[data-target='service']").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".type-pill[data-target='service']")
      .forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    serviceType = btn.dataset.type;
    document.getElementById("serviceUnit").textContent =
      serviceType === "percent" ? "%" : "₹";
    document.getElementById("serviceValueLabel").textContent =
      serviceType === "percent" ? "Service Charge %" : "Service Charge (₹)";
  });
});

// ── Packing charge type pills ─────────────────────────────────────────────────
document.querySelectorAll(".type-pill[data-target='packing']").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".type-pill[data-target='packing']")
      .forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    packingType = btn.dataset.type;
    document.getElementById("packingUnit").textContent =
      packingType === "percent" ? "%" : "₹";
    document.getElementById("packingValueLabel").textContent =
      packingType === "percent" ? "Packing Charge %" : "Packing Charge (₹)";
  });
});

// ── Service charge toggle ─────────────────────────────────────────────────────
const serviceToggle = document.getElementById("serviceEnabled");
const serviceFields = document.getElementById("serviceFields");
serviceToggle.addEventListener("change", () => {
  serviceFields.classList.toggle("open", serviceToggle.checked);
});

// ── Packing charge toggle ─────────────────────────────────────────────────────
const packingToggle = document.getElementById("packingEnabled");
const packingFields = document.getElementById("packingFields");
packingToggle.addEventListener("change", () => {
  packingFields.classList.toggle("open", packingToggle.checked);
});

// ── Other charges ─────────────────────────────────────────────────────────────
function renderOtherCharges() {
  const list = document.getElementById("otherChargesList");
  list.innerHTML = "";

  if (!otherCharges.length) {
    list.innerHTML = `<div class="other-charges-empty">No additional charges — click "Add Charge" to add one</div>`;
    return;
  }

  otherCharges.forEach((charge, idx) => {
    const row = document.createElement("div");
    row.className = "other-charge-row" + (charge.enabled === false ? " oc-disabled" : "");

    // ── Enable toggle ──
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-switch";
    toggleLabel.innerHTML = `
      <input type="checkbox" ${charge.enabled !== false ? "checked" : ""} />
      <span class="toggle-track"><span class="toggle-thumb"></span></span>`;
    toggleLabel.querySelector("input").addEventListener("change", (e) => {
      otherCharges[idx].enabled = e.target.checked;
      row.classList.toggle("oc-disabled", !e.target.checked);
    });

    // ── Name input ──
    const nameInput = document.createElement("input");
    nameInput.type        = "text";
    nameInput.className   = "other-charge-name";
    nameInput.placeholder = "Charge name (e.g. Packaging)";
    nameInput.value       = charge.name;
    nameInput.addEventListener("input", () => { otherCharges[idx].name = nameInput.value; });

    // ── Type pills ──
    const pillsWrap = document.createElement("div");
    pillsWrap.className = "other-charge-pills";
    ["percent", "flat"].forEach(type => {
      const pill = document.createElement("button");
      pill.className   = "type-pill" + (charge.type === type ? " active" : "");
      pill.textContent = type === "percent" ? "%" : "₹";
      pill.addEventListener("click", () => {
        otherCharges[idx].type = type;
        unitSpan.textContent   = type === "percent" ? "%" : "₹";
        pillsWrap.querySelectorAll(".type-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
      });
      pillsWrap.appendChild(pill);
    });

    // ── Value input ──
    const valueWrap  = document.createElement("div");
    valueWrap.className = "tax-input-wrap";
    const valueInput = document.createElement("input");
    valueInput.type        = "number";
    valueInput.className   = "tax-input";
    valueInput.min         = "0";
    valueInput.step        = "0.1";
    valueInput.placeholder = "0";
    valueInput.value       = charge.value ?? "";
    valueInput.addEventListener("input", () => {
      otherCharges[idx].value = parseFloat(valueInput.value) || 0;
    });
    const unitSpan       = document.createElement("span");
    unitSpan.className   = "tax-input-unit";
    unitSpan.textContent = charge.type === "percent" ? "%" : "₹";
    valueWrap.appendChild(valueInput);
    valueWrap.appendChild(unitSpan);

    // ── Delete button ──
    const delBtn     = document.createElement("button");
    delBtn.className = "other-charge-delete";
    delBtn.title     = "Remove";
    delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    delBtn.addEventListener("click", () => {
      otherCharges.splice(idx, 1);
      renderOtherCharges();
    });

    row.appendChild(toggleLabel);
    row.appendChild(nameInput);
    row.appendChild(pillsWrap);
    row.appendChild(valueWrap);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

document.getElementById("addChargeBtn").addEventListener("click", () => {
  otherCharges.push({ id: Date.now().toString(), name: "", type: "flat", value: 0, enabled: true });
  renderOtherCharges();
});

// ── Load from Firestore ───────────────────────────────────────────────────────
async function loadTaxes() {
  if (!restaurantId) return;
  try {
    const snap = await getDoc(taxesDocRef());
    if (!snap.exists()) return;
    const taxes = snap.data();

    if (taxes.tax !== undefined)
      document.getElementById("taxPercent").value = taxes.tax;

    if (taxes.serviceCharge) {
      const sc = taxes.serviceCharge;
      serviceToggle.checked = sc.enabled || false;
      serviceFields.classList.toggle("open", sc.enabled);
      serviceType = sc.type || "percent";
      document.querySelectorAll(".type-pill[data-target='service']").forEach(b => {
        b.classList.toggle("active", b.dataset.type === serviceType);
      });
      document.getElementById("serviceUnit").textContent       = serviceType === "percent" ? "%" : "₹";
      document.getElementById("serviceValueLabel").textContent =
        serviceType === "percent" ? "Service Charge %" : "Service Charge (₹)";
      document.getElementById("serviceValue").value = sc.value ?? "";
    }

    if (taxes.packingCharge) {
      const pc = taxes.packingCharge;
      packingToggle.checked = pc.enabled || false;
      packingFields.classList.toggle("open", pc.enabled);
      packingType = pc.type || "percent";
      document.querySelectorAll(".type-pill[data-target='packing']").forEach(b => {
        b.classList.toggle("active", b.dataset.type === packingType);
      });
      document.getElementById("packingUnit").textContent       = packingType === "percent" ? "%" : "₹";
      document.getElementById("packingValueLabel").textContent =
        packingType === "percent" ? "Packing Charge %" : "Packing Charge (₹)";
      document.getElementById("packingValue").value = pc.value ?? "";
    }

    if (Array.isArray(taxes.otherCharges)) {
      otherCharges = taxes.otherCharges.map(c => ({
        ...c,
        id:      c.id || Date.now().toString(),
        enabled: c.enabled !== false
      }));
      renderOtherCharges();
    }

  } catch (err) {
    showToast("Load failed: " + err.message, true);
  }
}

// ── Save to Firestore ─────────────────────────────────────────────────────────
document.getElementById("saveBtn").addEventListener("click", async () => {
  const saveBtn  = document.getElementById("saveBtn");
  const saveHint = document.getElementById("saveHint");
  // ── Validation ────────────────────────────────────────────────
const taxVal = parseFloat(document.getElementById("taxPercent").value);
if (isNaN(taxVal) || taxVal < 0 || taxVal > 100) {
  showToast("Tax % must be between 0 and 100", true); return;
}
if (serviceToggle.checked) {
  const sv = parseFloat(document.getElementById("serviceValue").value);
  if (isNaN(sv) || sv <= 0) {
    showToast("Service charge value must be greater than 0", true); return;
  }
  if (serviceType === "percent" && sv > 100) {
    showToast("Service charge % cannot exceed 100", true); return;
  }
}
if (packingToggle.checked) {
  const pv = parseFloat(document.getElementById("packingValue").value);
  if (isNaN(pv) || pv <= 0) {
    showToast("Packing charge value must be greater than 0", true); return;
  }
  if (packingType === "percent" && pv > 100) {
    showToast("Packing charge % cannot exceed 100", true); return;
  }
}
for (let i = 0; i < otherCharges.length; i++) {
  const oc = otherCharges[i];
  if (!oc.name.trim()) {
    showToast(`Other charge #${i + 1}: name cannot be empty`, true); return;
  }
  if (isNaN(oc.value) || oc.value <= 0) {
    showToast(`"${oc.name || `Charge #${i+1}`}": value must be > 0`, true); return;
  }
  if (oc.type === "percent" && oc.value > 100) {
    showToast(`"${oc.name}": % cannot exceed 100`, true); return;
  }
}
// ── End Validation ────────────────────────────────────────────
  saveBtn.disabled     = true;
  saveBtn.textContent  = "Saving...";
  saveHint.textContent = "";

  const taxData = {
    tax: parseFloat(document.getElementById("taxPercent").value) || 0,
    serviceCharge: {
      enabled: serviceToggle.checked,
      type:    serviceType,
      value:   parseFloat(document.getElementById("serviceValue").value) || 0,
    },
    packingCharge: {
      enabled: packingToggle.checked,
      type:    packingType,
      value:   parseFloat(document.getElementById("packingValue").value) || 0,
    },
    otherCharges: otherCharges
      .map(c => ({
        id:      c.id,
        name:    c.name.trim(),
        type:    c.type,
        value:   c.value   || 0,
        enabled: c.enabled !== false,
      }))
      .filter(c => c.name !== ""),
  };

  try {
    await setDoc(taxesDocRef(), taxData, { merge: true });
    saveHint.textContent = "✓ Saved successfully";
   showToast("Taxes saved successfully! ✅");
    setTimeout(() => { saveHint.textContent = ""; }, 3000);
  } catch (err) {
    showToast("Save failed: " + err.message, true);
  }

  saveBtn.textContent = "Save All Changes";
  saveBtn.disabled    = false;
});

// ── Init ──────────────────────────────────────────────────────────────────────
await loadTaxes();
renderOtherCharges()