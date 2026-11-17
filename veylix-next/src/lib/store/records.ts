// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import {
  appendAuditEntry,
  createId,
  findRecord,
  getCollection,
  getRecordLabel,
  listRecords,
  nowIso,
  readCommerceState,
  writeCommerceState,
} from "@/lib/store/core";
import {
  allocateLocationStock,
  getActiveWarehouseIds,
  setProductStock,
} from "@/lib/store/inventory";
import { calculateOrderTotal, toDateOnly } from "@/lib/store/orders";

export function validateRecord(e, t, n) {
  const r = modulesById[e];
  if (!r) throw Error("Unknown record type.");
  for (const i of r.fields || []) {
    const r = t[i.key];
    if (i.required && (r == null || String(r).trim() === ""))
      throw Error(`${i.label} is required.`);
    if (r === "" || r == null) continue;
    if (
      ["number", "money"].includes(i.type) &&
      (!Number.isFinite(Number(r)) ||
        (i.min != null && Number(r) < i.min) ||
        (i.max != null && Number(r) > i.max) ||
        (i.integer && !Number.isInteger(Number(r))))
    )
      throw Error(
        `Enter a valid ${i.label.toLowerCase()}${i.min == null ? "" : ` (minimum ${i.min})`}${i.max == null ? "" : `, maximum ${i.max}`}.`,
      );
    const a =
      e === "products" && ["category", "brand"].includes(i.key)
        ? [
            ...i.options,
            ...listRecords(i.key === "category" ? "categories" : "brands").map(
              (e) => e.name,
            ),
          ]
        : i.options;
    if (a && !a.includes(r))
      throw Error(`Choose a valid ${i.label.toLowerCase()}.`);
    if (i.relation && !findRecord(i.relation, r))
      throw Error(`Select an existing ${i.label.toLowerCase()}.`);
    if (i.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
      throw Error("Enter a valid email address.");
    if (
      i.unique &&
      listRecords(e).some(
        (e) =>
          e.id !== n &&
          String(e[i.key]).toLowerCase() === String(r).toLowerCase(),
      )
    )
      throw Error(`${i.label} is already in use.`);
    if (String(r).length > 2e4) throw Error(`${i.label} is too long.`);
  }
  if (e === "transfers" && t.from === t.to)
    throw Error("Choose two different warehouses.");
  if (
    ["coupons", "discounts"].includes(e) &&
    t.type === "Percentage" &&
    Number(t.value) > 100
  )
    throw Error("A percentage discount cannot exceed 100.");
  if (e === "coupons") {
    if (t.starts && t.expires && t.expires < t.starts)
      throw Error("The coupon expiry date must follow its start date.");
    if (Number(t.limit || 0) > 0 && Number(t.used || 0) > Number(t.limit))
      throw Error("Times used cannot exceed the total usage limit.");
  }
  if (e === "discounts" && t.start && t.end && t.end < t.start)
    throw Error("The discount end date must follow its start date.");
  if (e === "gift-cards" && Number(t.balance) > Number(t.value))
    throw Error("Balance cannot exceed the original value.");
  if (e === "gift-cards" && t.issued && t.expires && t.expires < t.issued)
    throw Error("The gift card expiry date must follow its issue date.");
  if (e === "payment-links") {
    if (Number(t.amount || 0) <= 0)
      throw Error("Payment link amount must be greater than zero.");
    if (Number(t.maxUses || 0) < 1)
      throw Error("Payment links must allow at least one use.");
    if (Number(t.uses || 0) < 0 || Number(t.uses || 0) > Number(t.maxUses || 0))
      throw Error("Payment link uses cannot exceed the maximum uses.");
    if (t.status === "Paid" && Number(t.uses || 0) < 1)
      throw Error("A paid payment link must have at least one recorded use.");
  }
  if (e === "transactions") {
    if (Number(t.amount || 0) < 0 || Number(t.fee || 0) < 0)
      throw Error("Transaction amount and fee cannot be negative.");
    if (t.type !== "Refund" && Number(t.fee || 0) > Number(t.amount || 0))
      throw Error("Transaction fee cannot exceed the transaction amount.");
  }
  if (e === "settlements") {
    if ([t.gross, t.fees, t.refunds, t.net].some((e) => Number(e || 0) < 0))
      throw Error("Settlement amounts cannot be negative.");
    if (Number(t.net || 0) > Number(t.gross || 0))
      throw Error("Settlement net cannot exceed gross volume.");
  }
  if (e === "promotions" && t.end < t.start)
    throw Error("The end date must follow the start date.");
  if (e === "methods") {
    if (t.provider !== "Offline" && t.status === "Enabled")
      throw Error(
        "This provider has no verified server connection. Keep the method disabled until your payment backend is connected.",
      );
    if (Number(t.maximum) < Number(t.minimum))
      throw Error("Maximum order must be at least the minimum order.");
  }
  if (e === "webhooks" && !String(t.url).startsWith("https://"))
    throw Error("Use an HTTPS webhook endpoint.");
  if (
    e === "products" &&
    Number(t.comparePrice) > 0 &&
    Number(t.comparePrice) < Number(t.price)
  )
    throw Error("Compare-at price should be above the selling price.");
  if (
    e === "products" &&
    t.mediaIds != null &&
    (!Array.isArray(t.mediaIds) ||
      t.mediaIds.length > 6 ||
      t.mediaIds.some((e) => typeof e != "string" || !/^[\w-]{1,100}$/.test(e)))
  )
    throw Error("Choose up to 6 valid product images.");
  if (
    e === "variants" &&
    t.status === "Active" &&
    listRecords("variants")
      .filter(
        (e) =>
          e.productId === t.productId && e.id !== n && e.status === "Active",
      )
      .reduce((e, t) => e + Number(t.stock), 0) +
      Number(t.stock) >
      Number(findRecord("products", t.productId)?.stock)
  )
    throw Error("Variant quantities exceed available product stock.");
  if (e === "orders" && calculateOrderTotal(t) < 0)
    throw Error("Discount cannot exceed the order value.");
  if (
    e === "fulfillment" &&
    ["In transit", "Delivered", "Delayed"].includes(t.status) &&
    !String(t.tracking || "").trim()
  )
    throw Error(
      "Add a tracking number before moving fulfillment beyond packing.",
    );
  if (e === "shipping-rules" && Number(t.maxDays || 0) < Number(t.minDays || 0))
    throw Error(
      "Maximum delivery days must be at least the minimum delivery days.",
    );
  if (e === "deliveries" && t.status === "Delivered" && !t.deliveredDate)
    throw Error("Add the delivered date when a shipment is marked delivered.");
  if (
    e === "returns" &&
    t.status === "In transit" &&
    !["Store drop-off", "Local pickup"].includes(t.returnMethod) &&
    !String(t.tracking || "").trim()
  )
    throw Error("Add return tracking for an in-transit carrier return.");
  if (e === "refunds") {
    const e = findRecord("orders", t.orderId);
    if (!e) throw Error("Choose a valid order for this refund.");
    if (
      !["Paid", "Partially refunded", "Refund requested", "Refunded"].includes(
        e.payment,
      )
    )
      throw Error("Only a captured payment can have a refund request.");
    const r = listRecords("refunds")
      .filter(
        (e) => e.orderId === t.orderId && e.id !== n && e.status !== "Rejected",
      )
      .reduce((e, t) => e + Number(t.amount), 0);
    if (Number(t.amount || 0) <= 0)
      throw Error("Refund amount must be greater than zero.");
    if (
      t.status !== "Rejected" &&
      r + Number(t.amount) > calculateOrderTotal(e) + 0.001
    )
      throw Error("Refund requests cannot exceed the paid order total.");
    if (
      t.status === "Completed" &&
      t.providerStatus !== "Succeeded" &&
      t.refundMethod === "Original payment method"
    )
      throw Error(
        "Mark provider processing as succeeded before completing a payment-provider refund.",
      );
    if (t.status === "Completed" && !t.processedAt)
      throw Error("Add a processed date when the refund is completed.");
  }
  if (e === "cancellations") {
    const e = findRecord("orders", t.orderId);
    if (!e) throw Error("Choose a valid order for this cancellation.");
    if (t.status === "Approved" && e.status === "Delivered")
      throw Error(
        "Delivered orders cannot be cancelled. Use a return or refund workflow instead.",
      );
    if (t.status === "Approved" && e.status === "Shipped")
      throw Error(
        "A shipped order needs a return or carrier-intercept workflow instead of cancellation.",
      );
    if (t.status === "Approved" && !t.decidedAt)
      throw Error("Add a decision date before approving a cancellation.");
  }
  if (e === "abandoned") {
    if (Number(t.value || 0) < 0)
      throw Error("Basket value cannot be negative.");
    if (t.status === "Recovered" && !t.recoveredOrderId)
      throw Error(
        "Link the recovered order before marking the checkout recovered.",
      );
    if (t.recoveredOrderId && !findRecord("orders", t.recoveredOrderId))
      throw Error("Choose a valid recovered order.");
  }
}

export function saveRecord(e, t, n) {
  const r = readCommerceState();
  const i = getCollection(r, e);
  const a = i.find((e) => e.id === n);
  let o = {
    ...a,
    ...t,
    id: n || createId(),
    updatedAt: nowIso(),
  };
  if (e === "transfers" && a?.status === "Received") {
    if (o.status !== "Received")
      throw Error(
        "A received transfer cannot be moved back to an earlier status.",
      );
    if (
      ["productId", "from", "to", "quantity"].some(
        (e) => String(o[e] ?? "") !== String(a[e] ?? ""),
      )
    )
      throw Error(
        "A received transfer is locked because its warehouse balances are already posted.",
      );
  }
  if (e === "replenishment" && a?.status === "Received") {
    if (o.status !== "Received")
      throw Error(
        "A received replenishment cannot be moved back to an earlier status.",
      );
    if (
      ["productId", "supplierId", "warehouseId", "quantity", "unitCost"].some(
        (e) => String(o[e] ?? "") !== String(a[e] ?? ""),
      )
    )
      throw Error(
        "A received replenishment is locked because its inventory receipt is already posted.",
      );
  }
  if (e === "transfers") {
    const e = getCollection(r, "warehouses");
    if (
      [o.from, o.to].some((t) => e.find((e) => e.id === t)?.status === "Paused")
    )
      throw Error("Choose active warehouses for stock transfers.");
    if (["Dispatched", "Received"].includes(o.status)) {
      const e = getCollection(r, "products").find(
        (e) => e.id === o.productId && !e._archived,
      );
      if (e) {
        const t = allocateLocationStock(e, r);
        const n = i
          .filter(
            (e) =>
              e.id !== o.id &&
              !e._archived &&
              e.productId === o.productId &&
              e.from === o.from &&
              e.status === "Dispatched",
          )
          .reduce((e, t) => e + Number(t.quantity || 0), 0);
        const a = Math.max(0, Number(t[o.from] || 0) - n);
        if (a < Number(o.quantity || 0))
          throw Error(
            `${getRecordLabel("warehouses", o.from)} only has ${a} uncommitted units available for this transfer.`,
          );
      }
    }
  }
  if (
    e === "replenishment" &&
    getCollection(r, "warehouses").find((e) => e.id === o.warehouseId)
      ?.status === "Paused"
  )
    throw Error("Choose an active warehouse for replenishment receipts.");
  if (e === "products" && a && Number(o.stock) !== Number(a.stock)) {
    if (
      getCollection(r, "variants")
        .filter(
          (e) => e.productId === o.id && !e._archived && e.status === "Active",
        )
        .reduce((e, t) => e + Number(t.stock), 0) > Number(o.stock)
    )
      throw Error(
        "Product stock cannot be below active variant allocations. Update variant quantities in the product editor first.",
      );
    r.collections ||= {};
    o = setProductStock(o, Number(o.stock), r);
    r.collections.adjustments = [
      {
        id: createId(),
        productId: o.id,
        warehouseId: "",
        delta: Number(o.stock) - Number(a.stock),
        before: Number(a.stock),
        after: Number(o.stock),
        reason: "Product inventory edited",
        date: nowIso(),
      },
      ...getCollection(r, "adjustments"),
    ];
  }
  if (
    (e !== "orders" ||
      (a &&
        a.productId === o.productId &&
        Number(a.quantity) === Number(o.quantity)) ||
      (o.items = [
        {
          productId: o.productId,
          quantity: Number(o.quantity),
          unitPrice: Number(findRecord("products", o.productId)?.price || 0),
        },
      ]),
    e === "customers" && !a && (o.createdAt = toDateOnly()),
    e === "segments")
  ) {
    const e =
      modulesById.segments?.fields?.find((e) => e.key === "condition")
        ?.options || [];
    const t =
      modulesById.segments?.fields?.find((e) => e.key === "logic")?.options ||
      [];
    const n = (
      Array.isArray(o.rules) && o.rules.length
        ? o.rules
        : o.condition
          ? [
              {
                condition: o.condition,
                value: o.value,
              },
            ]
          : []
    )
      .map((e) => ({
        condition: String(e?.condition || "").trim(),
        value: String(e?.value || "").trim(),
      }))
      .filter((e) => e.condition && e.value);
    if (!String(o.name || "").trim()) throw Error("Segment name is required.");
    if (!t.includes(o.logic)) throw Error("Choose valid segment rule logic.");
    if (!n.length) throw Error("Add at least one complete segment rule.");
    if (n.length > 3) throw Error("Use up to three segment rules.");
    if (n.some((t) => !e.includes(t.condition)))
      throw Error("Choose a valid segment condition.");
    o = {
      ...o,
      condition: n[0].condition,
      value: n[0].value,
      rules: n,
      rulesText: n.map((e) => `${e.condition}: ${e.value}`).join(" · "),
    };
  }
  if (
    (validateRecord(e, o, n),
    (r.collections ||= {}),
    e === "transfers" && o.status === "Received" && a?.status !== "Received")
  ) {
    const e = getCollection(r, "products");
    const t = e.find((e) => e.id === o.productId && !e._archived);
    if (!t) throw Error("The transfer product is no longer available.");
    const n = allocateLocationStock(t, r);
    const i = Number(o.quantity || 0);
    const a = Number(n[o.from] || 0);
    if (a < i)
      throw Error(
        `${getRecordLabel("warehouses", o.from)} only has ${a} units available for this transfer.`,
      );
    n[o.from] = a - i;
    n[o.to] = Number(n[o.to] || 0) + i;
    const s = {
      ...t,
      locationStock: n,
      updatedAt: nowIso(),
    };
    r.collections.products = e.map((e) => (e.id === t.id ? s : e));
    r.collections.adjustments = [
      {
        id: createId(),
        productId: t.id,
        warehouseId: o.to,
        delta: 0,
        before: Number(t.stock),
        after: Number(t.stock),
        reason: `Transfer received · ${getRecordLabel("warehouses", o.from)} → ${getRecordLabel("warehouses", o.to)} · ${i} units`,
        date: nowIso(),
      },
      ...getCollection(r, "adjustments"),
    ];
  }
  if (
    e === "replenishment" &&
    o.status === "Received" &&
    a?.status !== "Received"
  ) {
    const e = getCollection(r, "products");
    const t = e.find((e) => e.id === o.productId && !e._archived);
    if (!t) throw Error("The replenishment product is no longer available.");
    const n = allocateLocationStock(t, r);
    const i = Number(o.quantity || 0);
    const a = o.warehouseId || getActiveWarehouseIds(r)[0];
    if (!a) throw Error("Choose a warehouse for this replenishment.");
    n[a] = Number(n[a] || 0) + i;
    const s = {
      ...t,
      stock: Number(t.stock || 0) + i,
      locationStock: n,
      updatedAt: nowIso(),
    };
    r.collections.products = e.map((e) => (e.id === t.id ? s : e));
    r.collections.adjustments = [
      {
        id: createId(),
        productId: t.id,
        warehouseId: a,
        delta: i,
        before: Number(t.stock || 0),
        after: Number(s.stock),
        reason: `Replenishment received · ${getRecordLabel("suppliers", o.supplierId)}`,
        date: nowIso(),
      },
      ...getCollection(r, "adjustments"),
    ];
  }
  if (
    ((r.collections[e] = a ? i.map((e) => (e.id === n ? o : e)) : [o, ...i]),
    e === "applications" && o.status === "Approved" && a?.status !== "Approved")
  ) {
    const e = getCollection(r, "vendors");
    const t = e.find((e) => e.email === o.email);
    r.collections.vendors = t
      ? e.map((e) =>
          e.id === t.id
            ? {
                ...e,
                status: "Active",
              }
            : e,
        )
      : [
          ...e,
          {
            id: createId(),
            name: o.name,
            email: o.email,
            category: o.category,
            commission: 12,
            status: "Active",
          },
        ];
  }
  if (
    (e === "approvals" &&
      o.status === "Approved" &&
      (r.collections.products = getCollection(r, "products").map((e) =>
        e.id === o.productId
          ? {
              ...e,
              status: "Active",
            }
          : e,
      )),
    e === "cancellations" &&
      o.status === "Approved" &&
      (r.collections.orders = getCollection(r, "orders").map((e) => {
        if (e.id !== o.orderId) return e;
        const t =
          o.refundAction === "Refund required" &&
          ["Paid", "Partially refunded"].includes(e.payment)
            ? "Refund requested"
            : e.payment;
        return {
          ...e,
          status: "Cancelled",
          payment: t,
          updatedAt: nowIso(),
        };
      })),
    e === "refunds")
  ) {
    const e = r.collections.refunds || [];
    const t = e
      .filter((e) => e.orderId === o.orderId && e.status === "Completed")
      .reduce((e, t) => e + Number(t.amount || 0), 0);
    const n = e.some(
      (e) =>
        e.orderId === o.orderId &&
        [
          "Requested",
          "Under review",
          "Approved for processing",
          "Processing",
        ].includes(e.status),
    );
    const i = getCollection(r, "orders");
    const a = i.find((e) => e.id === o.orderId);
    if (a) {
      const e = calculateOrderTotal(a);
      let s = a.payment;
      if (t > 0) {
        s = t + 0.001 >= e ? "Refunded" : "Partially refunded";
      } else if (n) {
        s = "Refund requested";
      } else if (s === "Refund requested") {
        s = "Paid";
      }
      r.collections.orders = i.map((e) =>
        e.id === o.orderId
          ? {
              ...e,
              payment: s,
              updatedAt: nowIso(),
            }
          : e,
      );
    }
  }
  appendAuditEntry(r, a ? "Updated" : "Created", e, o);
  writeCommerceState(r);
  return o;
}

export function archiveRecords(e, t, n = false) {
  const r = readCommerceState();
  if (
    ((r.collections ||= {}),
    !n &&
      e !== "products" &&
      Object.values(modulesById).some(
        (n) =>
          !n.readonly &&
          (n.fields || []).some(
            (r) =>
              r.relation === e &&
              listRecords(n.id).some((e) => t.includes(e[r.key])),
          ),
      ))
  )
    throw Error(
      "These records are used by another module. Change their status instead of archiving them.",
    );
  r.collections[e] = getCollection(r, e).map((e) =>
    t.includes(e.id)
      ? {
          ...e,
          _archived: !n,
        }
      : e,
  );
  if (e === "products") {
    r.collections.variants = getCollection(r, "variants").map((e) =>
      t.includes(e.productId)
        ? {
            ...e,
            _archived: !n,
          }
        : e,
    );
    getCollection(r, "products")
      .filter((e) => t.includes(e.id))
      .forEach((t) =>
        appendAuditEntry(r, n ? "Restored product" : "Deleted product", e, t),
      );
  } else {
    appendAuditEntry(r, n ? "Restored" : "Archived", e, {
      id: `${t.length} record(s)`,
    });
  }
  writeCommerceState(r);
}
