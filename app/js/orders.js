//ye mera current version ahi

import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, getDoc, getDocs, addDoc,
  query, orderBy, onSnapshot, where, updateDoc,
  Timestamp, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

if (!restaurantId) showToast("Restaurant not found", true);

// ── Logo / brand color sync ───────────────────────────────────────────────────
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
  if (data.stockMode) stockMode = data.stockMode;
});
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentMode   = "live";
let unsubscribeFn = null;
let knownOrderIds = new Set();
let stockMode = "manual"; // default safe

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.getElementById("tabLive").addEventListener("click", () => {
  currentMode = "live";
  document.getElementById("tabLive").classList.add("active");
  document.getElementById("tabDate").classList.remove("active");
  document.getElementById("datePickerRow").style.display = "none";
  startLiveListener();
});

document.getElementById("tabDate").addEventListener("click", () => {
  currentMode = "date";
  document.getElementById("tabDate").classList.add("active");
  document.getElementById("tabLive").classList.remove("active");
  document.getElementById("datePickerRow").style.display = "flex";
  stopListener();
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("datePicker").value = today;
  loadByDate(today);
});

document.getElementById("loadDateBtn").addEventListener("click", () => {
  const val = document.getElementById("datePicker").value;
  if (val) loadByDate(val);
});
document.getElementById("datePicker").addEventListener("change", (e) => {
  if (e.target.value) loadByDate(e.target.value);
});

// ── Listener management ───────────────────────────────────────────────────────
function stopListener() {
  if (unsubscribeFn) { unsubscribeFn(); unsubscribeFn = null; }
}

function startLiveListener() {
  stopListener();
  if (!restaurantId) return;

  const q = query(
    collection(db, "restaurants", restaurantId, "orders"),
    orderBy("createdAt", "desc")
  );

  unsubscribeFn = onSnapshot(q, (snap) => {
    const orders  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const newIds  = new Set(orders.map(o => o.id));
    const freshIds = [...newIds].filter(id => !knownOrderIds.has(id) && knownOrderIds.size > 0);
    knownOrderIds  = newIds;
    renderOrders(orders, freshIds);
  }, (err) => {
    showToast("Realtime error: " + err.message, true);
  });
}

