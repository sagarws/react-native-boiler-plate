// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import {
  appendAuditEntry,
  createId,
  findRecord,
  getCollection,
  listRecords,
  nowIso,
  readCommerceState,
  writeCommerceState,
} from "@/lib/store/core";

export function calculateOrderTotal(e) {
  const t = (
    e.items?.length
      ? e.items
      : [
          {
            productId: e.productId,
            quantity: e.quantity,
            unitPrice: findRecord("products", e.productId)?.price || 0,
          },
        ]
  ).reduce((e, t) => e + Number(t.unitPrice) * Number(t.quantity), 0);
  return (
    Math.round(
      (t +
        Number(e.shipping || 0) +
        Number(e.tax || 0) -
        Number(e.discount || 0)) *
        100,
    ) / 100
  );
}

export function toDateOnly(e = nowIso()) {
  return String(e).slice(0, 10);
}

function buildTrackingNumber(e) {
  return `VLX-${String(e.number || e.id)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()}`;
}

function upsertOrderLinkedRow(e, t, n) {
  const r = e.find((e) => e.orderId === t && !e._archived);
  const i = r
    ? {
        ...r,
        ...n,
        updatedAt: nowIso(),
      }
    : {
        id: createId(),
        orderId: t,
        ...n,
        updatedAt: nowIso(),
      };
  return {
    row: i,
    rows: r ? e.map((e) => (e.id === r.id ? i : e)) : [i, ...e],
  };
}

export function updateOrderStatus(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "orders");
  const i = r.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This order is no longer available.");
  if (
    !(
      modulesById.orders?.fields?.find((e) => e.key === "status")?.options || []
    ).includes(t)
  )
    throw Error("Choose a valid order status.");
  if (i.status === "Delivered" && t === "Cancelled")
    throw Error(
      "A delivered order cannot be cancelled. Create a return or refund instead.",
    );
  if (i.status === "Cancelled" && t !== "Cancelled")
    throw Error("A cancelled order cannot be moved back into fulfillment.");
  const a = {
    ...i,
    status: t,
    updatedAt: nowIso(),
  };
  if (
    ((n.collections ||= {}),
    (n.collections.orders = r.map((t) => (t.id === e ? a : t))),
    ["Processing", "Packed", "Shipped", "Delivered"].includes(t))
  ) {
    const r =
      t === "Processing"
        ? "Picking"
        : t === "Packed"
          ? "Packed"
          : t === "Delivered"
            ? "Delivered"
            : "In transit";
    const i = upsertOrderLinkedRow(getCollection(n, "fulfillment"), e, {
      carrier: "Local courier",
      tracking: buildTrackingNumber(a),
      warehouseId: "warehouses-1",
      eta:
        t === "Delivered"
          ? toDateOnly()
          : toDateOnly(new Date(Date.now() + 2592e5).toISOString()),
      status: r,
    });
    n.collections.fulfillment = i.rows;
  }
  if (["Shipped", "Delivered"].includes(t)) {
    const r = upsertOrderLinkedRow(getCollection(n, "deliveries"), e, {
      method: a.deliveryMethod || "Standard delivery",
      courier: "Local courier",
      tracking: buildTrackingNumber(a),
      milestone: t === "Delivered" ? "Delivered" : "In transit",
      dispatchDate: toDateOnly(),
      eta:
        t === "Delivered"
          ? toDateOnly()
          : toDateOnly(new Date(Date.now() + 2592e5).toISOString()),
      deliveredDate: t === "Delivered" ? toDateOnly() : "",
      status: t === "Delivered" ? "Delivered" : "In transit",
    });
    n.collections.deliveries = r.rows;
  }
  if (t === "Cancelled") {
    const t = getCollection(n, "cancellations");
    if (!t.some((t) => t.orderId === e && !t._archived)) {
      n.collections.cancellations = [
        {
          id: createId(),
          orderId: e,
          reason: "Cancelled from order workspace",
          status: "Approved",
          notes: "Recorded by the order quick action.",
          updatedAt: nowIso(),
        },
        ...t,
      ];
    }
  }
  appendAuditEntry(n, `Order moved to ${t}`, "orders", a);
  writeCommerceState(n);
  return a;
}

export function updateOrderPaymentStatus(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "orders");
  const i = r.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This order is no longer available.");
  if (
    !(
      modulesById.orders?.fields?.find((e) => e.key === "payment")?.options ||
      []
    ).includes(t)
  )
    throw Error("Choose a valid payment status.");
  const a = {
    ...i,
    payment: t,
    updatedAt: nowIso(),
  };
  n.collections ||= {};
  n.collections.orders = r.map((t) => (t.id === e ? a : t));
  appendAuditEntry(n, `Payment marked ${t}`, "orders", a);
  writeCommerceState(n);
  return a;
}

