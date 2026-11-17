// @ts-nocheck
import { calculateCommissionBreakdown } from "@/features/marketplace/lib/commission";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

export function buildReportData(e, t = 30) {
  const n = new Date("2026-05-01T00:00:00Z");
  const r = new Date(n.getTime() - t * 864e5);
  const i = listRecords("orders").filter(
    (e) => e.date && new Date(e.date) >= r && new Date(e.date) < n,
  );
  const a = i.filter((e) => e.status !== "Cancelled");
  const o = (e, t, n) =>
    Object.entries(
      e.reduce((e, r) => {
        const i = t(r);
        e[i] = (e[i] || 0) + n(r);
        return e;
      }, {}),
    ).map(([e, t]) => ({
      name: e,
      value: Math.round(t * 100) / 100,
    }));
  let s;
  let c;
  let l = "count";
  let u = "Sample order book · April 2026";
  if (e === "sales") {
    s = o(a, (e) => e.date, calculateOrderTotal).sort((e, t) =>
      e.name.localeCompare(t.name),
    );
    c = "Order value";
    l = "money";
  } else if (e === "orders") {
    s = o(
      i,
      (e) => e.status,
      () => 1,
    );
    c = "Orders";
  } else if (e === "products") {
    s = o(
      a.flatMap((e) => e.items || []),
      (e) => getRecordLabel("products", e.productId),
      (e) => e.quantity * e.unitPrice,
    );
    c = "Product revenue";
    l = "money";
  } else if (e === "inventory") {
    s = listRecords("products").map((e) => ({
      name: e.name,
      value: Number(e.stock),
      detail:
        Number(e.stock) === 0
          ? "Out of stock"
          : Number(e.stock) <= Number(e.threshold)
            ? "Low stock"
            : "In stock",
    }));
    c = "Available units";
    u = "Current inventory snapshot · not date-filtered";
  } else if (e === "customers") {
    s = o(
      a,
      (e) => getRecordLabel("customers", e.customerId),
      calculateOrderTotal,
    );
    c = "Customer order value";
    l = "money";
  } else if (e === "returns") {
    const e = new Set(i.map((e) => e.id));
    s = o(
      listRecords("returns").filter((t) => e.has(t.orderId)),
      (e) => e.reason,
      (e) => Number(e.quantity),
    );
    c = "Returned units";
  } else if (e === "channels") {
    s = o(a, (e) => e.channel || "Website", calculateOrderTotal);
    c = "Channel order value";
    l = "money";
  } else if (e === "payments") {
    s = o(
      listRecords("transactions").filter(
        (e) =>
          e.date &&
          new Date(e.date) >= r &&
          new Date(e.date) < n &&
          e.status === "Succeeded",
      ),
      (e) => e.provider,
      (e) => Number(e.amount),
    );
    c = "Successful payments";
    l = "money";
  } else if (e === "marketing") {
    s = o(
      listRecords("campaigns"),
      (e) => e.channel,
      (e) => Number(e.budget),
    );
    c = "Planned campaign budget";
    l = "money";
    u = "Current campaign plans · budget, not actual spend · not date-filtered";
  } else {
    const e = new Set(i.map((e) => e.id));
    const t = listRecords("commissions");
    s = o(
      listRecords("vendor-orders").filter((t) => e.has(t.orderId)),
      (e) => getRecordLabel("vendors", e.vendorId),
      (e) =>
        calculateCommissionBreakdown(
          e,
          findRecord("vendors", e.vendorId) || {},
          t,
        ).vendorNet,
    );
    c = "Vendor net";
    l = "money";
    u =
      "Marketplace vendor settlements · historical commission snapshots preserved";
  }
  return {
    rows: s,
    metric: c,
    unit: l,
    note: u,
    total: s.reduce((e, t) => e + t.value, 0),
    orders: i.length,
    start: r.toISOString().slice(0, 10),
    end: "2026-04-30",
  };
}
