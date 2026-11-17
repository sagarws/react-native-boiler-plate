// @ts-nocheck
import { calculateCommissionBreakdown } from "@/features/marketplace/lib/commission";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function toFiniteNumber(e) {
  return Number.isFinite(Number(e)) ? Number(e) : 0;
}

const commissionScopeValidators = {
  "Vendor tier": (e) =>
    ["Standard", "Growth", "Strategic", "Custom"].includes(String(e || "")),
  "Vendor category": (e) =>
    listRecords("vendors").some((t) => t.category === e),
  "Specific vendor": (e) => !!findRecord("vendors", e),
  "Specific product": (e) => !!findRecord("products", e),
};

function validateCommissionRule(e = {}, t = "") {
  const n = {
    ...e,
  };
  if (!String(n.name || "").trim()) throw Error("Rule name is required.");
  if (n.scope === "Marketplace default") n.value = "";
  else if (!String(n.value || "").trim())
    throw Error("Choose a scope target for this commission rule.");
  if (
    commissionScopeValidators[n.scope] &&
    !commissionScopeValidators[n.scope](n.value)
  )
    throw Error(
      {
        "Vendor tier": "Choose a valid vendor tier for this rule.",
        "Vendor category":
          "Choose a vendor category that exists in the marketplace.",
        "Specific vendor": "Choose a valid marketplace vendor for this rule.",
        "Specific product": "Choose a valid product for this rule.",
      }[n.scope] || "Choose a valid commission target.",
    );
  const r = toFiniteNumber(n.rate);
  const i = toFiniteNumber(n.fixed);
  const a = toFiniteNumber(n.minimumFee);
  const o = toFiniteNumber(n.feeCap);
  if (r < 0 || r > 100)
    throw Error("Commission percentage must be between 0% and 100%.");
  if ([i, a, o].some((e) => e < 0))
    throw Error("Commission fees cannot be negative.");
  if (
    n.effectiveFrom &&
    n.effectiveTo &&
    String(n.effectiveTo) < String(n.effectiveFrom)
  )
    throw Error("Effective-to date must be after the effective-from date.");
  if (o > 0 && a > o)
    throw Error("Fee cap cannot be lower than the minimum fee.");
  if (n.status === "Active" && n.scope === "Marketplace default") {
    const e = listRecords("commissions").find(
      (e) =>
        e.id !== t &&
        e.status === "Active" &&
        e.scope === "Marketplace default",
    );
    if (e)
      throw Error(
        `Pause ${e.name} before activating another marketplace default rule.`,
      );
  }
  return n;
}

export function saveCommissionRule(e, t = "") {
  return saveRecord("commissions", validateCommissionRule(e, t), t || void 0);
}

export function duplicateCommissionRule(e) {
  const t = findRecord("commissions", e);
  if (!t) throw Error("This commission rule is no longer available.");
  const n = {
    ...t,
    name: `${t.name} copy`,
    status: "Paused",
  };
  delete n.id;
  delete n._archived;
  return saveCommissionRule(n);
}

export function toggleCommissionRuleStatus(e) {
  const t = findRecord("commissions", e);
  if (!t) throw Error("This commission rule is no longer available.");
  return saveCommissionRule(
    {
      ...t,
      status: t.status === "Active" ? "Paused" : "Active",
    },
    t.id,
  );
}

export function simulateCommission({
  vendorId,
  productId,
  date,
  itemRevenue,
  shipping = 0,
  tax = 0,
  discount = 0,
  refunds = 0,
  fees = 0,
} = {}) {
  const l = findRecord("vendors", vendorId);
  if (!l) throw Error("Choose a vendor.");
  if (!findRecord("products", productId)) throw Error("Choose a product.");
  if (!date) throw Error("Choose an order date.");
  if (
    toFiniteNumber(itemRevenue) < 0 ||
    toFiniteNumber(shipping) < 0 ||
    toFiniteNumber(tax) < 0 ||
    toFiniteNumber(discount) < 0 ||
    toFiniteNumber(refunds) < 0 ||
    toFiniteNumber(fees) < 0
  )
    throw Error("Simulation amounts cannot be negative.");
  return calculateCommissionBreakdown(
    {
      vendorId: vendorId,
      productId: productId,
      itemRevenue: toFiniteNumber(itemRevenue),
      shipping: toFiniteNumber(shipping),
      tax: toFiniteNumber(tax),
      discount: toFiniteNumber(discount),
      refunds: toFiniteNumber(refunds),
      fees: toFiniteNumber(fees),
      date: date,
    },
    l,
    listRecords("commissions"),
    {
      useSnapshot: false,
    },
  );
}