export function updateFulfillmentStatus(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "fulfillment");
  const i = r.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This fulfillment record is no longer available.");
  if (
    !(
      modulesById.fulfillment?.fields?.find((e) => e.key === "status")
        ?.options || []
    ).includes(t)
  )
    throw Error("Choose a valid fulfillment status.");
  if (i.status === "Delivered" && t !== "Delivered")
    throw Error(
      "A delivered fulfillment cannot be moved back to an earlier stage.",
    );
  const a = {
    ...i,
    status: t,
    exception:
      t === "Delayed" ? i.exception || "Carrier or warehouse exception" : "",
    updatedAt: nowIso(),
  };
  n.collections ||= {};
  n.collections.fulfillment = r.map((t) => (t.id === e ? a : t));
  const o = getCollection(n, "orders");
  const s = o.find((e) => e.id === i.orderId && !e._archived);
  const c = {
    Picking: "Processing",
    Packed: "Packed",
    "In transit": "Shipped",
    Delayed: "Shipped",
    Delivered: "Delivered",
  }[t];
  if (s && s.status !== "Cancelled" && c) {
    const e = {
      ...s,
      status: c,
      updatedAt: nowIso(),
    };
    n.collections.orders = o.map((t) => (t.id === s.id ? e : t));
    appendAuditEntry(n, `Fulfillment moved to ${t}`, "orders", e);
  }
  if (["In transit", "Delayed", "Delivered"].includes(t)) {
    const e = getCollection(n, "deliveries");
    const r =
      t === "Delivered"
        ? "Delivered"
        : t === "Delayed"
          ? "Delayed"
          : "In transit";
    const a =
      t === "Delivered"
        ? "Delivered"
        : t === "Delayed"
          ? "At local facility"
          : "In transit";
    const o = upsertOrderLinkedRow(e, i.orderId, {
      method: s?.deliveryMethod || "Standard delivery",
      courier: i.carrier || "Local courier",
      service: i.service || "Standard",
      tracking: i.tracking || buildTrackingNumber(s || i),
      milestone: a,
      dispatchDate:
        (t === "Delivered" &&
          e.find((e) => e.orderId === i.orderId)?.dispatchDate) ||
        toDateOnly(),
      eta: i.eta || toDateOnly(new Date(Date.now() + 2592e5).toISOString()),
      deliveredDate: t === "Delivered" ? toDateOnly() : "",
      exceptionType: t === "Delayed" ? "Carrier delay" : "None",
      exceptionNote:
        t === "Delayed" ? i.exception || "Shipment needs attention." : "",
      status: r,
    });
    n.collections.deliveries = o.rows;
  }
  appendAuditEntry(n, `Fulfillment marked ${t}`, "fulfillment", a);
  writeCommerceState(n);
  return a;
}

export function updateDeliveryStatus(e, t, n = "") {
  const r = readCommerceState();
  const i = getCollection(r, "deliveries");
  const a = i.find((t) => t.id === e && !t._archived);
  if (!a) throw Error("This delivery record is no longer available.");
  if (
    !(
      modulesById.deliveries?.fields?.find((e) => e.key === "status")
        ?.options || []
    ).includes(t)
  )
    throw Error("Choose a valid delivery status.");
  if (a.status === "Delivered" && t !== "Delivered")
    throw Error(
      "A delivered shipment cannot be moved back to an earlier stage.",
    );
  const o =
    {
      "Ready to dispatch": "Label created",
      Shipped: "Picked up",
      "In transit": "In transit",
      "Out for delivery": "Out for delivery",
      Delivered: "Delivered",
      "Delivery attempted": "Out for delivery",
      Delayed: a.milestone || "At local facility",
      Failed: a.milestone || "At local facility",
    }[t] || a.milestone;
  const s = {
    ...a,
    status: t,
    milestone: o,
    dispatchDate: [
      "Shipped",
      "In transit",
      "Out for delivery",
      "Delivered",
      "Delivery attempted",
      "Delayed",
      "Failed",
    ].includes(t)
      ? a.dispatchDate || toDateOnly()
      : a.dispatchDate,
    deliveredDate: t === "Delivered" ? toDateOnly() : "",
    exceptionType: ["Delayed", "Delivery attempted", "Failed"].includes(t)
      ? a.exceptionType === "None" || !a.exceptionType
        ? t === "Delivery attempted"
          ? "Delivery attempted"
          : "Carrier delay"
        : a.exceptionType
      : "None",
    exceptionNote: ["Delayed", "Delivery attempted", "Failed"].includes(t)
      ? n || a.exceptionNote || "Shipment needs attention."
      : "",
    updatedAt: nowIso(),
  };
  r.collections ||= {};
  r.collections.deliveries = i.map((t) => (t.id === e ? s : t));
  const c = getCollection(r, "orders");
  const l = c.find((e) => e.id === a.orderId && !e._archived);
  if (l && l.status !== "Cancelled") {
    const e =
      t === "Delivered"
        ? "Delivered"
        : [
              "Shipped",
              "In transit",
              "Out for delivery",
              "Delivery attempted",
              "Delayed",
              "Failed",
            ].includes(t)
          ? "Shipped"
          : l.status;
    const n = {
      ...l,
      status: e,
      updatedAt: nowIso(),
    };
    r.collections.orders = c.map((e) => (e.id === l.id ? n : e));
  }
  const u = getCollection(r, "fulfillment");
  const d = u.find((e) => e.orderId === a.orderId && !e._archived);
  if (d) {
    const e =
      t === "Delivered"
        ? "Delivered"
        : ["Delayed", "Failed", "Delivery attempted"].includes(t)
          ? "Delayed"
          : ["Shipped", "In transit", "Out for delivery"].includes(t)
            ? "In transit"
            : d.status;
    r.collections.fulfillment = u.map((t) =>
      t.id === d.id
        ? {
            ...t,
            status: e,
            exception: e === "Delayed" ? s.exceptionNote : "",
            updatedAt: nowIso(),
          }
        : t,
    );
  }
  appendAuditEntry(r, `Delivery marked ${t}`, "deliveries", s);
  writeCommerceState(r);
  return s;
}

export function getOrderActivity(e) {
  const t = findRecord("orders", e);
  const n = listRecords("orders", {
    archived: true,
  }).find((t) => t.id === e);
  const r = t || n;
  if (!r) return [];
  const i = modulesById.orders?.title || "Orders";
  return listRecords("audit")
    .filter(
      (t) => t.recordId === e || (t.resource === i && t.record === r.number),
    )
    .slice(0, 50);
}