async function loadByDate(dateStr) {
  if (!restaurantId) return;
  setLoadingState();
  try {
    const start = new Date(dateStr); start.setHours(0, 0, 0, 0);
    const end   = new Date(dateStr); end.setHours(23, 59, 59, 999);
    const q = query(
      collection(db, "restaurants", restaurantId, "orders"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );
    const snap   = await getDocs(q);
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders(orders, []);
  } catch (e) {
    showToast("Failed to load orders: " + e.message, true);
    setEmptyState("No orders found for " + dateStr);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderOrders(orders, flashIds = []) {
  updateSummary(orders);

  const list = document.getElementById("ordersList");

  if (!orders.length) {
    list.innerHTML = `
      <div class="orders-empty">
        <span class="empty-icon">🧾</span>
        <div class="empty-title">${currentMode === "live" ? "No orders yet — waiting for new ones..." : "No orders on this date"}</div>
      </div>`;
    return;
  }

  const existingCards = new Map(
    [...list.querySelectorAll(".order-card[data-id]")].map(el => [el.dataset.id, el])
  );
  const incomingIds = new Set(orders.map(o => o.id));

  // Remove stale cards
  existingCards.forEach((el, id) => {
    if (!incomingIds.has(id)) {
      el.style.transition = "opacity 0.3s, transform 0.3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";
      setTimeout(() => el.remove(), 300);
    }
  });

  list.querySelector(".orders-empty")?.remove();

  orders.forEach((order, i) => {
    const isNew   = flashIds.includes(order.id);
    const newHtml = buildOrderCard(order, isNew, i);

    if (existingCards.has(order.id)) {
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const newCard = temp.firstElementChild;
      const oldCard = existingCards.get(order.id);

      if (oldCard.className !== newCard.className) {
        oldCard.className = newCard.className;
      }

      const oldHeader = oldCard.querySelector(".order-header");
      const newHeader = newCard.querySelector(".order-header");
      if (oldHeader && newHeader && oldHeader.innerHTML !== newHeader.innerHTML) {
        oldHeader.innerHTML = newHeader.innerHTML;
        bindSelectListeners(oldCard, order.id, order);
      }

      const oldFooter = oldCard.querySelector(".order-footer");
      const newFooter = newCard.querySelector(".order-footer");
      if (oldFooter && newFooter && oldFooter.innerHTML !== newFooter.innerHTML) {
        oldFooter.innerHTML = newFooter.innerHTML;
        bindFooterListeners(oldCard, order.id, order);
      }

      list.appendChild(oldCard);

    } else {
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const card = temp.firstElementChild;
      card.style.opacity = "0";
      card.style.transform = "translateY(12px)";
      list.appendChild(card);

     requestAnimationFrame(() => {
        card.style.transition = "opacity 0.35s ease, transform 0.35s ease";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      });

      bindSelectListeners(card, order.id, order);
      bindFooterListeners(card, order.id, order);
    }
  });
}

// ── Status select listeners ───────────────────────────────────────────────────
function bindSelectListeners(card, orderId, orderData) {
  card.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      const oldStatus = e.target.dataset.oldStatus;

      // Disable select during update
      sel.disabled = true;

      try {
        const updateData = { status: newStatus };
        if (newStatus === "COMPLETED") updateData.completedAt = Date.now();
        if (newStatus === "PREPARING") updateData.preparingAt = Date.now();

        await updateDoc(
          doc(db, "restaurants", restaurantId, "orders", orderId),
          updateData
        );

        // ── Inventory deduction on PREPARING (ya seedha COMPLETED, Preparing skip ho to) ──
// Only deduct once per order (guard: inventoryDeducted flag on order doc)
const alreadyPastPreparing =
  (oldStatus === "PREPARING" || oldStatus === "COMPLETED");

if (
  (newStatus === "PREPARING" || newStatus === "COMPLETED") &&
  !alreadyPastPreparing
) {

  // Prepared stock hamesha deduct hoga
  await deductPreparedStockForOrder(orderData);

  // Raw stock sirf auto mode me
  if (stockMode === "auto") {
    await deductInventoryForOrder(orderId, orderData);
  }
}

        showToast("Status updated ✅");
        e.target.dataset.oldStatus = newStatus;
      } catch (err) {
        showToast("Failed to update status: " + err.message, true);
        e.target.value = oldStatus;
      } finally {
        sel.disabled = false;
      }
    });
  });
}

// ── Inventory deduction logic ─────────────────────────────────────────────────
/**
 * For each item in the order:
 *   1. Recipe dhundhte hain name se (menuItemName field) — kyunki Android menuItemId save nahi karta
 *   2. For each ingredient: deduct (ingredient.qty * item.qty) from inventory_raw stock
 *   3. Write a stock_history entry
 *   4. Mark order as inventoryDeducted: true to prevent double-deduction
 */

// Recipes — realtime listener, kabhi stale nahi rahega
let recipesByName = {}; // menuItemName (lowercase) → recipe data

onSnapshot(
  collection(db, "restaurants", restaurantId, "recipes"),
  (snap) => {
    recipesByName = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.menuItemName) {
        recipesByName[data.menuItemName.trim().toLowerCase()] = data;
      }
    });
    console.log("✅ Recipes loaded:", Object.keys(recipesByName));   // ADD
  },
  (err) => console.error("❌ Recipes listener error:", err)          // ADD
);

function findRecipeByName(itemName) {
  const key = (itemName || "").trim().toLowerCase();
  return recipesByName[key] || null;
}

