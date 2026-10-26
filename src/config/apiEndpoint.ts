import { storage, StorageKeys } from '@/store/mmkv';
import { env } from './env';
import { FEATURES } from './featureFlags';

// The API base URL can be pointed somewhere else at runtime (developer
// settings on the login screen) for on-device debugging against a laptop.
// Every consumer reads through `getApiBaseUrl()`, so an override reroutes the
// REST client and the realtime socket together.
type Listener = (url: string) => void;

const listeners = new Set<Listener>();

function readOverride(): string | undefined {
  // With the developer sheet hidden there is no way to inspect or clear an
  // override, so one stored by an earlier build must not silently keep the
  // app pointed somewhere else.
  if (!FEATURES.loginDevSettings) return undefined;
  const value = storage.getString(StorageKeys.ApiBaseUrlOverride);
  if (!value || value.trim() === '') return undefined;
  return value.trim();
}

function normalize(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function notify(): void {
  const url = getApiBaseUrl();
  listeners.forEach(l => l(url));
}

export function isValidEndpoint(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\/[^\s]+$/i.test(trimmed);
}

export function getApiBaseUrl(): string {
  return readOverride() ?? env.apiBaseUrl;
}

export function getApiBaseUrlOverride(): string | undefined {
  return readOverride();
}

export function getDefaultApiBaseUrl(): string {
  return env.apiBaseUrl;
}

export function setApiBaseUrlOverride(url: string): void {
  storage.set(StorageKeys.ApiBaseUrlOverride, normalize(url));
  notify();
}

export function clearApiBaseUrlOverride(): void {
  storage.delete(StorageKeys.ApiBaseUrlOverride);
  notify();
}

export function subscribeApiBaseUrl(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
