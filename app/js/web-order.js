import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, addDoc, getDoc, getDocs,
  onSnapshot, updateDoc, query, orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();

// ── State ─────────────────────────────────────────────────────────────────────
let categories  = [];
let itemsBycat  = {};
let activeCatId = null;
let cart        = {};       // itemId → {name, price, qty, catId, catName}
let taxConfig   = null;
let orderType      = "DINE_IN";
let paymentMethod  = "CASH";

// ── Order type toggle ─────────────────────────────────────────────────────────
document.querySelectorAll(".ot-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ot-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    orderType = btn.dataset.type;
    renderBill();
  });
});

document.querySelectorAll(".pm-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pm-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    paymentMethod = btn.dataset.method;
  });
});

// ── Load tax config ───────────────────────────────────────────────────────────
async function loadTaxConfig() {
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId, "taxes", "config"));
    if (snap.exists()) taxConfig = snap.data();
  } catch (_) {}
}

// ── Load categories realtime ──────────────────────────────────────────────────
function loadCategories() {
  onSnapshot(
    query(collection(db, "restaurants", restaurantId, "categories")),
    (snap) => {
      categories = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.available !== false).sort((a, b) => a.name.localeCompare(b.name));
      renderCategoryList();
      if (categories.length && !activeCatId) {
        selectCategory(categories[0].id);
      }
      // Baaki sab categories background mein preload karo
      categories.forEach(cat => {
        if (!itemsBycat[cat.id]) preloadCategory(cat.id);
      });
    }
  );
}

function preloadCategory(catId) {
  onSnapshot(
    query(collection(db, "restaurants", restaurantId, "categories", catId, "menu_items")),
    (snap) => {
      itemsBycat[catId] = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
      if (activeCatId === catId) renderItems(catId);
    }
  );
}

function renderCategoryList() {
  const container = document.getElementById("categoryList");
  if (!categories.length) {
    container.innerHTML = `<div style="padding:16px;font-size:0.78rem;color:var(--muted);text-align:center;">No categories found</div>`;
    return;
  }
  container.innerHTML = categories.map(cat => `
    <div class="cat-item ${activeCatId === cat.id ? "active" : ""}" data-id="${cat.id}">
      <span class="cat-name">${cat.name}</span>
    </div>
  `).join("");

  container.querySelectorAll(".cat-item").forEach(el => {
    el.addEventListener("click", () => selectCategory(el.dataset.id));
  });
}

// ── Select category ───────────────────────────────────────────────────────────
function selectCategory(catId) {
  activeCatId = catId;
  renderCategoryList();

  const cat = categories.find(c => c.id === catId);
  document.getElementById("activeCatLabel").textContent = cat?.name || "Items";

  if (itemsBycat[catId]) { renderItems(catId); return; }

  document.getElementById("itemGrid").innerHTML = `
    <div class="items-placeholder">
      <span class="ph-icon">⏳</span>
      <span class="ph-text">Loading items...</span>
    </div>`;

  onSnapshot(
    query(
      collection(db, "restaurants", restaurantId, "categories", catId, "menu_items")
    ),
    (snap) => {
      itemsBycat[catId] = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
      if (activeCatId === catId) renderItems(catId);
    }
  );
}

// ── Render items (no image) ───────────────────────────────────────────────────
let _searchTerm = "";

document.getElementById("itemSearch").addEventListener("input", (e) => {
  _searchTerm = e.target.value.trim().toLowerCase();
  if (_searchTerm) {
    renderAllItems();
  } else {
    renderItems(activeCatId);
  }
});