async function deductInventoryForOrder(orderId, orderData) {
  // Re-fetch order — inventoryDeducted flag check (double-deduction guard)
  const orderRef  = doc(db, "restaurants", restaurantId, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return;

  const freshOrder = orderSnap.data();
  if (freshOrder.inventoryDeducted) return; // pehle ho chuka hai

  const items = freshOrder.items || orderData?.items || [];
  if (!items.length) return;

  const deductions = [];

  // Har order item ke liye recipe dhundho — name se match
  for (const item of items) {
    const itemName = item.name || "";
    if (!itemName) continue;

    const recipe = await findRecipeByName(itemName);
    if (!recipe) continue; // is item ki recipe nahi bani — skip

    const orderQty     = item.qty ?? item.quantity ?? 1;
    const recipeYield  = recipe.yield || 1;
    // Servings this order item needs = orderQty / recipeYield
    const servings     = orderQty / recipeYield;

    for (const ing of (recipe.ingredients || [])) {
      const deductQty = ing.qty * servings;
      if (!ing.rawId || deductQty <= 0) continue;
      deductions.push({
        rawId:      ing.rawId,
        rawName:    ing.rawName,
        deductQty,
        unitSymbol: ing.unitSymbol || ing.unitName || "",
      });
    }
  }

  if (!deductions.length) {
  await updateDoc(orderRef, {
    inventoryDeducted: true,
    inventoryDeductedAt: Date.now()
  });
  return;
}

  // Merge deductions for same rawId (if same ingredient appears in multiple items)
  const merged = {};
  for (const d of deductions) {
    if (merged[d.rawId]) {
      merged[d.rawId].deductQty += d.deductQty;
    } else {
      merged[d.rawId] = { ...d };
    }
  }

  const shortOrderId = (freshOrder.orderId || orderId).slice(0, 6).toUpperCase();
  const insufficientItems = [];

  // Apply deductions using Firestore transactions (atomic per raw material)
  for (const [rawId, d] of Object.entries(merged)) {
    const rawRef = doc(db, "restaurants", restaurantId, "inventory_raw", rawId);
    try {
      await runTransaction(db, async (tx) => {
        const rawSnap = await tx.get(rawRef);
        if (!rawSnap.exists()) return; // Material deleted — skip

        const currentStock = typeof rawSnap.data().stock === "number"
          ? rawSnap.data().stock : 0;
        const newStock = Math.max(0, currentStock - d.deductQty);

        if (currentStock < d.deductQty) {
          insufficientItems.push(`${d.rawName} (need ${fmt(d.deductQty)}, have ${fmt(currentStock)})`);
        }

        tx.update(rawRef, { stock: newStock });

        // Write history — addDoc can't be inside a transaction,
        // so we queue it after the transaction
        d._prevStock = currentStock;
        d._newStock  = newStock;
      });

      // Write stock_history after transaction succeeds
      const histRef = collection(
        db, "restaurants", restaurantId, "inventory_raw", rawId, "stock_history"
      );
      await addDoc(histRef, {
        type:      "deduct",
        qty:       d.deductQty,
        prevQty:   d._prevStock,
        newQty:    d._newStock,
        note:      `Auto-deducted — Order #${shortOrderId}`,
        orderId:   orderId,
        createdAt: serverTimestamp(),
      });

    } catch (txErr) {
      console.warn(`Inventory deduction failed for ${d.rawName}:`, txErr.message);
    }
  }

 

  // Mark order as deducted
  await updateDoc(orderRef, {
    inventoryDeducted:    true,
    inventoryDeductedAt:  Date.now(),
  });

  // Notify about low/insufficient stock
  if (insufficientItems.length) {
    showToast(
      `⚠️ Low stock: ${insufficientItems.slice(0, 2).join(", ")}${insufficientItems.length > 2 ? " & more" : ""}`,
      true
    );
  } else {
    showToast("📦 Inventory updated");
  }
}

function fmt(n) {
  return Number.isInteger(n) ? n : parseFloat(n.toFixed(3));
}

// ── Prepared stock deduction ──────────────────────────────────────────────────
async function deductPreparedStockForOrder(orderData) {
  const items = orderData.items || [];
  if (!items.length) return;

  for (const item of items) {
    const itemName = (item.name || "").trim().toLowerCase();
    if (!itemName) continue;

    const orderQty = item.qty ?? item.quantity ?? 1;

    // prepared_stocks me name se match karo
    const prepSnap = await getDocs(
      query(
        collection(db, "restaurants", restaurantId, "prepared_stocks"),
        where("menuItemName", "==", item.name.trim())
      )
    );

    if (prepSnap.empty) continue;

    const prepDoc    = prepSnap.docs[0];
    const prepRef    = doc(db, "restaurants", restaurantId, "prepared_stocks", prepDoc.id);
    const currentQty = typeof prepDoc.data().stock === "number" ? prepDoc.data().stock : 0;
    const newQty     = Math.max(0, currentQty - orderQty);

    await updateDoc(prepRef, { stock: newQty });

    // History bhi likhte hain
    const histRef = collection(
      db, "restaurants", restaurantId, "prepared_stocks", prepDoc.id, "stock_history"
    );
    const shortOrderId = (orderData.orderId || "").slice(0, 6).toUpperCase();
    await addDoc(histRef, {
      type:      "deduct",
      qty:       orderQty,
      prevQty:   currentQty,
      newQty,
      note:      `Auto-deducted — Order #${shortOrderId}`,
      createdAt: serverTimestamp()
    });
  }
}

// ── Duration helper ───────────────────────────────────────────────────────────
function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  return null;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const minutes  = Math.floor((totalSec % 3600) / 60);
  const seconds  = totalSec % 60;

  if (hours > 0)   return `${hours} hr ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} sec`;
}

