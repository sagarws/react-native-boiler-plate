// @ts-nocheck
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

function readPulseCollection(e) {
  return listRecords(e);
}

function toSafeNumber(e) {
  return Number.isFinite(Number(e)) ? Number(e) : 0;
}

function toTrimmedString(e) {
  return String(e ?? "").trim();
}

function clampPercent(e) {
  return Math.max(0, Math.min(100, Math.round(e)));
}

function healthStatusFromScore(e) {
  return e >= 90 ? "healthy" : e >= 65 ? "degraded" : "offline";
}

function getRecordTimestamp(
  e,
  t = [
    "updatedAt",
    "date",
    "submittedAt",
    "openedAt",
    "requestedAt",
    "createdAt",
  ],
) {
  for (const n of t) {
    const t = Date.parse(toTrimmedString(e[n]));
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function getLatestRecordTimestamp(e) {
  return (
    Math.max(0, ...e.flat().map((e) => getRecordTimestamp(e))) || Date.now()
  );
}

function formatPulseMonthDay(e) {
  const t = typeof e == "number" ? e : Date.parse(toTrimmedString(e));
  return Number.isFinite(t)
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(t))
    : "—";
}

function formatPulseRelativeTime(e) {
  const t = Date.parse(toTrimmedString(e));
  if (!Number.isFinite(t)) return "Updated";
  const n = Math.max(0, Date.now() - t);
  const r = 6e4;
  const i = 60 * r;
  const a = 24 * i;
  return n < r
    ? "Just now"
    : n < i
      ? `${Math.max(1, Math.floor(n / r))}m ago`
      : n < a
        ? `${Math.max(1, Math.floor(n / i))}h ago`
        : n < 7 * a
          ? `${Math.max(1, Math.floor(n / a))}d ago`
          : formatPulseMonthDay(t);
}

function deliveryStatusTone(e) {
  const t = e.toLowerCase();
  return t.includes("delay") || t.includes("fail") || t.includes("exception")
    ? "danger"
    : t.includes("deliver")
      ? "success"
      : t.includes("transit") || t.includes("dispatch") || t.includes("ship")
        ? "info"
        : "neutral";
}

function formatWholeNumber(e) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(e);
}

function countOrderUnits(e) {
  const t = Array.isArray(e.items) ? e.items : [];
  return t.length
    ? t.reduce((e, t) => e + Math.max(0, toSafeNumber(t.quantity)), 0)
    : Math.max(1, toSafeNumber(e.quantity));
}

function formatDeliveryDestination(e) {
  if (!e) return "Destination pending";
  const t = findRecord("customers", toTrimmedString(e.customerId));
  const n = toTrimmedString(t?.city);
  const r = toTrimmedString(t?.country);
  return n && r
    ? `${n}, ${r}`
    : n || r || toTrimmedString(e.shippingAddress) || "Destination pending";
}

function averageDeliveryDays(e) {
  const t = e.flatMap((e) => {
    const t = Date.parse(toTrimmedString(e.dispatchDate));
    const n = Date.parse(toTrimmedString(e.deliveredDate));
    return Number.isFinite(t) && Number.isFinite(n) && n >= t
      ? [(n - t) / 864e5]
      : [];
  });
  return t.length ? t.reduce((e, t) => e + t, 0) / t.length : 0;
}

function buildHealthDomain(e, t, n, r) {
  const i = clampPercent(n);
  return {
    id: e,
    label: t,
    score: i,
    status: healthStatusFromScore(i),
    detail: r,
  };
}

