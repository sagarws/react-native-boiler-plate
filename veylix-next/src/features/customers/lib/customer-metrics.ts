// @ts-nocheck
import { listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

export const customerDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function getCustomerInitials(e) {
  return String(e || "Customer")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((e) => e[0])
    .join("")
    .toUpperCase();
}

export function getCustomerOrders(e) {
  return listRecords("orders").filter((t) => t.customerId === e.id);
}

export function getCustomerOrderStats(e) {
  const t = getCustomerOrders(e);
  const n = t.filter((e) => e.status !== "Cancelled");
  const r = n.reduce((e, t) => e + calculateOrderTotal(t), 0);
  const i = [...t].sort((e, t) =>
    String(t.date || "").localeCompare(String(e.date || "")),
  )[0];
  const a = listRecords("returns").filter((e) =>
    t.some((t) => t.id === e.orderId),
  ).length;
  const o = listRecords("refunds").filter((e) =>
    t.some((t) => t.id === e.orderId),
  ).length;
  return {
    orders: t.length,
    spend: r,
    aov: n.length ? r / n.length : 0,
    latest: i,
    returns: a,
    refunds: o,
  };
}