// ── Order card builder ────────────────────────────────────────────────────────
function buildOrderCard(order, isNew, index) {
  const status    = order.status || "NEW";
  const orderType = order.orderType || "KIOSK";
  const items     = order.items || [];
  const total     = order.totalPrice || 0;
  const shortId   = (order.orderId || order.id || "").slice(0, 6).toUpperCase();
  const timeStr   = formatTime(order.createdAt);
  const payStatus = order.paymentStatus || null;

  const typeLabel     = { DINE_IN: "Dine In", TAKEAWAY: "Takeaway", KIOSK: "Kiosk" }[orderType] || orderType;
  const statusOptions = ["NEW", "PREPARING", "COMPLETED"];

  // Completion time badge
  let completionBadgeHtml = "";
  if (status === "COMPLETED") {
    const createdMs   = tsToMs(order.createdAt);
    const completedMs = tsToMs(order.completedAt);
    if (createdMs && completedMs && completedMs > createdMs) {
      const duration = formatDuration(completedMs - createdMs);
      if (duration) {
        completionBadgeHtml = `
          <span class="completion-time-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            in ${duration}
          </span>`;
      }
    }
  }

  // Inventory deducted badge
  const invBadgeHtml = order.inventoryDeducted
    ? `<span class="inv-deducted-badge" title="Inventory deducted for this order">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        Stock Updated
      </span>`
    : "";

  const itemsHtml = items.map(item => `
    <div class="order-item-row">
      <span class="order-item-qty">×${item.qty ?? item.quantity ?? 1}</span>
      <span class="order-item-name">${item.name}</span>
      <span class="order-item-price">₹${((item.price ?? 0) * (item.qty ?? item.quantity ?? 1)).toFixed(2)}</span>
    </div>
  `).join("");

  const statusOptsHtml = statusOptions.map(s =>
    `<option value="${s}" ${s === status ? "selected" : ""}>${statusLabel(s)}</option>`
  ).join("");

  return `
  <div class="order-card status-${status} ${isNew ? "new-flash" : ""}" data-id="${order.id}" style="animation-delay:${index * 40}ms">
    <div class="order-header">
      <div class="order-id">#${shortId}<span>${timeStr}</span></div>
      <span class="order-type-badge type-${orderType}">${typeLabel}</span>
      <span class="status-badge-pill s-${status}">
        ${statusDot(status)} ${statusLabel(status)}
      </span>
      ${completionBadgeHtml}
      ${invBadgeHtml}
     ${payStatus ? `<span class="payment-badge ps-${payStatus.toLowerCase()}">${{"PENDING":"🟡 Pending","SUCCESS":"🟢 Paid","FAILED":"🔴 Failed","CANCELLED":"⚫ Cancelled","PAYMENT_AT_COUNTER":"🧾 Pay at Counter"}[payStatus]||payStatus}</span>` : ""}
      <select class="status-select" data-order-id="${order.id}" data-old-status="${status}">
        ${statusOptsHtml}
      </select>
    </div>
    <div class="order-body">
      <div class="order-items-list">
        ${itemsHtml || '<div style="color:var(--muted); font-size:0.82rem;">No items found</div>'}
      </div>
    </div>
    <div class="order-footer">
      ${payStatus === "PAYMENT_AT_COUNTER" ? `
        <button class="mark-paid-btn" data-order-id="${order.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Mark as Paid
        </button>` : ""}
      <span class="order-total">₹${(total).toFixed(2)}</span>
    </div>
  </div>`;
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function updateSummary(orders) {
  document.getElementById("sumTotal").textContent    = orders.length;
  document.getElementById("sumRevenue").textContent  =
    "₹" + orders.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2);
  document.getElementById("sumNew").textContent      = orders.filter(o => o.status === "NEW").length;
  document.getElementById("sumPrep").textContent     = orders.filter(o => o.status === "PREPARING").length;
  document.getElementById("sumDone").textContent     = orders.filter(o => o.status === "COMPLETED").length;
}

function setLoadingState() {
  document.getElementById("ordersList").innerHTML =
    `<div class="orders-empty"><span class="empty-icon">⏳</span><p>Loading orders...</p></div>`;
}

