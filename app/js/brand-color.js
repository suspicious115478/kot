import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  doc, updateDoc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const name = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

const restaurantId = await getRestaurantId();

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_COLOR = "#FF5F1F";

// ── State ─────────────────────────────────────────────────────────────────────
let currentHex = DEFAULT_COLOR;
let brightness = 1.0;
let currentFrontHex = DEFAULT_COLOR;
let activeTarget = "brand"; // "brand" | "front"

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS = [
  "#FF5F1F","#FF6B35","#E53935","#E91E8C","#8B5CF6","#2196F3",
  "#00BCD4","#4CAF50","#8BC34A","#FFC107","#FF9800","#795548",
  "#F06292","#26C6DA","#66BB6A","#FFCA28","#EF5350","#AB47BC",
  "#42A5F5","#26A69A","#D4E157","#FF7043","#5C6BC0","#FFFFFF",
];

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("colorCanvas");
const ctx    = canvas.getContext("2d");
const SIZE   = canvas.width;
const CX     = SIZE / 2;
const CY     = SIZE / 2;
const RADIUS = SIZE / 2 - 4;

function drawWheel() {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const imageData = ctx.createImageData(SIZE, SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx   = x - CX;
      const dy   = y - CY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) continue;

      const angle      = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const saturation = dist / RADIUS;
      const lightness  = brightness * 0.5;

      const [r, g, b] = hslToRgb(angle / 360, saturation, lightness);
      const idx = (y * SIZE + x) * 4;
      imageData.data[idx]     = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Circular clip
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function getColorAtPoint(x, y) {
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  return rgbToHex(pixel[0], pixel[1], pixel[2]);
}

// ── Cursor ────────────────────────────────────────────────────────────────────
const cursor = document.getElementById("wheelCursor");

function moveCursor(x, y, hex) {
  cursor.style.left    = x + "px";
  cursor.style.top     = y + "px";
  cursor.style.display = "block";
  cursor.style.background = hex;
}

// ── Apply color to UI ─────────────────────────────────────────────────────────
function applyColor(hex) {
  if (activeTarget === "brand") {
    currentHex = hex;
    document.getElementById("colorDot").style.background = hex;
  } else {
    currentFrontHex = hex;
  }

  const { r, g, b } = hexToRgb(hex);

  document.getElementById("swatchPreview").style.background = hex;
  document.getElementById("swatchHex").textContent = hex;
  document.getElementById("swatchRgb").textContent = `rgb(${r}, ${g}, ${b})`;
  document.getElementById("swatchBar").style.background = hex;
  document.getElementById("hexLiveDot").style.background = hex;

  const hexInput = document.getElementById("hexInput");
  if (document.activeElement !== hexInput) {
    hexInput.value = hex.replace("#", "");
  }

  // Brightness slider gradient
  const hue = rgbToHue(r, g, b);
  document.getElementById("brightnessSlider").style.background =
    `linear-gradient(to right, #000, hsl(${hue}, 100%, 50%))`;

  // Highlight active preset
  document.querySelectorAll(".preset-dot").forEach(dot => {
    dot.classList.toggle("active", dot.dataset.color.toUpperCase() === hex.toUpperCase());
  });
}



function rgbToHue(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return Math.round(h * 360);
}

// ── Canvas interaction ────────────────────────────────────────────────────────
function pickFromCanvas(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top)  * scaleY;
  const dx = x - CX, dy = y - CY;
  if (Math.sqrt(dx * dx + dy * dy) > RADIUS) return;

  const hex = getColorAtPoint(Math.round(x), Math.round(y));
  if (hex === "#000000" && Math.sqrt(dx * dx + dy * dy) < 2) return;

  moveCursor(clientX - rect.left, clientY - rect.top, hex);
  applyColor(hex);
}

let isDown = false;
canvas.addEventListener("mousedown",  (e) => { isDown = true; pickFromCanvas(e); });
canvas.addEventListener("mousemove",  (e) => { if (isDown) pickFromCanvas(e); });
canvas.addEventListener("mouseup",    ()  => { isDown = false; });
canvas.addEventListener("mouseleave", ()  => { isDown = false; });
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); pickFromCanvas(e); }, { passive: false });
canvas.addEventListener("touchmove",  (e) => { e.preventDefault(); pickFromCanvas(e); }, { passive: false });

// ── Brightness slider ─────────────────────────────────────────────────────────
document.getElementById("brightnessSlider").addEventListener("input", (e) => {
  brightness = e.target.value / 100;
  document.getElementById("brightnessVal").textContent = e.target.value + "%";
  drawWheel();
  applyColor(currentHex);
});

// ── Hex manual input ──────────────────────────────────────────────────────────
document.getElementById("hexInput").addEventListener("input", (e) => {
  let val = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
  e.target.value = val;
  if (val.length === 6) applyColor("#" + val.toUpperCase());
});



// ── Presets ───────────────────────────────────────────────────────────────────
const presetGrid = document.getElementById("presetGrid");
PRESETS.forEach(color => {
  const dot = document.createElement("div");
  dot.className     = "preset-dot";
  dot.dataset.color = color;
  dot.style.background = color;
  dot.title = color;
  dot.addEventListener("click", () => applyColor(color));
  presetGrid.appendChild(dot);
});

// ── Default color button ──────────────────────────────────────────────────────
document.getElementById("defaultColorBtn").addEventListener("click", () => {
  applyColor(DEFAULT_COLOR);
  showToast(`Default color restored: ${DEFAULT_COLOR}`);
});

// ── Target toggle (Brand / Front Screen) ──────────────────────────────────────
document.querySelectorAll(".toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeTarget = btn.dataset.target;
    document.getElementById("hexCardLabel").textContent =
      activeTarget === "brand" ? "Hex Code (Brand Color)" : "Hex Code (Front Screen Color)";
    applyColor(activeTarget === "brand" ? currentHex : currentFrontHex);
  });
});



// ── Load existing saved color ─────────────────────────────────────────────────
async function loadSavedColor() {
  if (!restaurantId) return;
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId));
    if (snap.exists()) {
      const data = snap.data();
      if (data.brandColor) {
        currentHex = data.brandColor;
        document.getElementById("colorDot").style.background = currentHex;
      }
      if (data.item1Color) {
        currentFrontHex = data.item1Color;
      }
      applyColor(activeTarget === "brand" ? currentHex : currentFrontHex);
    }
  } catch (_) {}
}

// ── Realtime restaurant doc (logo + brandColor) ───────────────────────────────
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.logo) {
      const preview = document.getElementById("logoPreview");
      const icon    = document.getElementById("logoIcon");
      preview.src           = data.logo;
      preview.style.display = "block";
      icon.style.display    = "none";
    }
    if (data.brandColor) {
      document.getElementById("colorDot").style.background = data.brandColor;
    }
  });
}

// ── Save to Firestore ─────────────────────────────────────────────────────────
document.getElementById("saveColorBtn").addEventListener("click", async () => {
  if (!restaurantId) return showToast("Restaurant not found", true);

  const btn = document.getElementById("saveColorBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    await updateDoc(doc(db, "restaurants", restaurantId), {
      brandColor: currentHex,
      item1Color: currentFrontHex
    });
   showToast(`Colors saved successfully! ✅`);
  } catch (err) {
    showToast("Failed to save: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save Brand Color`;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
drawWheel();
applyColor(DEFAULT_COLOR);
await loadSavedColor();