function renderAllItems() {
  const grid = document.getElementById("itemGrid");
  document.getElementById("activeCatLabel").textContent = "Search Results";

  // Saari loaded categories ke items mein search karo
  let results = [];
  for (const [catId, items] of Object.entries(itemsBycat)) {
    const cat = categories.find(c => c.id === catId);
    results.push(...items
      .filter(i => i.name?.toLowerCase().includes(_searchTerm))
      .map(i => ({ ...i, _catId: catId, _catName: cat?.name || "" }))
    );
  }

  if (!results.length) {
    grid.innerHTML = `
      <div class="items-placeholder">
        <span class="ph-icon">🔍</span>
        <span class="ph-text">No items found for "${_searchTerm}"</span>
      </div>`;
    return;
  }

  grid.innerHTML = results.map(item => {
    const inCart  = cart[item.id] ? cart[item.id].qty : 0;
    const unavail = item.available === false;
    const price   = (item.discountedPrice > 0 && item.discountedPrice < item.price)
      ? item.discountedPrice : item.price;
    return `
      <div class="menu-item-card ${unavail ? "unavailable" : ""}" data-id="${item.id}" data-catid="${item._catId}" data-catname="${item._catName}">
        ${inCart > 0 ? `<div class="mic-qty-badge">×${inCart}</div>` : ""}
        <div class="mic-name">${item.name}</div>
        <div style="font-size:0.68rem;color:var(--muted);font-weight:500;">${item._catName}</div>
        ${unavail
          ? `<div class="mic-unavail-tag">Unavailable</div>`
          : `<div class="mic-price">₹${price}</div>`}
      </div>`;
  }).join("");

  grid.querySelectorAll(".menu-item-card:not(.unavailable)").forEach(card => {
    card.addEventListener("click", () => {
      const item = results.find(i => i.id === card.dataset.id);
      if (!item) return;
      const price = (item.discountedPrice > 0 && item.discountedPrice < item.price)
        ? item.discountedPrice : item.price;
      addToCart(item.id, item.name, price, item._catId, item._catName);
    });
  });
}