function setEmptyState(msg) {
  document.getElementById("ordersList").innerHTML =
    `<div class="orders-empty"><span class="empty-icon">🧾</span><div class="empty-title">${msg}</div></div>`;
  updateSummary([]);
}

// ── Util ──────────────────────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  } catch (_) { return "—"; }
}

function statusLabel(s) {
  return { NEW: "New", PREPARING: "Preparing", COMPLETED: "Completed" }[s] || s;
}

function statusDot(s) {
  return { NEW: "🟠", PREPARING: "🔵", COMPLETED: "🟢" }[s] || "⚪";
}

// ══════════════════════════════════════════════════════════════════════════
// PAYMENT-AT-COUNTER — Mark as Paid + dual receipt printing
// ══════════════════════════════════════════════════════════════════════════

function fmtRs(n) { return "Rs." + (Number(n) || 0).toFixed(2); }

function tsToDateParts(ts) {
  let d;
  try { d = ts?.toDate ? ts.toDate() : new Date(ts || Date.now()); }
  catch (_) { d = new Date(); }
  return {
    dateStr: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    timeStr: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

function bindFooterListeners(card, orderId, orderData) {
  const btn = card.querySelector(".mark-paid-btn");
  if (!btn) return;
  btn.addEventListener("click", () => markAsPaidAndPrint(orderId, orderData, btn));
}

async function markAsPaidAndPrint(orderId, order, btnEl) {
  const btn = btnEl || document.querySelector(`.mark-paid-btn[data-order-id="${orderId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Marking..."; }
  try {
    await updateDoc(
      doc(db, "restaurants", restaurantId, "orders", orderId),
            { paymentStatus: "SUCCESS", paidAtCounterMarkedAt: Date.now(), kitchenPrintStatus: "PENDING" }
    );
    showToast("Marked as paid ✅ Kitchen receipt kiosk se print hogi");
  } catch (err) {
    showToast("Failed to mark as paid: " + err.message, true);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Mark as Paid`;
    }
  }
}

// ── Dual print: customer copy, then kitchen copy ──────────────────────────────
function printCounterReceipts(order) {
  const SCALE = 2;
  const PW    = 576;
  const CW    = PW * SCALE;
  const PAD   = 16 * SCALE;

  printReceiptCanvas(buildCounterReceiptLines(order, false, CW, PAD), CW, PAD);
  setTimeout(() => {
    printReceiptCanvas(buildCounterReceiptLines(order, true, CW, PAD), CW, PAD);
  }, 1500);
}

function buildCounterReceiptLines(order, isKitchen, CW, PAD) {
  const items    = order.items || [];
  const shortId  = (order.orderId || order.id || "").slice(0, 6).toUpperCase();
  const { dateStr, timeStr } = tsToDateParts(order.createdAt);
  const typeStr  = { DINE_IN: "Dine In", TAKEAWAY: "Takeaway", KIOSK: "Kiosk" }[order.orderType] || order.orderType || "";
  const subtotal   = order.subtotal   || 0;
  const taxAmt     = order.tax        || 0;
  const serviceAmt = order.service    || 0;
  const packingAmt = order.packing    || 0;
  const otherAmt   = order.other      || 0;
  const grandTotal = order.totalPrice || 0;

  const SCALE = 4; // internal sizing scale — matches web-order.js print engine
  const dummy = document.createElement("canvas");
  dummy.width = CW; dummy.height = 100;
  const dCtx  = dummy.getContext("2d");

  const lines = [];
  const add = (type, data) => {
    if (type === "cols3") {
      const font = `${data.bold ? "bold " : ""}${data.size}px "Courier New"`;
      const c2c3Width = dCtx.measureText(data.c2).width + dCtx.measureText(data.c3).width + (16 * SCALE);
      const c1MaxW = Math.max((CW - PAD * 2) - c2c3Width - (16 * SCALE), 20 * SCALE);
      data.c1Lines = wrapTextForReceipt(dCtx, data.c1, c1MaxW, font);
      data.h = data.h * data.c1Lines.length;
    } else if (type === "cols2") {
      const font = `${data.bold ? "bold " : ""}${data.size}px "Courier New"`;
      const c2Width = dCtx.measureText(data.c2).width;
      const c1MaxW = Math.max((CW - PAD * 2) - c2Width - (16 * SCALE), 20 * SCALE);
      data.c1Lines = wrapTextForReceipt(dCtx, data.c1, c1MaxW, font);
      data.h = data.h * data.c1Lines.length;
    } else if (type === "text") {
      const font = `${data.bold ? "bold " : ""}${data.size}px "Courier New"`;
      data.textLines = wrapTextForReceipt(dCtx, data.text, CW - PAD * 2, font);
      if (data.textLines.length > 1) data.h = data.h * data.textLines.length;
    }
    lines.push({ type, ...data });
  };

  add("text", { text: (name || "RESTAURANT").toUpperCase(), size: 28 * SCALE, bold: true, align: "center", h: 38 * SCALE });
  add("gap",  { h: 6 * SCALE });
  add("line", { h: 3 * SCALE, style: "solid" });
  add("gap",  { h: 8 * SCALE });

  if (isKitchen) {
    add("text", { text: "** KITCHEN COPY **", size: 20 * SCALE, bold: true, align: "center", h: 30 * SCALE });
    add("gap",  { h: 6 * SCALE });
  }

  add("text", { text: `Date  : ${dateStr}  ${timeStr}`, size: 17 * SCALE, align: "left", h: 24 * SCALE });
  add("text", { text: `Order : #${shortId}`,            size: 17 * SCALE, align: "left", h: 24 * SCALE });
  add("text", { text: `Type  : ${typeStr}`,              size: 17 * SCALE, align: "left", h: 24 * SCALE });

  if (!isKitchen) {
    add("gap",  { h: 6 * SCALE });
    add("line", { h: 2 * SCALE, style: "dashed" });
    add("gap",  { h: 6 * SCALE });
    add("text", { text: "PAYMENT AT COUNTER", size: 19 * SCALE, bold: true, align: "center", h: 28 * SCALE });
  }

  add("gap",  { h: 6 * SCALE });
  add("line", { h: 2 * SCALE, style: "dashed" });
  add("gap",  { h: 6 * SCALE });

  if (isKitchen) {
    add("cols2", { c1: "ITEM", c2: "QTY", size: 17 * SCALE, bold: true, h: 26 * SCALE });
    add("line", { h: 2 * SCALE, style: "dashed" });
    add("gap",  { h: 4 * SCALE });
    for (const item of items) {
      add("cols2", { c1: item.name, c2: `x${item.qty ?? item.quantity ?? 1}`, size: 17 * SCALE, bold: false, h: 25 * SCALE });
    }
    add("gap",  { h: 10 * SCALE });
    add("line", { h: 3 * SCALE, style: "solid" });
  } else {
    add("cols3", { c1: "ITEM", c2: "QTY", c3: "AMOUNT", size: 17 * SCALE, bold: true, h: 26 * SCALE });
    add("line", { h: 2 * SCALE, style: "dashed" });
    add("gap",  { h: 4 * SCALE });
    for (const item of items) {
      const qty   = item.qty ?? item.quantity ?? 1;
      const total = `Rs.${((item.price || 0) * qty).toFixed(2)}`;
      add("cols3", { c1: item.name, c2: `x${qty}`, c3: total, size: 17 * SCALE, bold: false, h: 25 * SCALE });
    }

    add("gap",  { h: 4 * SCALE });
    add("line", { h: 2 * SCALE, style: "dashed" });
    add("gap",  { h: 6 * SCALE });

    add("cols2", { c1: "Subtotal", c2: fmtRs(subtotal), size: 17 * SCALE, bold: false, h: 25 * SCALE });
    if (taxAmt     > 0) add("cols2", { c1: "Tax",            c2: fmtRs(taxAmt),     size: 17 * SCALE, bold: false, h: 25 * SCALE });
    if (serviceAmt > 0) add("cols2", { c1: "Service Charge", c2: fmtRs(serviceAmt), size: 17 * SCALE, bold: false, h: 25 * SCALE });
    if (packingAmt > 0) add("cols2", { c1: "Packing Charge", c2: fmtRs(packingAmt), size: 17 * SCALE, bold: false, h: 25 * SCALE });
    if (otherAmt   > 0) add("cols2", { c1: "Other Charges",  c2: fmtRs(otherAmt),   size: 17 * SCALE, bold: false, h: 25 * SCALE });

    add("gap",  { h: 4 * SCALE });
    add("line", { h: 3 * SCALE, style: "solid" });
    add("gap",  { h: 8 * SCALE });

    add("cols2", { c1: "TOTAL", c2: fmtRs(grandTotal), size: 26 * SCALE, bold: true, h: 38 * SCALE });

    add("gap",  { h: 4 * SCALE });
    add("line", { h: 3 * SCALE, style: "solid" });
    add("gap",  { h: 14 * SCALE });

    add("text", { text: "PLEASE PAY AT COUNTER", size: 18 * SCALE, bold: true, align: "center", h: 26 * SCALE });
    add("text", { text: "Thank you! Visit again.", size: 17 * SCALE, align: "center", h: 26 * SCALE });
  }

  add("gap", { h: 40 * SCALE });
  return lines;
}

function wrapTextForReceipt(ctx, text, maxWidth, font) {
  ctx.font = font;
  const words = String(text ?? "").split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) { out.push(cur); cur = w; }
    else { cur = test; }
  }
  if (cur) out.push(cur);
  const final = [];
  for (const line of out) {
    if (ctx.measureText(line).width > maxWidth) {
      let chunk = "";
      for (const ch of line) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk) { final.push(chunk); chunk = ch; }
        else { chunk += ch; }
      }
      if (chunk) final.push(chunk);
    } else { final.push(line); }
  }
  return final.length ? final : [""];
}

