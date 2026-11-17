// @ts-nocheck
import {
  buildCommissionSnapshot,
  calculateCommissionBreakdown,
  findApplicableCommissionRule,
} from "@/features/marketplace/lib/commission";
import { toFiniteNumber } from "@/features/marketplace/lib/commission-rules";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

const vendorOrderCommissionSnapshotFields = [
  "appliedRuleId",
  "appliedRule",
  "ruleScope",
  "rate",
  "fixed",
  "minimumFee",
  "feeCap",
  "commissionBase",
  "shippingTreatment",
  "taxTreatment",
  "discountFunding",
  "refundPolicy",
];

const vendorOrderAmountFields = [
  "itemRevenue",
  "shipping",
  "tax",
  "discount",
  "vendorDiscount",
  "marketplaceDiscount",
  "fees",
  "refunds",
  "chargebacks",
  "adjustments",
];

export function saveVendorOrderSplit(e = {}, t = "") {
  const n = {
    ...e,
  };
  if (
    (vendorOrderAmountFields.forEach((e) => {
      n[e] = toFiniteNumber(n[e]);
    }),
    !findRecord("orders", n.orderId))
  )
    throw Error("Choose a valid customer order.");
  const r = findRecord("vendors", n.vendorId);
  if (!r) throw Error("Choose a valid vendor.");
  if (!findRecord("products", n.productId))
    throw Error("Choose a valid product.");
  if (n.itemRevenue <= 0)
    throw Error("Item revenue must be greater than zero.");
  if (n.vendorDiscount + n.marketplaceDiscount - n.discount > 0.011)
    throw Error(
      "Vendor-funded and marketplace-funded discount cannot exceed the total discount.",
    );
  const i = t ? findRecord("vendor-orders", t) : void 0;
  if (i)
    vendorOrderCommissionSnapshotFields.forEach((e) => {
      n[e] = i[e];
    });
  else {
    const e = findApplicableCommissionRule({
      vendor: r,
      productId: n.productId,
      date: n.date,
      rules: listRecords("commissions"),
    });
    Object.assign(n, buildCommissionSnapshot(e || {}, r));
  }
  return saveRecord("vendor-orders", n, t || void 0);
}

export function advanceVendorOrderStatus(e) {
  const t = findRecord("vendor-orders", e);
  if (!t) throw Error("This vendor split is no longer available.");
  const n =
    t.status === "Pending"
      ? "Accepted"
      : t.status === "Accepted"
        ? "Fulfilled"
        : "";
  if (!n) throw Error("This vendor split has no next fulfillment stage.");
  return saveRecord(
    "vendor-orders",
    {
      ...t,
      status: n,
    },
    t.id,
  );
}

export function toggleVendorOrderPayoutHold(e) {
  const t = findRecord("vendor-orders", e);
  if (!t) throw Error("This vendor split is no longer available.");
  const n = t.payoutStatus === "On hold" ? "Ready" : "On hold";
  return saveRecord(
    "vendor-orders",
    {
      ...t,
      payoutStatus: n,
    },
    t.id,
  );
}

export function calculateVendorOrderCommission(e) {
  const t = typeof e == "string" ? findRecord("vendor-orders", e) : e;
  if (t)
    return calculateCommissionBreakdown(
      t,
      findRecord("vendors", t.vendorId) || {},
      listRecords("commissions"),
    );
}