function renderItems(catId) {
  const grid = document.getElementById("itemGrid");
  if (!catId) return;

  const cat = categories.find(c => c.id === catId);
  document.getElementById("activeCatLabel").textContent = cat?.name || "Items";

  let items = itemsBycat[catId] || [];

  if (!items.length) {
    grid.innerHTML = `
      <div class="items-placeholder">
        <span class="ph-icon">🍽️</span>
        <span class="ph-text">${_searchTerm ? "No items match your search" : "No items in this category"}</span>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(item => {
    const inCart  = cart[item.id] ? cart[item.id].qty : 0;
    const unavail = item.available === false;
    const price   = (item.discountedPrice > 0 && item.discountedPrice < item.price)
      ? item.discountedPrice : item.price;
    return `
      <div class="menu-item-card ${unavail ? "unavailable" : ""}" data-id="${item.id}">
        ${inCart > 0 ? `<div class="mic-qty-badge">×${inCart}</div>` : ""}
        <div class="mic-name">${item.name}</div>
        ${unavail
          ? `<div class="mic-unavail-tag">Unavailable</div>`
          : `<div class="mic-price">₹${price}</div>`}
      </div>`;
  }).join("");

  grid.querySelectorAll(".menu-item-card:not(.unavailable)").forEach(card => {
    card.addEventListener("click", () => {
      const item = items.find(i => i.id === card.dataset.id);
      if (!item) return;
      const price = (item.discountedPrice > 0 && item.discountedPrice < item.price)
        ? item.discountedPrice : item.price;
      addToCart(item.id, item.name, price, catId, categories.find(c => c.id === catId)?.name || "");
    });
  });
}

// ── Cart logic ────────────────────────────────────────────────────────────────
function addToCart(id, name, price, catId, catName) {
  if (cart[id]) { cart[id].qty++; }
  else { cart[id] = { name, price, qty: 1, catId, catName }; }
  renderCart();
  renderItems(activeCatId);
}

function removeFromCart(id) {
  if (!cart[id]) return;
  cart[id].qty--;
  if (cart[id].qty <= 0) delete cart[id];
  renderCart();
  renderItems(activeCatId);
}

function removeAllFromCart(id) {
  delete cart[id];
  renderCart();
  renderItems(activeCatId);
}

// ── Render cart ───────────────────────────────────────────────────────────────
function renderCart() {
  const container = document.getElementById("cartItems");
  const badge     = document.getElementById("cartCountBadge");
  const entries   = Object.entries(cart);
  const totalQty  = entries.reduce((s, [, v]) => s + v.qty, 0);

  badge.style.display = totalQty > 0 ? "inline" : "none";
  badge.textContent   = totalQty;

  if (!entries.length) {
    container.innerHTML = `
      <div class="cart-empty">
        <span class="cart-empty-icon">🛒</span>
        <span>No items added yet</span>
      </div>`;
    document.getElementById("billSection").style.display = "none";
  document.getElementById("paymentToggleWrap").style.display = "none";
  document.getElementById("placeOrderBtn").disabled = true;
    return;
  }

  container.innerHTML = entries.map(([id, item]) => `
    <div class="cart-row" data-id="${id}">
      <div class="cr-name">
        ${item.name}
        <span>${item.catName}</span>
      </div>
      <div class="cr-stepper">
        <button class="cr-minus" data-id="${id}">−</button>
        <span class="cr-qty">${item.qty}</span>
        <button class="cr-plus" data-id="${id}">+</button>
      </div>
      <div class="cr-price">₹${(item.price * item.qty).toFixed(2)}</div>
      <button class="cr-remove" data-id="${id}" title="Remove">✕</button>
    </div>
  `).join("");

  container.querySelectorAll(".cr-plus").forEach(btn =>
    btn.addEventListener("click", () => {
      const i = cart[btn.dataset.id];
      addToCart(btn.dataset.id, i.name, i.price, i.catId, i.catName);
    })
  );
  container.querySelectorAll(".cr-minus").forEach(btn =>
    btn.addEventListener("click", () => removeFromCart(btn.dataset.id))
  );
  container.querySelectorAll(".cr-remove").forEach(btn =>
    btn.addEventListener("click", () => removeAllFromCart(btn.dataset.id))
  );

  document.getElementById("billSection").style.display = "flex";
  document.getElementById("paymentToggleWrap").style.display = "block";
  document.getElementById("placeOrderBtn").disabled = false;
  renderBill();
}

// ── Bill calc + render ────────────────────────────────────────────────────────
function calcAmounts() {
  const subtotal = Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);
  let taxAmt = 0, serviceAmt = 0, packingAmt = 0, otherTotal = 0;

  if (taxConfig) {
    taxAmt = subtotal * ((taxConfig.tax || 0) / 100);
    const sc = taxConfig.serviceCharge;
    if (sc?.enabled) serviceAmt = sc.type === "flat" ? sc.value : subtotal * (sc.value / 100);
    const pc = taxConfig.packingCharge;
    if (pc?.enabled && orderType === "TAKEAWAY")
      packingAmt = pc.type === "flat" ? pc.value : subtotal * (pc.value / 100);
    for (const oc of (taxConfig.otherCharges || [])) {
      if (!oc.enabled) continue;
      otherTotal += oc.type === "flat" ? oc.value : subtotal * (oc.value / 100);
    }
  }
  return { subtotal, taxAmt, serviceAmt, packingAmt, otherTotal, grandTotal: subtotal + taxAmt + serviceAmt + packingAmt + otherTotal };
}

function fmtAmt(n) { return "₹" + n.toFixed(2); }

function renderBill() {
  const { subtotal, taxAmt, serviceAmt, packingAmt, otherTotal, grandTotal } = calcAmounts();

  document.getElementById("billSubtotal").textContent = fmtAmt(subtotal);

  const taxRow = document.getElementById("billTaxRow");
  if (taxAmt > 0) {
    document.getElementById("billTaxLabel").textContent = `Tax (${taxConfig?.tax || 0}%)`;
    document.getElementById("billTaxAmt").textContent   = fmtAmt(taxAmt);
    taxRow.style.display = "flex";
  } else { taxRow.style.display = "none"; }

  const svcRow = document.getElementById("billServiceRow");
  if (serviceAmt > 0) {
    const sc = taxConfig?.serviceCharge;
    document.getElementById("billServiceLabel").textContent =
      sc?.type === "percent" ? `Service Charge (${sc.value}%)` : "Service Charge";
    document.getElementById("billServiceAmt").textContent = fmtAmt(serviceAmt);
    svcRow.style.display = "flex";
  } else { svcRow.style.display = "none"; }

  const pkgRow = document.getElementById("billPackingRow");
  if (packingAmt > 0) {
    const pc = taxConfig?.packingCharge;
    document.getElementById("billPackingLabel").textContent =
      pc?.type === "percent" ? `Packing Charge (${pc.value}%)` : "Packing Charge";
    document.getElementById("billPackingAmt").textContent = fmtAmt(packingAmt);
    pkgRow.style.display = "flex";
  } else { pkgRow.style.display = "none"; }

  const otherContainer = document.getElementById("billOtherRows");
  otherContainer.innerHTML = "";
  if (taxConfig) {
    const sub = Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);
    for (const oc of (taxConfig.otherCharges || [])) {
      if (!oc.enabled) continue;
      const amt = oc.type === "flat" ? oc.value : sub * (oc.value / 100);
      if (amt <= 0) continue;
      const label = oc.type === "percent" ? `${oc.name} (${oc.value}%)` : oc.name;
      otherContainer.innerHTML += `
        <div class="bill-row">
          <span>${label}</span><span>${fmtAmt(amt)}</span>
        </div>`;
    }
  }

  document.getElementById("billTotal").textContent = fmtAmt(grandTotal);
}

// ── Place order ───────────────────────────────────────────────────────────────
document.getElementById("placeOrderBtn").addEventListener("click", placeOrder);

async function placeOrder() {
  const entries = Object.entries(cart);
  if (!entries.length) return;

  const btn = document.getElementById("placeOrderBtn");
  btn.disabled = true;
  btn.textContent = "Placing order...";

  const { subtotal, taxAmt, serviceAmt, packingAmt, otherTotal, grandTotal } = calcAmounts();

  const itemsList = entries.map(([id, item]) => ({
    name: item.name, qty: item.qty, price: item.price, category: item.catName,
  }));

  try {
    const ordersRef = collection(db, "restaurants", restaurantId, "orders");
    const docRef    = await addDoc(ordersRef, {
      orderType,
      createdAt:     serverTimestamp(),
      status:        "NEW",
      paymentStatus: "SUCCESS",
      items:         itemsList,
      subtotal,
      tax:           taxAmt,
      service:       serviceAmt,
      packing:       packingAmt,
      other:         otherTotal,
      totalPrice:    grandTotal,
      source:        "WEB_ADMIN",
      paymentMethod,
    });

    await updateDoc(docRef, {
  orderId: docRef.id.slice(0, 6).toUpperCase()
});

    const placedId    = docRef.id;
const placedItems = [...itemsList]; // cart clear se pehle snapshot
const placedAmts  = { subtotal, taxAmt, serviceAmt, packingAmt, otherTotal, grandTotal };

showSuccessModal(placedId, grandTotal);
cart = {};
renderCart();
renderItems(activeCatId);

// Print — async, order flow block nahi karega
printReceipt(placedId, placedAmts, placedItems);
  } catch (err) {
    showToast("Failed to place order: " + err.message, true);
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Place Order`;
  }
}

