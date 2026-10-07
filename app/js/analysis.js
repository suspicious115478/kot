import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, query, orderBy,
  where, Timestamp, doc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ───────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

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
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentMode   = "all";   // "all" | "single" | "range"
let currentSort   = "qty";   // "qty" | "revenue" | "prep"
let cachedOrders  = [];

// ── Tab switching ─────────────────────────────────────────────────────────────
document.getElementById("tabAllTime").addEventListener("click", () => switchTab("all"));
document.getElementById("tabSingleDate").addEventListener("click", () => switchTab("single"));
document.getElementById("tabDateRange").addEventListener("click", () => switchTab("range"));

function switchTab(mode) {
  currentMode = mode;
  ["tabAllTime", "tabSingleDate", "tabDateRange"].forEach(id => {
    document.getElementById(id).classList.remove("active");
  });
  document.getElementById("singleDateGroup").style.display = "none";
  document.getElementById("rangeDateGroup").style.display  = "none";

  if (mode === "all") {
    document.getElementById("tabAllTime").classList.add("active");
    setRangeDisplay("All time");
    loadOrders();
  } else if (mode === "single") {
    document.getElementById("tabSingleDate").classList.add("active");
    document.getElementById("singleDateGroup").style.display = "flex";
    const today = todayStr();
    document.getElementById("singleDatePicker").value = today;
    setRangeDisplay(formatDisplayDate(today));
    loadOrders(today, today);
  } else if (mode === "range") {
    document.getElementById("tabDateRange").classList.add("active");
    document.getElementById("rangeDateGroup").style.display = "flex";
    const today = todayStr();
    document.getElementById("rangeEnd").value   = today;
    document.getElementById("rangeStart").value = offsetDate(today, -6);
    setRangeDisplay("Last 7 days");
    loadOrders(document.getElementById("rangeStart").value, today);
  }
}

document.getElementById("applySingleDate").addEventListener("click", () => {
  const val = document.getElementById("singleDatePicker").value;
  if (!val) return showToast("Please select a date", true);
  setRangeDisplay(formatDisplayDate(val));
  loadOrders(val, val);
});

document.getElementById("applyRange").addEventListener("click", () => {
  const start = document.getElementById("rangeStart").value;
  const end   = document.getElementById("rangeEnd").value;
  if (!start || !end) return showToast("Please select both dates", true);
  if (start > end) return showToast("Start date must be before end date", true);
  setRangeDisplay(formatDisplayDate(start) + " – " + formatDisplayDate(end));
  loadOrders(start, end);
});

// ── Sort controls ─────────────────────────────────────────────────────────────
document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentSort = btn.dataset.sort;
    renderAnalysis(cachedOrders);
  });
});

// ── Load orders from Firestore ────────────────────────────────────────────────
let _ordersUnsub = null;

