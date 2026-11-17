// @ts-nocheck
import { orderOpsDateFormatter } from "@/features/orders/constants/order-operations";
import { findRecord } from "@/lib/store/core";

export function formatOrderOpsDate(e) {
  if (!e) return "—";
  const t = new Date(`${String(e).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t.getTime())
    ? String(e)
    : orderOpsDateFormatter.format(t);
}

export function getOrderOpsCustomer(e) {
  return e ? findRecord("customers", e.customerId) : void 0;
}

export function matchesOrderOpsQuery(e, t, n = []) {
  return (
    !t ||
    [...Object.values(e), ...n]
      .join(" ")
      .toLowerCase()
      .includes(t.toLowerCase())
  );
}
