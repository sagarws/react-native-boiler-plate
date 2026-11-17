// @ts-nocheck
import {
  calculateCommissionBreakdown,
  findApplicableCommissionRule,
  normalizeCommissionRule,
} from "@/features/marketplace/lib/commission";
import { findRecord, listRecords } from "@/lib/store/core";

function inferVendorBrand(e) {
  return e.brand
    ? String(e.brand)
    : /northline/i.test(String(e.name || ""))
      ? "Northline"
      : /forma/i.test(String(e.name || ""))
        ? "Forma"
        : "Veylix Studio";
}

export function getVendorProducts(e) {
  const t = inferVendorBrand(e);
  const n = listRecords("products");
  const r = n.filter((e) => e.brand === t);
  return r.length ? r : n.filter((t) => t.category === e.category);
}

export function getVendorOrders(e) {
  return listRecords("vendor-orders").filter((t) => t.vendorId === e.id);
}

export function getVendorPayouts(e) {
  return listRecords("payouts").filter((t) => t.vendorId === e.id);
}

export function getVendorCommissionRule(e) {
  return normalizeCommissionRule(
    findApplicableCommissionRule({
      vendor: e,
      date: new Date().toISOString().slice(0, 10),
      rules: listRecords("commissions"),
    }) || {},
    e,
  );
}

export function buildVendorPerformance(e) {
  const t = getVendorOrders(e);
  const n = getVendorProducts(e);
  const r = listRecords("commissions");
  const i = t.map((t) => calculateCommissionBreakdown(t, e, r));
  return {
    vendor: e,
    products: n.length,
    orders: t.length,
    gmv: i.reduce((e, t) => e + Number(t.shopperGross || 0), 0),
    commission: i.reduce(
      (e, t) => e + Number(t.netCommission || 0) + Number(t.otherFees || 0),
      0,
    ),
    payable: i.reduce((e, t) => e + Number(t.vendorNet || 0), 0),
    refunds: i.reduce((e, t) => e + Number(t.refundExposure || 0), 0),
    queued: getVendorPayouts(e)
      .filter((e) =>
        ["Draft", "Ready for processing", "Processing", "On hold"].includes(
          String(e.status || ""),
        ),
      )
      .reduce((e, t) => e + Number(t.amount || 0), 0),
    rating: Number(e.rating || 0),
  };
}

export function buildMarketplaceOverview() {
  const e = listRecords("vendors");
  const t = listRecords("vendor-orders");
  const n = listRecords("commissions");
  const r = t.map((e) =>
    calculateCommissionBreakdown(
      e,
      findRecord("vendors", String(e.vendorId || "")) || {},
      n,
    ),
  );
  const i = listRecords("applications").filter((e) =>
    ["Pending", "Under review", "Changes requested"].includes(
      String(e.status || ""),
    ),
  );
  const a = listRecords("approvals").filter((e) =>
    ["Pending", "Under review", "Changes requested"].includes(
      String(e.status || ""),
    ),
  );
  const o = listRecords("payouts");
  const s = listRecords("disputes").filter(
    (e) => !["Closed", "Resolved"].includes(String(e.status || "")),
  );
  const c = r.reduce((e, t) => e + Number(t.shopperGross || 0), 0);
  const l = r.reduce(
    (e, t) => e + Number(t.netCommission || 0) + Number(t.otherFees || 0),
    0,
  );
  const u = r.reduce((e, t) => e + Number(t.vendorNet || 0), 0);
  const d = o.filter((e) =>
    ["Draft", "Ready for processing", "Processing", "On hold"].includes(
      String(e.status || ""),
    ),
  );
  const f = d.reduce((e, t) => e + Number(t.amount || 0), 0);
  const p = e.map(buildVendorPerformance).sort((e, t) => t.gmv - e.gmv);
  return {
    vendors: e,
    applications: i,
    approvals: a,
    payouts: o,
    disputes: s,
    gmv: c,
    platform: l,
    payable: u,
    pendingPayouts: f,
    pendingPayoutCount: d.length,
    vendorRanking: p,
    active: e.filter((e) => e.status === "Active").length,
    verified: e.filter((e) => String(e.kyc || "Verified") === "Verified")
      .length,
    queueCount: i.length + a.length + s.length,
  };
}
