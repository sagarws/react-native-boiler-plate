import { useSyncExternalStore } from 'react';
import { featureAccessPassword } from '@/config';
import { storage, StorageKeys } from '@/store/mmkv';

/*
 * Which side-menu tabs this phone shows, kept in MMKV as { tab: true/false }.
 * A fresh install shows Expense Tracker, OCR, 8D Audio Studio and Settings. The values
 * are changed in the hidden panel: tap the logo at the top of the side menu
 * 5 times, enter FEATURE_ACCESS_PASSWORD (.env), then switch each tab.
 */

export const TABS = [
  'ExpenseTracker',
  'ManageLife',
  'Dashboard',
  'FileManagement',
  'FollowUp',
  'Reminders',
  'PhotoWidgets',
  'Utility',
  'NetworkInspector',
  'RemoteAccess',
  'LiveCamera',
  'AudioStudio',
  'Settings',
  'Appearance',
  'About',
] as const;

export type Tab = (typeof TABS)[number];
export type TabAccess = Record<Tab, boolean>;

export const DEFAULT_TAB_ACCESS: TabAccess = {
  ExpenseTracker: true,
  ManageLife: false,
  Dashboard: true,
  FileManagement: false,
  FollowUp: false,
  Reminders: false,
  PhotoWidgets: false,
  Utility: false,
  NetworkInspector: false,
  RemoteAccess: false,
  LiveCamera: false,
  // Shown by default (asked for).
  AudioStudio: true,
  Settings: true,
  Appearance: false,
  About: false,
};

/** Stored values over the defaults; anything missing or not a boolean takes its default. */
export const cleanTabAccess = (raw: unknown): TabAccess => {
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const access = { ...DEFAULT_TAB_ACCESS };
  for (const tab of TABS) {
    const v = value[tab];
    if (typeof v === 'boolean') access[tab] = v;
  }
  return access;
};

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: TabAccess | null = null;

const read = (): TabAccess => {
  if (!cache) {
    try {
      cache = cleanTabAccess(
        JSON.parse(storage.getString(StorageKeys.TabAccess) ?? 'null'),
      );
    } catch {
      cache = DEFAULT_TAB_ACCESS;
    }
  }
  return cache;
};

export const tabAccessStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(tab: Tab, enabled: boolean): TabAccess {
    cache = { ...read(), [tab]: enabled };
    storage.set(StorageKeys.TabAccess, JSON.stringify(cache));
    listeners.forEach(l => l());
    return cache;
  },
  resetCacheForTest() {
    cache = null;
    listeners.clear();
  },
};

export const useTabAccess = (): TabAccess =>
  useSyncExternalStore(tabAccessStore.subscribe, tabAccessStore.read);

/** The first tab that is switched on (where the app opens), Expense Tracker if none. */
export const firstTab = (access: TabAccess = read()): Tab =>
  TABS.find(tab => access[tab]) ?? 'ExpenseTracker';

// ── password ──

// Slow down guessing: after 5 wrong passwords, refuse for 30 s.
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;
let failures = 0;
let lockedUntil = 0;

export type PasswordCheck =
  | { ok: true }
  | { ok: false; reason: 'notSet' | 'wrong' | 'locked'; seconds?: number };

/** Constant-time compare, so the time taken says nothing about the password. */
/* eslint-disable no-bitwise */
const same = (a: string, b: string): boolean => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
};
/* eslint-enable no-bitwise */

export const checkTabAccessPassword = (
  password: string,
  now = Date.now(),
): PasswordCheck => {
  const expected = featureAccessPassword();
  if (!expected) return { ok: false, reason: 'notSet' };
  if (now < lockedUntil)
    return {
      ok: false,
      reason: 'locked',
      seconds: Math.ceil((lockedUntil - now) / 1000),
    };
  if (password.length < 256 && same(password.trim(), expected)) {
    failures = 0;
    return { ok: true };
  }
  failures += 1;
  if (failures >= MAX_FAILURES) {
    failures = 0;
    lockedUntil = now + LOCKOUT_MS;
  }
  return { ok: false, reason: 'wrong' };
};
