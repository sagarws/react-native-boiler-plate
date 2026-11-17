// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { formatCurrency } from "@/lib/format";

export const vendorsModuleConfig = modulesById.vendors;

export const vendorCountFormatter = new Intl.NumberFormat("en-US");

export function formatVendorMoney(e) {
  return formatCurrency(e, 2);
}

export function formatVendorDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export function getVendorInitials(e) {
  return String(e.name || "V")
    .split(/\s+/)
    .slice(0, 2)
    .map((e) => e[0])
    .join("")
    .toUpperCase();
}

export function vendorStatusTone(e) {
  const t = String(e || "");
  return /active|verified|ready/i.test(t)
    ? "green"
    : /pending|review/i.test(t)
      ? "amber"
      : /suspend|missing|hold|required/i.test(t)
        ? "red"
        : "blue";
}

export function formatCommissionRate(e) {
  const t = Number(e.rate || 0);
  const n = Number(e.fixed || 0);
  return String(e.calculation) === "Fixed fee"
    ? formatVendorMoney(n)
    : String(e.calculation) === "Percentage + fixed fee"
      ? `${t.toFixed(1)}% + ${formatVendorMoney(n)}`
      : `${t.toFixed(1)}%`;
}
