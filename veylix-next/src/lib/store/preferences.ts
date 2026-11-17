// @ts-nocheck
import { sampleConversations } from "@/data/conversations";
import {
  appendAuditEntry,
  cloneData,
  readCommerceState,
  writeCommerceState,
} from "@/lib/store/core";

export function readPreference(e, t) {
  return cloneData(readCommerceState().preferences?.[e] ?? t);
}

export function savePreference(e, t) {
  const n = readCommerceState();
  n.preferences ||= {};
  n.preferences[e] = t;
  appendAuditEntry(n, "Updated preferences", e, {
    id: e,
  });
  writeCommerceState(n);
}

export function getConversations() {
  return readPreference("conversations", sampleConversations);
}

export function updateConversation(e, t) {
  savePreference(
    "conversations",
    getConversations().map((n) =>
      n.id === e
        ? {
            ...n,
            ...t,
          }
        : n,
    ),
  );
}
