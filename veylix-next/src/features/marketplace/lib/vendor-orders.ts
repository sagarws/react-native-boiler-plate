// @ts-nocheck
import {
  formatVendorOrderMoney,
  vendorOrderNumericFields,
  vendorOrdersModuleConfig,
} from "@/features/marketplace/data/vendor-orders";
import { findRecord } from "@/lib/store/core";

export function getVendorOrderField(e) {
  return vendorOrdersModuleConfig.fields.find((t) => t.key === e);
}

export function resolveVendorOrderRecordLabel(e, t) {
  const n = findRecord(e, String(t || ""));
  return String(n?.name || n?.number || n?.code || n?.reference || t || "—");
}

export function formatVendorOrderDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export function formatVendorOrderCommissionRate(e) {
  const t = Number(e.rate || 0);
  const n = Number(e.fixed || 0);
  return String(e.calculation) === "Fixed fee"
    ? formatVendorOrderMoney(n)
    : String(e.calculation) === "Percentage + fixed fee"
      ? `${t.toFixed(1)}% + ${formatVendorOrderMoney(n)}`
      : `${t.toFixed(1)}%`;
}

export function readVendorOrderForm(e) {
  const t = new FormData(e);
  const n = {};
  for (const e of vendorOrdersModuleConfig.fields) {
    if (
      [
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
      ].includes(e.key)
    )
      continue;
    const r = t.get(e.key);
    n[e.key] = vendorOrderNumericFields.has(e.key)
      ? Number(r || 0)
      : String(r || "");
  }
  return n;
}