function drawReceiptLine(ctx, line, y, CW, PAD, FONT, SCALE) {
  ctx.fillStyle = "#000000";
  if (line.type === "gap") return;

  if (line.type === "line") {
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = line.style === "solid" ? 2 * SCALE : 1 * SCALE;
    ctx.setLineDash(line.style === "dashed" ? [6 * SCALE, 4 * SCALE] : []);
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
      if (line.align === "center") { ctx.textAlign = "center"; ctx.fillText(t, CW / 2, textY); }
      else { ctx.textAlign = "left"; ctx.fillText(t, PAD, textY); }
    });
    return;
  }

  if (line.type === "cols2") {
    ctx.font = `${line.bold ? "bold " : ""}${line.size}px "${FONT}"`;
    ctx.textBaseline = "middle";
    const c1Lines = line.c1Lines || [line.c1];
    const subH = line.h / c1Lines.length;
    ctx.textAlign = "left";
    c1Lines.forEach((t, i) => ctx.fillText(t, PAD, y + subH * i + subH / 2));
    ctx.textAlign = "right";
    ctx.fillText(line.c2, CW - PAD, y + line.h / 2);
    return;
  }

  if (line.type === "cols3") {
    ctx.font = `${line.bold ? "bold " : ""}${line.size}px "${FONT}"`;
    ctx.textBaseline = "middle";
    const c1Lines = line.c1Lines || [line.c1];
    const subH = line.h / c1Lines.length;
    ctx.textAlign = "left";
    c1Lines.forEach((t, i) => ctx.fillText(t, PAD, y + subH * i + subH / 2));
    const centerY = y + line.h / 2;
    ctx.textAlign = "right";
    ctx.fillText(line.c3, CW - PAD, centerY);
    const c3Width = ctx.measureText(line.c3).width;
    const gap = 16 * SCALE;
    ctx.fillText(line.c2, CW - PAD - c3Width - gap, centerY);
    return;
  }
}

function printReceiptCanvas(lines, CW, PAD) {
  const SCALE = 2;
  const FONT  = "Courier New";
  const totalH = lines.reduce((s, l) => s + l.h, 0) + (60 * SCALE);

  const canvas  = document.createElement("canvas");
  canvas.width  = CW;
  canvas.height = totalH;
  const ctx     = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CW, totalH);

  let y = 20 * SCALE;
  for (const line of lines) {
    drawReceiptLine(ctx, line, y, CW, PAD, FONT, SCALE);
    y += line.h;
  }

  const imgData = canvas.toDataURL("image/png");

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#fff; }
  img { width: 48mm; display:block; margin:0; image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
  @media print { body{margin:0;padding:0;} img{width:48mm;} @page{ size:58mm auto; margin:0mm; } }
</style></head><body>
  <img src="${imgData}" />
  <script>
    window.onload = function() {
      setTimeout(function(){ window.print(); setTimeout(function(){ window.close(); }, 1000); }, 300);
    };
  <\/script>
</body></html>`;

  const popup = window.open("", "_blank", "width=420,height=700");
  if (!popup) { showToast("⚠️ Popup blocked! Browser settings mein popup allow karo.", true); return; }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

startLiveListener();