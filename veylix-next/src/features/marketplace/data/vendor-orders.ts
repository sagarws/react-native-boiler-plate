// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { formatCurrency } from "@/lib/format";

export const vendorOrdersModuleConfig = modulesById["vendor-orders"];

export const vendorOrderNumberFormatter = new Intl.NumberFormat("en-US");

export function formatVendorOrderMoney(e) {
  return formatCurrency(e, 2);
}

export const vendorOrderPayoutStatusOptions = [
  "Unscheduled",
  "Ready",
  "On hold",
  "Paid",
];

export const vendorOrderStatusOptions = [
  "Pending",
  "Accepted",
  "Fulfilled",
  "Cancelled",
];

export const vendorOrderNumericFields = new Set([
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
]);