export function buildStorePulseSnapshot(e) {
  const t = readPulseCollection("products");
  const n = readPulseCollection("orders");
  const r = readPulseCollection("fulfillment");
  const i = readPulseCollection("deliveries");
  const a = readPulseCollection("customers");
  const o = readPulseCollection("vendors");
  const s = readPulseCollection("applications");
  const c = readPulseCollection("approvals");
  const l = readPulseCollection("payouts");
  const u = readPulseCollection("disputes");
  const d = readPulseCollection("transactions");
  const f = readPulseCollection("refunds");
  const p = readPulseCollection("abandoned");
  const m = readPulseCollection("replenishment");
  const h = readPulseCollection("transfers");
  const g = t.filter((e) => toTrimmedString(e.status) === "Active");
  const _ = t.filter((e) => toTrimmedString(e.status) === "Draft");
  const v = g.filter(
    (e) =>
      toSafeNumber(e.stock) > 0 &&
      toSafeNumber(e.stock) <= Math.max(1, toSafeNumber(e.threshold) || 15),
  );
  const y = g.filter((e) => toSafeNumber(e.stock) <= 0);
  const b = a.filter((e) => toTrimmedString(e.status) === "Active");
  const x = b.filter((e) =>
    ["Returning", "VIP"].includes(toTrimmedString(e.segment)),
  );
  const S = n.filter((e) => toTrimmedString(e.status) === "Cancelled");
  const C = n.filter((e) => toTrimmedString(e.status) === "Unfulfilled");
  const w = n.filter((e) =>
    ["Pending", "Failed", "Requires action"].includes(
      toTrimmedString(e.payment),
    ),
  );
  const T = r.filter(
    (e) =>
      toTrimmedString(e.status) === "Delayed" || toTrimmedString(e.exception),
  );
  const E = i.filter(
    (e) =>
      toTrimmedString(e.status) === "Delayed" ||
      !["", "None"].includes(toTrimmedString(e.exceptionType)),
  );
  const D = o.filter(
    (e) =>
      toTrimmedString(e.status) !== "Active" ||
      toTrimmedString(e.kyc) !== "Verified",
  );
  const O = s.filter(
    (e) => !["Approved", "Rejected"].includes(toTrimmedString(e.status)),
  );
  const k = c.filter(
    (e) => !["Approved", "Rejected"].includes(toTrimmedString(e.status)),
  );
  const A = l.filter((e) =>
    ["On hold", "Failed"].includes(toTrimmedString(e.status)),
  );
  const j = u.filter(
    (e) => !["Resolved", "Closed"].includes(toTrimmedString(e.status)),
  );
  const M = d.filter((e) =>
    ["Requires action", "Failed"].includes(toTrimmedString(e.status)),
  );
  const N = d.filter((e) => toTrimmedString(e.risk) === "Review");
  const ee = f.filter(
    (e) =>
      !["Completed", "Rejected", "Cancelled"].includes(
        toTrimmedString(e.status),
      ),
  );
  const te = p.filter((e) => toTrimmedString(e.status) !== "Recovered");
  const ne = m.filter((e) =>
    ["Ordered", "Draft"].includes(toTrimmedString(e.status)),
  );
  const re = m.filter((e) => toTrimmedString(e.status) === "Ordered");
  const ie = h.filter((e) => toTrimmedString(e.status) === "Dispatched");
  const ae = 100 - v.length * 2.5 - y.length * 7 - _.length * 2;
  const oe =
    100 -
    v.length * 2 -
    y.length * 8 -
    (ne.length ? Math.max(0, y.length - ne.length) * 2 : y.length * 2);
  const se =
    100 -
    T.length * 5 -
    C.length * 4 -
    w.length * 3 -
    S.length * 2 -
    ee.length * 2 -
    te.length * 1.5;
  const ce = b.length ? (b.length / Math.max(1, a.length)) * 100 : 0;
  const le =
    100 -
    j.length * 5 -
    D.length * 4 -
    O.length * 2 -
    k.length * 2 -
    A.length * 4;
  const ue = 100 - M.length * 7 - N.length * 2;
  const de = 100 - E.length * 8 - T.length * 4;
  const fe = [
    buildHealthDomain(
      "catalog",
      "Catalog",
      ae,
      `${g.length} active · ${v.length} low · ${y.length} out`,
    ),
    buildHealthDomain(
      "inventory",
      "Inventory",
      oe,
      `${formatWholeNumber(g.reduce((e, t) => e + toSafeNumber(t.stock), 0))} units · ${ne.length} replenishment open`,
    ),
    buildHealthDomain(
      "orders",
      "Orders",
      se,
      `${C.length} unfulfilled · ${w.length} payment pending · ${te.length} abandoned`,
    ),
    buildHealthDomain(
      "customers",
      "Customers",
      ce,
      `${b.length}/${a.length || 0} active customers`,
    ),
    buildHealthDomain(
      "marketplace",
      "Marketplace",
      le,
      `${j.length} disputes · ${k.length} listing reviews`,
    ),
    buildHealthDomain(
      "payments",
      "Payments",
      ue,
      `${M.length} action required · ${N.length} risk review`,
    ),
    buildHealthDomain(
      "carriers",
      "Carriers",
      de,
      `${E.length} delayed delivery · ${T.length} fulfillment exception`,
    ),
  ];
  const pe = clampPercent(
    [
      ["catalog", 0.16],
      ["inventory", 0.2],
      ["orders", 0.18],
      ["customers", 0.08],
      ["marketplace", 0.14],
      ["payments", 0.1],
      ["carriers", 0.14],
    ].reduce(
      (e, [t, n]) => e + (fe.find((e) => e.id === t)?.score || 0) * n,
      0,
    ),
  );
  const me = fe
    .filter((e) => e.status !== "healthy")
    .sort((e, t) => e.score - t.score);
  const he = me.length
    ? `Needs attention: ${me
        .slice(0, 3)
        .map((e) => e.label.toLowerCase())
        .join(", ")}`
    : "All operating areas are healthy";
  const ge = pe >= 90 ? "green" : pe >= 70 ? "amber" : "red";
  const _e = getLatestRecordTimestamp([t, n, r, i, a, o, d]);
  const ve = new Date(_e).toISOString();
  const ye = [
    {
      id: `health-${pe}`,
      kind: "health",
      title: `Store health · ${pe}%`,
      detail: he,
      tone: ge,
      occurredAt: ve,
    },
  ];
  const be = [...i]
    .filter(
      (e) => !["Delivered", "Cancelled"].includes(toTrimmedString(e.status)),
    )
    .sort(
      (e, t) =>
        getRecordTimestamp(t, ["dispatchDate", "eta"]) -
        getRecordTimestamp(e, ["dispatchDate", "eta"]),
    )[0];
  if (be) {
    const e =
      toTrimmedString(be.status) === "Delayed" ||
      !["", "None"].includes(toTrimmedString(be.exceptionType));
    const t = toTrimmedString(be.courier) || "Carrier";
    const n =
      toTrimmedString(be.tracking) ||
      getRecordLabel("orders", toTrimmedString(be.orderId));
    ye.push({
      id: `delivery-${be.id}`,
      kind: "delivery",
      title: e ? "Delivery needs attention" : "Delivery in progress",
      detail: `${t} · ${n}${toTrimmedString(be.eta) ? ` · ETA ${formatPulseMonthDay(be.eta)}` : ""}`,
      tone: e ? "red" : "green",
      occurredAt: new Date(
        getRecordTimestamp(be, ["dispatchDate", "eta"]) || _e,
      ).toISOString(),
    });
  }
  const xe = [...re].sort(
    (e, t) => getRecordTimestamp(e, ["eta"]) - getRecordTimestamp(t, ["eta"]),
  )[0];
  const Se = [...ie].sort(
    (e, t) => getRecordTimestamp(t, ["date"]) - getRecordTimestamp(e, ["date"]),
  )[0];
  if (xe) {
    ye.push({
      id: `intake-${xe.id}`,
      kind: "intake",
      title: `${formatWholeNumber(toSafeNumber(xe.quantity))} units inbound to warehouse`,
      detail: `${getRecordLabel("products", toTrimmedString(xe.productId))} · ${getRecordLabel("warehouses", toTrimmedString(xe.warehouseId))}${toTrimmedString(xe.eta) ? ` · ETA ${formatPulseMonthDay(xe.eta)}` : ""}`,
      tone: "blue",
      occurredAt: ve,
    });
  } else if (Se) {
    ye.push({
      id: `intake-${Se.id}`,
      kind: "intake",
      title: `${formatWholeNumber(toSafeNumber(Se.quantity))} units moving between warehouses`,
      detail: `${getRecordLabel("products", toTrimmedString(Se.productId))} · ${getRecordLabel("warehouses", toTrimmedString(Se.to))}`,
      tone: "blue",
      occurredAt: ve,
    });
  }
  const Ce = g.reduce((e, t) => e + Math.max(0, toSafeNumber(t.stock)), 0);
  const we = g.filter(
    (e) => toSafeNumber(e.stock) > Math.max(1, toSafeNumber(e.threshold) || 15),
  );
  if (
    (Ce > 0 &&
      ye.push({
        id: `stock-${Ce}`,
        kind: "stock",
        title: `${formatWholeNumber(Ce)} units available`,
        detail: `${we.length} products are above their low-stock threshold`,
        tone: "green",
        occurredAt: ve,
      }),
    y.length)
  ) {
    const e = y[0];
    ye.push({
      id: `out-${e.id}`,
      kind: "low-stock",
      title: `${toTrimmedString(e.name)} · out of stock`,
      detail: "0 units available · replenish now",
      tone: "red",
      occurredAt: ve,
    });
  } else if (v.length) {
    const e = [...v].sort(
      (e, t) => toSafeNumber(e.stock) - toSafeNumber(t.stock),
    )[0];
    ye.push({
      id: `low-${e.id}`,
      kind: "low-stock",
      title: `${toTrimmedString(e.name)} · low stock`,
      detail: `${toSafeNumber(e.stock)} units left · threshold ${Math.max(1, toSafeNumber(e.threshold) || 15)}`,
      tone: "amber",
      occurredAt: ve,
    });
  }
  const Te = averageDeliveryDays(i);
  const Ee = [
    {
      icon: "package",
      label: "Products",
      description: "Active products",
      value: formatWholeNumber(g.length),
      detail: `${v.length + y.length} need attention`,
      tone: "amber",
      detailTone: v.length + y.length ? "warning" : "success",
    },
    {
      icon: "users",
      label: "Customers",
      description: "Current customers",
      value: formatWholeNumber(a.length),
      detail: `${b.length} active`,
      tone: "neutral",
      detailTone: "success",
    },
    {
      icon: "users",
      label: "Returning",
      description: "Returning/VIP customers",
      value: `${b.length ? Math.round((x.length / b.length) * 100) : 0}%`,
      detail: `${x.length} retained`,
      tone: "neutral",
      detailTone: "success",
    },
    {
      icon: "truck",
      label: "Delivery",
      description: "Average delivered transit time",
      value: Te ? `${Te.toFixed(1)} d` : "—",
      detail: `${E.length} delayed`,
      tone: "amber",
      detailTone: E.length ? "danger" : "success",
    },
  ];
  const De = n.filter((e) => toTrimmedString(e.status) !== "Cancelled");
  const Oe = Math.max(1, De.length);
  const ke = (e) =>
    De.filter((t) => e.includes(toTrimmedString(t.status))).length;
  const Ae = [
    {
      label: "Orders received",
      count: De.length,
      ratio: 1,
      color: "amber",
      icon: "clipboard-text",
    },
    {
      label: "Processing",
      count: ke(["Processing", "Packed", "Shipped", "Delivered"]),
      ratio: ke(["Processing", "Packed", "Shipped", "Delivered"]) / Oe,
      color: "green",
      icon: "timer",
    },
    {
      label: "Packed",
      count: ke(["Packed", "Shipped", "Delivered"]),
      ratio: ke(["Packed", "Shipped", "Delivered"]) / Oe,
      color: "green",
      icon: "package",
    },
    {
      label: "Shipped",
      count: ke(["Shipped", "Delivered"]),
      ratio: ke(["Shipped", "Delivered"]) / Oe,
      color: "green",
      icon: "truck",
    },
    {
      label: "Delivered",
      count: ke(["Delivered"]),
      ratio: ke(["Delivered"]) / Oe,
      color: "green",
      icon: "check-circle",
    },
  ];
  const je = [...i]
    .sort((e, t) =>
      toTrimmedString(e.status) === "Delayed"
        ? -1
        : toTrimmedString(t.status) === "Delayed"
          ? 1
          : getRecordTimestamp(t, ["dispatchDate", "deliveredDate", "eta"]) -
            getRecordTimestamp(e, ["dispatchDate", "deliveredDate", "eta"]),
    )
    .slice(0, 4)
    .map((e) => ({
      id:
        toTrimmedString(
          findRecord("orders", toTrimmedString(e.orderId))?.number,
        ) ||
        toTrimmedString(e.tracking) ||
        e.id,
      status:
        toTrimmedString(e.status) || toTrimmedString(e.milestone) || "Pending",
      tone: deliveryStatusTone(
        toTrimmedString(e.status) || toTrimmedString(e.milestone),
      ),
      time:
        toTrimmedString(e.status) === "Delivered"
          ? formatPulseMonthDay(e.deliveredDate)
          : toTrimmedString(e.eta)
            ? formatPulseMonthDay(e.eta)
            : formatPulseRelativeTime(e.dispatchDate),
    }));
  const Me = [...n]
    .sort((e, t) => getRecordTimestamp(t) - getRecordTimestamp(e))
    .slice(0, 8)
    .map((e) => ({
      id: toTrimmedString(e.number) || e.id,
      customer: getRecordLabel("customers", toTrimmedString(e.customerId)),
      items: countOrderUnits(e),
      amount: calculateOrderTotal(e),
      status:
        toTrimmedString(e.payment) || toTrimmedString(e.status) || "Pending",
      time: formatPulseRelativeTime(e.updatedAt || e.date),
    }));
  const Ne = [...i]
    .sort(
      (e, t) =>
        getRecordTimestamp(t, ["deliveredDate", "dispatchDate", "eta"]) -
        getRecordTimestamp(e, ["deliveredDate", "dispatchDate", "eta"]),
    )
    .slice(0, 6)
    .map((e) => {
      const t = findRecord("orders", toTrimmedString(e.orderId));
      return {
        tracking:
          toTrimmedString(e.tracking) || toTrimmedString(t?.number) || e.id,
        customer: t
          ? getRecordLabel("customers", toTrimmedString(t.customerId))
          : "Customer",
        destination: formatDeliveryDestination(t),
        status:
          toTrimmedString(e.status) ||
          toTrimmedString(e.milestone) ||
          "Pending",
        tone: deliveryStatusTone(
          toTrimmedString(e.status) || toTrimmedString(e.milestone),
        ),
        eta:
          toTrimmedString(e.status) === "Delivered"
            ? formatPulseMonthDay(e.deliveredDate)
            : toTrimmedString(e.eta)
              ? formatPulseMonthDay(e.eta)
              : "Pending",
      };
    });
  const Pe = {
    tee: "t-shirt",
    backpack: "backpack",
    mug: "coffee",
    tote: "tote",
    mouse: "mouse",
    bottle: "thermometer",
    notebook: "notebook",
  };
  const Fe = [...g]
    .sort((e, t) => toSafeNumber(t.sold) - toSafeNumber(e.sold))
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      name: toTrimmedString(e.name) || "Product",
      sold: toSafeNumber(e.sold),
      price: toSafeNumber(e.price),
      icon: Pe[toTrimmedString(e.image)] || "package",
      image: toTrimmedString(e.image),
    }));
  return {
    signature: [
      pe,
      v.length,
      y.length,
      E.length,
      T.length,
      w.length,
      j.length,
      k.length,
      D.length,
      M.length,
      t.map((e) => `${e.id}:${e.stock}:${e.status}`).join("|"),
      n.map((e) => `${e.id}:${e.status}:${e.payment}`).join("|"),
      i
        .map((e) => `${e.id}:${e.status}:${e.exceptionType}:${e.tracking}`)
        .join("|"),
      m.map((e) => `${e.id}:${e.status}:${e.quantity}:${e.eta}`).join("|"),
      h.map((e) => `${e.id}:${e.status}:${e.quantity}`).join("|"),
    ].join("::"),
    health: {
      score: pe,
      tone: ge,
      detail: he,
      domains: fe,
    },
    events: ye,
    metrics: Ee,
    fulfillment: Ae,
    shipments: je,
    recentSales: Me,
    recentDeliveries: Ne,
    topProducts: Fe,
  };
}
