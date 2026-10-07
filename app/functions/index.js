const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

// ── Auto-add prepared stocks (scheduled) ──────────────────────────────────────
exports.autoAddPreparedStock = onSchedule("every 60 minutes", async () => {
  const db  = getFirestore();
  const now = Date.now();

  const restSnap = await db.collection("restaurants").get();

  for (const restDoc of restSnap.docs) {
    const restId  = restDoc.id;
    const prepSnap = await db
      .collection("restaurants").doc(restId)
      .collection("prepared_stocks").get();

    for (const prepDoc of prepSnap.docs) {
      const data = prepDoc.data();
      const auto = data.autoStock;

      if (!auto || !auto.enabled || !auto.qty || !auto.intervalHours) continue;

      const lastRun    = auto.lastRunAt ? auto.lastRunAt.toMillis() : 0;
      const intervalMs = auto.intervalHours * 60 * 60 * 1000;

      if (now - lastRun < intervalMs) continue;

      const currentQty = typeof data.stock === "number" ? data.stock : 0;
      const newQty     = currentQty + auto.qty;

      await prepDoc.ref.update({
        stock: newQty,
        "autoStock.lastRunAt": FieldValue.serverTimestamp()
      });

      await prepDoc.ref.collection("stock_history").add({
        type:      "auto_add",
        qty:       auto.qty,
        prevQty:   currentQty,
        newQty,
        note:      `Auto-added every ${auto.intervalHours}h`,
        createdAt: FieldValue.serverTimestamp()
      });
    }
  }
});

// ── Inventory deduction on order PREPARING/COMPLETED ─────────────────────────
exports.deductInventoryOnPreparing = onDocumentUpdated(
  "restaurants/{restaurantId}/orders/{orderId}",
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    const restId  = event.params.restaurantId;
    const orderId = event.params.orderId;

    const wasNew         = before.status === "NEW";
    const isNowPrepOrDone = after.status === "PREPARING" || after.status === "COMPLETED";

    if (!wasNew || !isNowPrepOrDone) return null;
    if (after.inventoryDeducted)     return null;

    const items = after.items || [];
    if (!items.length) return null;

    const db = getFirestore();

    // ── Recipes load karo ─────────────────────────────────────────
    const recipesSnap = await db
      .collection("restaurants").doc(restId)
      .collection("recipes").get();

    const recipesByName = {};
    recipesSnap.forEach(d => {
      const data = d.data();
      if (data.menuItemName)
        recipesByName[data.menuItemName.trim().toLowerCase()] = data;
    });

    // ── Raw material deductions build karo ───────────────────────
    const deductions = {};

    for (const item of items) {
      const itemName = (item.name || "").trim().toLowerCase();
      const recipe   = recipesByName[itemName];
      if (!recipe) continue;

      const orderQty = item.qty ?? item.quantity ?? 1;
      const servings = orderQty / (recipe.yield || 1);

      for (const ing of (recipe.ingredients || [])) {
        if (!ing.rawId || !ing.qty) continue;
        const deductQty = ing.qty * servings;
        if (deductions[ing.rawId]) deductions[ing.rawId].qty += deductQty;
        else deductions[ing.rawId] = { qty: deductQty, rawName: ing.rawName };
      }
    }

    const shortId = orderId.slice(0, 6).toUpperCase();

    // ── Raw materials deduct karo ─────────────────────────────────
    for (const [rawId, d] of Object.entries(deductions)) {
      const rawRef = db
        .collection("restaurants").doc(restId)
        .collection("inventory_raw").doc(rawId);

      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(rawRef);
          if (!snap.exists) return;
          const curr     = typeof snap.data().stock === "number" ? snap.data().stock : 0;
          const newStock = Math.max(0, curr - d.qty);
          tx.update(rawRef, { stock: newStock });
          d._prev = curr;
          d._new  = newStock;
        });

        await rawRef.collection("stock_history").add({
          type:    "deduct",
          qty:     d.qty,
          prevQty: d._prev,
          newQty:  d._new,
          note:    `Auto-deducted — Order #${shortId}`,
          orderId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error("Raw deduction failed:", rawId, e.message);
      }
    }

    // ── Prepared stocks deduct karo ───────────────────────────────
    for (const item of items) {
      const itemName = (item.name || "").trim();
      const orderQty = item.qty ?? item.quantity ?? 1;

      const prepSnap = await db
        .collection("restaurants").doc(restId)
        .collection("prepared_stocks")
        .where("menuItemName", "==", itemName)
        .get();

      if (prepSnap.empty) continue;

      const prepDoc = prepSnap.docs[0];
      const curr    = typeof prepDoc.data().stock === "number" ? prepDoc.data().stock : 0;
      const newQty  = Math.max(0, curr - orderQty);

      await prepDoc.ref.update({ stock: newQty });
      await prepDoc.ref.collection("stock_history").add({
        type:    "deduct",
        qty:     orderQty,
        prevQty: curr,
        newQty,
        note:    `Auto-deducted — Order #${shortId}`,
        createdAt: FieldValue.serverTimestamp()
      });
    }

    // ── Order mark karo ───────────────────────────────────────────
    await db
      .collection("restaurants").doc(restId)
      .collection("orders").doc(orderId)
      .update({
        inventoryDeducted:   true,
        inventoryDeductedAt: FieldValue.serverTimestamp()
      });

    console.log(`✅ Inventory deducted for order #${shortId}`);
    return null;
  }
);