// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { readProfile } from "@/lib/profile";
import { readStoredValue, writeStoredValue } from "@/lib/storage";

const COMMERCE_STORAGE_KEY = "commerce-v1";

export function cloneData(e) {
  return structuredClone(e);
}

export function nowIso() {
  return new Date().toISOString();
}

export function createId() {
  return crypto.randomUUID();
}

export function readCommerceState() {
  const e = readStoredValue(COMMERCE_STORAGE_KEY, {});
  return e && typeof e == "object" && !Array.isArray(e) ? e : {};
}

export function writeCommerceState(e) {
  if (!writeStoredValue(COMMERCE_STORAGE_KEY, e))
    throw Error(
      "Browser storage is full or unavailable. This change was not saved.",
    );
  if (typeof window < "u") {
    window.dispatchEvent(new Event("veylix:commerce"));
  }
}

export function getCollection(e, t) {
  const n = cloneData(e.collections?.[t] ?? modulesById[t]?.seeds ?? []);
  return t === "testimonials"
    ? n.map((e) =>
        e.category
          ? e
          : {
              ...e,
              category: "Customer stories",
            },
      )
    : n;
}

export function listRecords(e, { archived = false } = {}) {
  const n = modulesById[e]?.derived || e;
  return getCollection(readCommerceState(), n).filter((e) =>
    archived ? e._archived : !e._archived,
  );
}

export function findRecord(e, t) {
  return listRecords(e).find((e) => e.id === t);
}

export function getRecordLabel(e, t) {
  const n =
    findRecord(e, t) ||
    listRecords(e, {
      archived: true,
    }).find((e) => e.id === t);
  return n?.name || n?.number || n?.code || n?.reference || t || "Not assigned";
}

export function appendAuditEntry(e, t, n, r) {
  e.collections ||= {};
  const i = readProfile();
  const a = [i.name, i.role].filter(Boolean).join(" · ") || "Local user";
  e.collections.audit = [
    {
      id: createId(),
      action: t,
      resource: modulesById[n]?.title || n,
      record: r.name || r.number || r.code || r.id,
      recordId: r.id,
      actor: a,
      date: nowIso(),
    },
    ...getCollection(e, "audit"),
  ].slice(0, 500);
}