function loadOrders(startDate, endDate) {
  if (!restaurantId) return showToast("Restaurant not found", true);

  // Purana listener band karo
  if (_ordersUnsub) { _ordersUnsub(); _ordersUnsub = null; }

  showLoading();

  try {
    let q;
    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(endDate);   end.setHours(23, 59, 59, 999);
      q = query(
        collection(db, "restaurants", restaurantId, "orders"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<=", Timestamp.fromDate(end)),
        orderBy("createdAt", "desc")
      );
    } else {
      q = query(
        collection(db, "restaurants", restaurantId, "orders"),
        orderBy("createdAt", "desc")
      );
    }

    _ordersUnsub = onSnapshot(q, (snap) => {
      cachedOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAnalysis(cachedOrders);
    }, (err) => {
      showToast("Realtime error: " + err.message, true);
      showEmptyTable("Failed to load data. Please try again.");
    });

  } catch (err) {
    showToast("Failed to load orders: " + err.message, true);
    showEmptyTable("Failed to load data. Please try again.");
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderAnalysis(orders) {
  // Aggregate item stats
  const itemMap = {}; // key: item name

 orders.forEach(order => {
  const items           = order.items || [];
  const orderPreparingMs = tsToMs(order.preparingAt); // ← jab kitchen ne PREPARING kiya

  const totalRevenue = orders.reduce((s, o) => s + (o.totalPrice || 0), 0); // bahar hai, yahan nahi

  items.forEach(item => {
    const rawName = item.name || "Unknown";
    const key     = rawName.trim().toLowerCase();
    const qty     = Number(item.qty ?? item.quantity ?? 1);
    const price   = Number(item.price ?? 0);
    const revenue = price * qty;

    if (!itemMap[key]) {
      itemMap[key] = {
        name: rawName.trim(),
        totalQty: 0,
        totalRevenue: 0,
        prepSamples: [],
      };
    }

    itemMap[key].totalQty     += qty;
    itemMap[key].totalRevenue += revenue;

    // ✅ Item-level prep: preparedAt (jab tick kiya) - preparingAt (jab order preparing hua)
    if (item.preparedAt && orderPreparingMs) {
      const itemPreparedMs  = tsToMs(item.preparedAt);
      const itemPrepDuration = itemPreparedMs - orderPreparingMs;
      if (itemPrepDuration > 0) {
        itemMap[key].prepSamples.push(itemPrepDuration);
      }
    }
  });
});

  // Convert to array and compute averages
  let items = Object.values(itemMap).map(it => ({
    ...it,
    avgPrepMs: it.prepSamples.length
      ? it.prepSamples.reduce((a, b) => a + b, 0) / it.prepSamples.length
      : null,
  }));

  // ── Highlight cards ──────────────────────────────────────────────────────
  const totalRevenue   = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
  const totalItemsSold = items.reduce((s, i) => s + i.totalQty, 0);

  // Most sold
  const mostSold = [...items].sort((a, b) => b.totalQty - a.totalQty)[0];
  document.getElementById("mostSoldName").textContent = mostSold ? mostSold.name : "—";
  document.getElementById("mostSoldQty").textContent  = mostSold ? `${mostSold.totalQty} units sold` : "No data";

  // Fastest prep (only items with at least one completed order prep time)
  const withPrep  = items.filter(i => i.avgPrepMs !== null);
  const fastest   = withPrep.sort((a, b) => a.avgPrepMs - b.avgPrepMs)[0];
  document.getElementById("fastestName").textContent = fastest ? fastest.name : "—";
  document.getElementById("fastestTime").textContent = fastest
    ? formatDuration(fastest.avgPrepMs) + " avg prep time"
    : "No completed orders";

 document.getElementById("totalRevenue").textContent = "₹" + totalRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById("totalOrders").textContent    = `${orders.length} order${orders.length !== 1 ? "s" : ""}`;
  document.getElementById("totalItemsSold").textContent = totalItemsSold.toLocaleString("en-IN");
  document.getElementById("uniqueItemsCount").textContent = `${items.length} unique dish${items.length !== 1 ? "es" : ""}`;

  // ── Sort items ────────────────────────────────────────────────────────────
  if (currentSort === "qty") {
    items.sort((a, b) => b.totalQty - a.totalQty);
  } else if (currentSort === "revenue") {
    items.sort((a, b) => b.totalRevenue - a.totalRevenue);
  } else if (currentSort === "prep") {
    // Items with prep time first (ascending), then items without
    const hasPt = items.filter(i => i.avgPrepMs !== null).sort((a, b) => a.avgPrepMs - b.avgPrepMs);
    const noPt  = items.filter(i => i.avgPrepMs === null);
    items = [...hasPt, ...noPt];
  }

  // ── Render table ──────────────────────────────────────────────────────────
  if (!items.length) {
    showEmptyTable("No orders found for this period");
    return;
  }

  const maxQty = items[0]?.totalQty || 1;  // after sorting by qty; recalculate for bar
  const maxQtyAll = Math.max(...items.map(i => i.totalQty), 1);

  const tableWrap = document.getElementById("itemsTable");
  tableWrap.style.display = "block";
  document.getElementById("tableLoading").style.display = "none";

  tableWrap.innerHTML = `
    <table class="items-table">
      <thead>
        <tr>
          <th style="width:42px;">#</th>
          <th>Item</th>
          <th>Units Sold</th>
          <th class="num">Revenue</th>
          <th class="num">Avg Prep Time</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, i) => buildRow(item, i, maxQtyAll)).join("")}
      </tbody>
    </table>
  `;
}

function buildRow(item, index, maxQty) {
  const rank   = index + 1;
  const rankCls = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
  const pct    = Math.round((item.totalQty / maxQty) * 100);

  const prepHtml = item.avgPrepMs !== null
    ? `<span class="prep-badge ${item.avgPrepMs < 10 * 60 * 1000 ? "fast" : ""}">${formatDuration(item.avgPrepMs)}</span>`
    : `<span class="prep-badge none">No data</span>`;

  return `
    <tr>
      <td><span class="rank-badge ${rankCls}">${rank}</span></td>
      <td>
        <div class="item-name-cell">
          <span class="item-name-main">${escHtml(item.name)}</span>
        </div>
      </td>
      <td>
        <div class="qty-cell">
          <div class="qty-bar-wrap">
            <div class="qty-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="qty-number">${item.totalQty}</span>
        </div>
      </td>
     <td class="num"><span class="revenue-val">₹${item.totalRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></td>
      <td class="num">${prepHtml}</td>
    </tr>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showLoading() {
  document.getElementById("tableLoading").style.display = "flex";
  document.getElementById("itemsTable").style.display   = "none";
  document.getElementById("mostSoldName").textContent   = "—";
  document.getElementById("mostSoldQty").textContent    = "—";
  document.getElementById("fastestName").textContent    = "—";
  document.getElementById("fastestTime").textContent    = "—";
  document.getElementById("totalRevenue").textContent   = "—";
  document.getElementById("totalOrders").textContent    = "—";
  document.getElementById("totalItemsSold").textContent = "—";
  document.getElementById("uniqueItemsCount").textContent = "—";
}

function showEmptyTable(msg) {
  document.getElementById("tableLoading").style.display = "none";
  const tableWrap = document.getElementById("itemsTable");
  tableWrap.style.display = "block";
  tableWrap.innerHTML = `
    <div class="table-empty">
      <span class="empty-icon">📊</span>
      <span class="empty-title">${msg}</span>
      <span class="empty-hint">Try a different date range</span>
    </div>`;
}

function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  return null;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const minutes  = Math.floor((totalSec % 3600) / 60);
  const seconds  = totalSec % 60;
  if (hours > 0)   return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function setRangeDisplay(text) {
  document.getElementById("rangeDisplay").textContent = text;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Initial load ──────────────────────────────────────────────────────────────
loadOrders();