// ── Success modal ─────────────────────────────────────────────────────────────
function showSuccessModal(orderId, total) {
  document.getElementById("modalOrderId").textContent = "Order #" + orderId.slice(0, 6).toUpperCase();
  document.getElementById("modalTotal").textContent   = "₹" + total.toFixed(2);
  document.getElementById("successModal").style.display = "flex";
}

document.getElementById("modalNewOrderBtn").addEventListener("click", () => {
  document.getElementById("successModal").style.display = "none";
  const btn = document.getElementById("placeOrderBtn");
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Place Order`;
});

document.getElementById("modalViewOrdersBtn").addEventListener("click", () => {
  window.location.href = "./orders.html";
});

// ── Init ──────────────────────────────────────────────────────────────────────
await loadTaxConfig();
loadCategories();

// Fullscreen on first user interaction
const enterFS = () => {
  document.documentElement.requestFullscreen?.();
  document.removeEventListener("click", enterFS);
  document.removeEventListener("keydown", enterFS);
};
document.addEventListener("click", enterFS);
document.addEventListener("keydown", enterFS);

// ── THERMAL PRINT via window.print() ─────────────────────────────────────────
// ── PRINT via Canvas Image — Sharp ESC/POS quality ───────────────────────────
// Koi server nahi chahiye — Canvas pe receipt draw karo, image print karo
function printReceipt(orderId, amounts, items) {
  const { subtotal, taxAmt, serviceAmt, packingAmt, grandTotal } = amounts;

  const now     = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true });
  const typeStr = orderType === "DINE_IN" ? "Dine In" : "Takeaway";
  const shortId = orderId.slice(0, 6).toUpperCase();

  // ── Canvas setup ───────────────────────────────────────────────────────────
  // 58mm printer = 384px width @ 203dpi
  // 80mm printer = 576px width @ 203dpi
  // SR588 = 80mm → 576px
  const PW       = 576;   // canvas width pixels
  const FONT     = "Courier New";
  const SCALE    = 2;     // 2x resolution — sharp text
  const CW       = PW * SCALE;

  // ── Measure total height first ─────────────────────────────────────────────
  // Ek dummy canvas pe measure karke height nikalo
  const dummy   = document.createElement("canvas");
  dummy.width   = CW;
  dummy.height  = 100;
  const dCtx    = dummy.getContext("2d");

  // Line heights
  const LINE_SM  = 22 * SCALE;   // small text
  const LINE_MD  = 26 * SCALE;   // normal text
  const LINE_LG  = 36 * SCALE;   // big text (restaurant name)
  const PAD      = 16 * SCALE;   // side padding
  const GAP      = 8  * SCALE;   // small gap

  // Calculate all lines
  const lines = buildLines(items, amounts, shortId, dateStr, timeStr, typeStr, dCtx, CW, PAD);
  const totalH = lines.reduce((s, l) => s + l.h, 0) + (60 * SCALE); // bottom margin

  // ── Real canvas ───────────────────────────────────────────────────────────
  const canvas  = document.createElement("canvas");
  canvas.width  = CW;
  canvas.height = totalH;
  const ctx     = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CW, totalH);

  // Draw all lines
  let y = 20 * SCALE;
  for (const line of lines) {
    drawLine(ctx, line, y, CW, PAD, FONT, SCALE);
    y += line.h;
  }

  // ── Convert to image and print ────────────────────────────────────────────
  const imgData = canvas.toDataURL("image/png");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#fff; }
  img {
    width: 48mm;
    display: block;
    margin: 0;
    image-rendering: crisp-edges;
    image-rendering: -webkit-optimize-contrast;
  }
  @media print {
    body { margin:0; padding:0; }
    img  { width:48mm; }
    @page {
      size: 58mm auto;
      margin: 0mm;
    }
  }
</style>
</head>
<body>
  <img src="${imgData}" />
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
        setTimeout(function(){ window.close(); }, 1000);
      }, 300);
    };
  <\/script>
</body>
</html>`;

  const popup = window.open("", "_blank", "width=420,height=700");
  if (!popup) {
    showToast("⚠️ Popup blocked! Browser settings mein popup allow karo.", true);
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

// ── Build all receipt lines as objects ────────────────────────────────────────
// ── Build all receipt lines as objects ────────────────────────────────────────
function buildLines(items, amounts, shortId, dateStr, timeStr, typeStr, dCtx, CW, PAD) {
  const { subtotal, taxAmt, serviceAmt, packingAmt, grandTotal } = amounts;
  const SCALE = 4;
  const lines = [];

  // Helper: wrap text into multiple lines based on max width
  const wrapText = (ctx, text, maxWidth, font) => {
    ctx.font = font;
    const words = String(text).split(" ");
    const out = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) out.push(cur);
    // Agar single word bhi maxWidth se bada hai, force-break karo
    const final = [];
    for (const line of out) {
      if (ctx.measureText(line).width > maxWidth) {
        let chunk = "";
        for (const ch of line) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            final.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        if (chunk) final.push(chunk);
      } else {
        final.push(line);
      }
    }
    return final.length ? final : [""];
  };

  const add = (type, data) => {
    if (type === "cols2" || type === "cols3") {
      const font = `${data.bold ? "bold " : ""}${data.size}px "Courier New"`;
      const c2Width = type === "cols2"
        ? dCtx.measureText(data.c2).width
        : dCtx.measureText(data.c2).width + dCtx.measureText(data.c3).width + (16 * SCALE);

      const c1MaxW = (CW - PAD * 2) - c2Width - (16 * SCALE);

      const c1Lines = wrapText(dCtx, data.c1, Math.max(c1MaxW, 20 * SCALE), font);
      data.c1Lines = c1Lines;

      // Har extra line ke liye height add karo
      const lineH = data.h;
      data.h = lineH * c1Lines.length;
    } else if (type === "text") {
      const font = `${data.bold ? "bold " : ""}${data.size}px "Courier New"`;
      const maxW = CW - PAD * 2;
      const wrapped = wrapText(dCtx, data.text, maxW, font);
      data.textLines = wrapped;
      if (wrapped.length > 1) {
        data.h = data.h * wrapped.length;
      }
    }
    lines.push({ type, ...data });
  };

  // Restaurant name — big bold center
  add("text", {
    text: (name || "RESTAURANT").toUpperCase(),
    size: 28 * SCALE, bold: true, align: "center",
    h: 38 * SCALE,
  });

  add("gap",  { h: 6 * SCALE });
  add("line", { h: 3 * SCALE, style: "solid" });
  add("gap",  { h: 8 * SCALE });

  // Order info
  add("text", { text: `Date  : ${dateStr}  ${timeStr}`, size: 17 * SCALE, align: "left", h: 24 * SCALE });
  add("text", { text: `Order : #${shortId}`,            size: 17 * SCALE, align: "left", h: 24 * SCALE });
  add("text", { text: `Type  : ${typeStr}`,             size: 17 * SCALE, align: "left", h: 24 * SCALE });
  add("text", { text: `Pay   : ${paymentMethod}`,       size: 17 * SCALE, align: "left", h: 24 * SCALE });

  add("gap",  { h: 6 * SCALE });
  add("line", { h: 2 * SCALE, style: "dashed" });
  add("gap",  { h: 6 * SCALE });

  // Items header
  add("cols3", {
    c1: "ITEM", c2: "QTY", c3: "AMOUNT",
    size: 17 * SCALE, bold: true, h: 26 * SCALE,
  });

  add("line", { h: 2 * SCALE, style: "dashed" });
  add("gap",  { h: 4 * SCALE });

  // Items — ab name truncate nahi karenge, wrap karenge
  for (const item of items) {
    const total = `Rs.${(item.price * item.qty).toFixed(2)}`;
    add("cols3", {
      c1: item.name, c2: `x${item.qty}`, c3: total,
      size: 17 * SCALE, bold: false, h: 25 * SCALE,
    });
  }

  add("gap",  { h: 4 * SCALE });
  add("line", { h: 2 * SCALE, style: "dashed" });
  add("gap",  { h: 6 * SCALE });

  // Bill breakdown — 2 col
  add("cols2", { c1: "Subtotal", c2: `Rs.${subtotal.toFixed(2)}`, size: 17 * SCALE, bold: false, h: 25 * SCALE });

  if (taxAmt > 0) {
    const taxPct = taxConfig?.tax || 0;
    add("cols2", { c1: `Tax (${taxPct}%)`, c2: `Rs.${taxAmt.toFixed(2)}`, size: 17 * SCALE, bold: false, h: 25 * SCALE });
  }
  if (serviceAmt > 0) {
    const sc  = taxConfig?.serviceCharge;
    const lbl = sc?.type === "percent" ? `Service (${sc.value}%)` : "Service Charge";
    add("cols2", { c1: lbl, c2: `Rs.${serviceAmt.toFixed(2)}`, size: 17 * SCALE, bold: false, h: 25 * SCALE });
  }
  if (packingAmt > 0) {
    const pc  = taxConfig?.packingCharge;
    const lbl = pc?.type === "percent" ? `Packing (${pc.value}%)` : "Packing Charge";
    add("cols2", { c1: lbl, c2: `Rs.${packingAmt.toFixed(2)}`, size: 17 * SCALE, bold: false, h: 25 * SCALE });
  }
  for (const oc of (taxConfig?.otherCharges || [])) {
    if (!oc.enabled) continue;
    const amt = oc.type === "flat" ? oc.value : subtotal * (oc.value / 100);
    if (amt <= 0) continue;
    const lbl = oc.type === "percent" ? `${oc.name} (${oc.value}%)` : oc.name;
    add("cols2", { c1: lbl, c2: `Rs.${amt.toFixed(2)}`, size: 17 * SCALE, bold: false, h: 25 * SCALE });
  }

  add("gap",  { h: 4 * SCALE });
  add("line", { h: 3 * SCALE, style: "solid" });
  add("gap",  { h: 8 * SCALE });

  // Grand total — BIG
  add("cols2", {
    c1: "TOTAL", c2: `Rs.${grandTotal.toFixed(2)}`,
    size: 26 * SCALE, bold: true, h: 38 * SCALE,
  });

  add("gap",  { h: 4 * SCALE });
  add("line", { h: 3 * SCALE, style: "solid" });
  add("gap",  { h: 14 * SCALE });

  // Footer
  add("text", { text: "Thank you! Visit again.", size: 17 * SCALE, align: "center", bold: false, h: 26 * SCALE });
  add("text", { text: "Powered by MenuAdmin",   size: 15 * SCALE, align: "center", bold: false, h: 24 * SCALE });

  // Feed space at bottom
  add("gap", { h: 40 * SCALE });

  return lines;
}

// ── Draw a single line onto canvas ────────────────────────────────────────────
function drawLine(ctx, line, y, CW, PAD, FONT, SCALE) {
  ctx.fillStyle = "#000000";

  if (line.type === "gap") return;

  if (line.type === "line") {
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth   = line.style === "solid" ? 2 * SCALE : 1 * SCALE;

    if (line.style === "dashed") {
      ctx.setLineDash([6 * SCALE, 4 * SCALE]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(PAD, y + line.h / 2);
    ctx.lineTo(CW - PAD, y + line.h / 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (line.type === "text") {
    ctx.font = `${line.bold ? "bold " : ""}${line.size}px "${FONT}"`;
    ctx.textBaseline = "middle";

    const textLines = line.textLines || [line.text];
    const subH = line.h / textLines.length;

    textLines.forEach((t, i) => {
      const textY = y + subH * i + subH / 2;
      if (line.align === "center") {
        ctx.textAlign = "center";
        ctx.fillText(t, CW / 2, textY);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(t, PAD, textY);
      }
    });
    return;
  }

  if (line.type === "cols2") {
    ctx.font         = `${line.bold ? "bold " : ""}${line.size}px "${FONT}"`;
    ctx.textBaseline = "middle";

    const c1Lines = line.c1Lines || [line.c1];
    const subH = line.h / c1Lines.length;

    // c1 — har line left aligned
    ctx.textAlign = "left";
    c1Lines.forEach((t, i) => {
      ctx.fillText(t, PAD, y + subH * i + subH / 2);
    });

    // c2 — vertically center hoga overall block ke center me
    ctx.textAlign = "right";
    ctx.fillText(line.c2, CW - PAD, y + line.h / 2);
    return;
  }

 if (line.type === "cols3") {
    ctx.font         = `${line.bold ? "bold " : ""}${line.size}px "${FONT}"`;
    ctx.textBaseline = "middle";

    const c1Lines = line.c1Lines || [line.c1];
    const subH = line.h / c1Lines.length;

    // c1 — har line left aligned
    ctx.textAlign = "left";
    c1Lines.forEach((t, i) => {
      ctx.fillText(t, PAD, y + subH * i + subH / 2);
    });

    const centerY = y + line.h / 2;

    // c3 (amount) — right aligned, fixed
    ctx.textAlign = "right";
    ctx.fillText(line.c3, CW - PAD, centerY);

    // c2 (qty) — c3 ke left, fixed gap se
    const c3Width = ctx.measureText(line.c3).width;
    const gap = 16 * SCALE;
    ctx.textAlign = "right";
    ctx.fillText(line.c2, CW - PAD - c3Width - gap, centerY);

    return;
  }
}



// yemera current code hai