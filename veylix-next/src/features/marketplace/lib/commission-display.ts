// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { formatCurrency } from "@/lib/format";
import { findRecord } from "@/lib/store/core";

const commissionsModuleConfig = modulesById.commissions;

export const commissionNumberFormat = new Intl.NumberFormat("en-US");

export function formatCommissionMoney(e) {
  return formatCurrency(e, 2);
}

export const commissionScopeOptions = [
  "Marketplace default",
  "Vendor tier",
  "Vendor category",
  "Specific vendor",
  "Specific product",
];

export const commissionRuleStatusOptions = ["Active", "Paused"];

export const vendorTierOptions = ["Standard", "Growth", "Strategic", "Custom"];

function formatCommissionDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export function formatCommissionRuleRate(e) {
  const t = Number(e.rate || 0);
  const n = Number(e.fixed || 0);
  return String(e.calculation) === "Fixed fee"
    ? formatCommissionMoney(n)
    : String(e.calculation) === "Percentage + fixed fee"
      ? `${t.toFixed(1)}% + ${formatCommissionMoney(n)}`
      : `${t.toFixed(1)}%`;
}

export function getCommissionScopeTarget(e) {
  return e.scope === "Marketplace default"
    ? "All marketplace vendors"
    : e.scope === "Specific vendor"
      ? String(
          findRecord("vendors", String(e.value || ""))?.name || e.value || "—",
        )
      : e.scope === "Specific product"
        ? String(
            findRecord("products", String(e.value || ""))?.name ||
              e.value ||
              "—",
          )
        : String(e.value || "—");
}

export function formatCommissionEffectiveWindow(e) {
  return !e.effectiveFrom && !e.effectiveTo
    ? "Always"
    : `${e.effectiveFrom ? formatCommissionDate(e.effectiveFrom) : "Now"} → ${e.effectiveTo ? formatCommissionDate(e.effectiveTo) : "Open ended"}`;
}

export function getCommissionField(e) {
  return commissionsModuleConfig.fields.find((t) => t.key === e);
}

export function readCommissionValue(e, t, n = "") {
  const r = e?.[t];
  return r == null || r === "" ? n : r;
}

export function readCommissionFormValues(e) {
  const t = new FormData(e);
  const n = {};
  for (const e of commissionsModuleConfig.fields) {
    const r = t.get(e.key);
    if (["money", "number"].includes(e.type)) {
      n[e.key] = Number(r || 0);
    } else {
      n[e.key] = String(r || "");
    }
  }
  return n;
}
