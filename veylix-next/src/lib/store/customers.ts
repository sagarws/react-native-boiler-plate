// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { readProfile } from "@/lib/profile";
import {
  appendAuditEntry,
  createId,
  findRecord,
  getCollection,
  listRecords,
  nowIso,
  readCommerceState,
  writeCommerceState,
} from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

export function updateCustomerStatus(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "customers");
  const i = r.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This customer is no longer available.");
  if (!["Active", "Inactive"].includes(t))
    throw Error("Choose a valid customer status.");
  const a = {
    ...i,
    status: t,
    updatedAt: nowIso(),
  };
  n.collections ||= {};
  n.collections.customers = r.map((t) => (t.id === e ? a : t));
  appendAuditEntry(n, `Customer marked ${t}`, "customers", a);
  writeCommerceState(n);
  return a;
}

export function updateCustomerSegment(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "customers");
  const i = r.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This customer is no longer available.");
  if (
    !(
      modulesById.customers?.fields?.find((e) => e.key === "segment")
        ?.options || []
    ).includes(t)
  )
    throw Error("Choose a valid customer segment.");
  const a = {
    ...i,
    segment: t,
    updatedAt: nowIso(),
  };
  n.collections ||= {};
  n.collections.customers = r.map((t) => (t.id === e ? a : t));
  appendAuditEntry(n, `Customer segment changed to ${t}`, "customers", a);
  writeCommerceState(n);
  return a;
}

export function addCustomerNote(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "customers");
  const i = r.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This customer is no longer available.");
  const a = String(t || "").trim();
  if (!a) throw Error("Write a note before saving.");
  if (a.length > 2e3)
    throw Error("Keep customer notes under 2,000 characters.");
  const o = readProfile();
  const s = {
    id: createId(),
    text: a,
    author: o.name || "Local user",
    date: nowIso(),
  };
  const c = {
    ...i,
    customerNotes: [
      s,
      ...(Array.isArray(i.customerNotes) ? i.customerNotes : []),
    ].slice(0, 100),
    updatedAt: nowIso(),
  };
  n.collections ||= {};
  n.collections.customers = r.map((t) => (t.id === e ? c : t));
  appendAuditEntry(n, "Added customer note", "customers", c);
  writeCommerceState(n);
  return s;
}

export function getCustomerTimeline(e) {
  const t =
    findRecord("customers", e) ||
    listRecords("customers", {
      archived: true,
    }).find((t) => t.id === e);
  if (!t) return [];
  const n = modulesById.customers?.title || "Customers";
  const r = listRecords("audit")
    .filter(
      (r) => r.recordId === e || (r.resource === n && r.record === t.name),
    )
    .map((e) => ({
      id: e.id,
      type: "activity",
      title: e.action,
      detail: e.actor || "Local demo",
      date: e.date,
    }));
  const i = listRecords("orders")
    .filter((t) => t.customerId === e)
    .map((e) => ({
      id: `order-${e.id}`,
      type: "order",
      title: `Order ${e.number} · ${e.status}`,
      detail: `Order value ${calculateOrderTotal(e).toFixed(2)} USD`,
      date: e.updatedAt || `${e.date || ""}T12:00:00Z`,
      orderId: e.id,
      orderNumber: e.number,
    }));
  return [
    ...(Array.isArray(t.customerNotes) ? t.customerNotes : []).map((e) => ({
      id: e.id,
      type: "note",
      title: "Customer note",
      detail: e.text,
      author: e.author,
      date: e.date,
    })),
    ...i,
    ...r,
  ]
    .filter((e) => e.date)
    .sort((e, t) => String(t.date).localeCompare(String(e.date)))
    .slice(0, 100);
}
