// @ts-nocheck
import { formatCurrency, formatNumber } from "@/lib/format";
import { listRecords } from "@/lib/store/core";
import { getProductLocationStock } from "@/lib/store/inventory";

export const inventoryModuleIds = new Set([
  "warehouses",
  "transfers",
  "replenishment",
  "adjustments",
  "suppliers",
]);

export function getActiveWarehouses() {
  return listRecords("warehouses").filter((e) => e.status !== "Paused");
}

function getInventoryOrderItems(e) {
  return Array.isArray(e.items) && e.items.length
    ? e.items
    : e.productId
      ? [
          {
            productId: e.productId,
            quantity: Number(e.quantity || 1),
          },
        ]
      : [];
}

function getCommittedStock(e) {
  return listRecords("orders")
    .filter((e) =>
      ["Unfulfilled", "Processing", "Packed"].includes(String(e.status || "")),
    )
    .reduce(
      (t, n) =>
        t +
        getInventoryOrderItems(n)
          .filter((t) => String(t.productId || "") === e)
          .reduce((e, t) => e + Number(t.quantity || 0), 0),
      0,
    );
}

function getIncomingStock(e, t = "") {
  return listRecords("replenishment")
    .filter(
      (n) =>
        n.productId === e &&
        n.status === "Ordered" &&
        (!t || n.warehouseId === t),
    )
    .reduce((e, t) => e + Number(t.quantity || 0), 0);
}

export function getProductStockLevels(e, t = "") {
  const n = getProductLocationStock(e);
  const r = Object.fromEntries(
    Object.entries(n || {}).map(([e, t]) => [e, Number(t || 0)]),
  );
  const i = Number(e.stock || 0);
  const a = t ? Number(r[t] || 0) : i;
  const o = getCommittedStock(e.id);
  const s = t && i > 0 ? Math.min(a, Math.round((o * a) / i)) : o;
  const c = getIncomingStock(e.id, t);
  const l = Math.max(0, a - s);
  const u = Number(e.threshold ?? 15);
  return {
    locations: r,
    onHand: a,
    committed: s,
    incoming: c,
    available: l,
    threshold: u,
    status:
      e.status === "Draft"
        ? "Draft"
        : a <= 0
          ? "Out of stock"
          : l <= u
            ? "Low stock"
            : "Healthy",
    value: a * Number(e.cost || 0),
  };
}

export function getInventoryModuleSummary(e) {
  const t = listRecords(e);
  if (e === "warehouses") {
    const e = t.filter((e) => e.status === "Active");
    const n = t.reduce((e, t) => e + Number(t.capacity || 0), 0);
    const r = listRecords("products").reduce((e, n) => {
      const r = getProductLocationStock(n);
      return e + t.reduce((e, t) => e + Number(r?.[t.id] || 0), 0);
    }, 0);
    const i = n ? Math.round((r / n) * 100) : 0;
    return [
      ["Locations", t.length, `${e.length} active`],
      ["Units stored", formatNumber(r), "Across listed locations"],
      ["Capacity", formatNumber(n), "Configured unit capacity"],
      [
        "Capacity used",
        `${i}%`,
        i > 80 ? "Review available space" : "Room to grow",
      ],
    ];
  }
  if (e === "transfers") {
    const e = t.filter((e) => e.status !== "Received");
    const n = t.filter((e) => e.status === "Dispatched");
    const r = n.reduce((e, t) => e + Number(t.quantity || 0), 0);
    return [
      ["Transfers", t.length, `${e.length} open`],
      ["Units in motion", formatNumber(r), `${n.length} dispatched`],
      [
        "Drafts",
        t.filter((e) => e.status === "Draft").length,
        "Ready for review",
      ],
      [
        "Received",
        t.filter((e) => e.status === "Received").length,
        "Location balances updated",
      ],
    ];
  }
  if (e === "replenishment") {
    const e = t.filter((e) => e.status === "Ordered");
    const n = e.reduce((e, t) => e + Number(t.quantity || 0), 0);
    const r = e.reduce(
      (e, t) => e + Number(t.quantity || 0) * Number(t.unitCost || 0),
      0,
    );
    return [
      ["Purchase requests", t.length, `${e.length} ordered`],
      ["Incoming units", formatNumber(n), "Confirmed supplier stock"],
      ["Open cost", formatCurrency(r, 2), "At recorded unit cost"],
      [
        "Received",
        t.filter((e) => e.status === "Received").length,
        "Added to inventory",
      ],
    ];
  }
  if (e === "adjustments") {
    const e = t
      .filter((e) => Number(e.delta) > 0)
      .reduce((e, t) => e + Number(t.delta || 0), 0);
    const n = t
      .filter((e) => Number(e.delta) < 0)
      .reduce((e, t) => e + Math.abs(Number(t.delta || 0)), 0);
    const r = t.filter((e) => Number(e.delta) === 0).length;
    return [
      ["Audit events", t.length, "Inventory history"],
      ["Units added", formatNumber(e), "Positive adjustments"],
      ["Units removed", formatNumber(n), "Negative adjustments"],
      ["Transfers logged", r, "Zero-net movements"],
    ];
  }
  if (e === "suppliers") {
    const e = t.filter((e) => e.status === "Active");
    const n = e.length
      ? Math.round(
          e.reduce((e, t) => e + Number(t.leadTime || 0), 0) / e.length,
        )
      : 0;
    const r = listRecords("replenishment").filter(
      (e) => e.status === "Ordered",
    ).length;
    return [
      ["Suppliers", t.length, `${e.length} active`],
      ["Average lead time", `${n} days`, "Across active suppliers"],
      ["Open replenishments", r, "Awaiting receipt"],
      [
        "Paused suppliers",
        t.filter((e) => e.status === "Paused").length,
        "Not used for new orders",
      ],
    ];
  }
  return [["Total records", t.length, e]];
}
