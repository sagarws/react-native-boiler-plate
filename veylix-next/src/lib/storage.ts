// @ts-nocheck

const STORAGE_PREFIX = "veylix:";

export function readStoredValue(e, t) {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + e)) ?? t;
  } catch {
    return t;
  }
}

export function writeStoredValue(e, t) {
  try {
    localStorage.setItem(STORAGE_PREFIX + e, JSON.stringify(t));
    return true;
  } catch {
    return false;
  }
}

export function saveDraft(e, t) {
  const n = readStoredValue("drafts", []);
  const r = Array.isArray(n) ? n : [];
  const i = {
    id: crypto.randomUUID(),
    type: e,
    ...t,
    createdAt: new Date().toISOString(),
  };
  if (!writeStoredValue("drafts", [...r, i]))
    throw Error(
      "Browser storage is unavailable. Your draft has not been saved.",
    );
  return i;
}
