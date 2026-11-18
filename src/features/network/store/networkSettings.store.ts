import { storage, StorageKeys } from '@/store/mmkv';
import {
  BODY_LIMITS_KB,
  type BodyLimitKb,
  type CaptureScope,
  type CaptureSession,
  type DomainRule,
  type NetworkSettings,
} from '../types';
import { parseDomainInput } from '../utils/domainFilter';

/**
 * NetworkCaptureSettings (MMKV). Capture is off until the user turns it on;
 * redaction is on until the user opts out. Invalid stored values fall back
 * to these defaults.
 */

export const MAX_DOMAINS = 30;

export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  enabled: false,
  session: 'stopped',
  domains: [],
  scope: 'allowedOnly',
  bodyLimitKb: 128,
  includeSensitive: false,
  lastUrl: '',
};

const SESSIONS: readonly CaptureSession[] = ['stopped', 'recording', 'paused'];
const SCOPES: readonly CaptureScope[] = ['allowedOnly', 'allFromPage'];

function cleanDomains(value: unknown): DomainRule[] {
  if (!Array.isArray(value)) return [];
  const out: DomainRule[] = [];
  for (const item of value) {
    const r = item as Partial<DomainRule> | null;
    if (!r || typeof r.host !== 'string') continue;
    const rule = parseDomainInput(r.host, r.includeSubdomains === true);
    if (rule && !out.some(d => d.host === rule.host)) out.push(rule);
  }
  return out.slice(0, MAX_DOMAINS);
}

function clean(value: unknown): NetworkSettings {
  if (!value || typeof value !== 'object') return DEFAULT_NETWORK_SETTINGS;
  const r = value as Record<string, unknown>;
  const enabled = r.enabled === true;
  const session = SESSIONS.includes(r.session as CaptureSession)
    ? (r.session as CaptureSession)
    : 'stopped';
  return {
    enabled,
    // Capture never stays "recording" while the global toggle is off.
    session: enabled ? session : 'stopped',
    domains: cleanDomains(r.domains),
    scope: SCOPES.includes(r.scope as CaptureScope)
      ? (r.scope as CaptureScope)
      : DEFAULT_NETWORK_SETTINGS.scope,
    bodyLimitKb: (BODY_LIMITS_KB as readonly number[]).includes(
      r.bodyLimitKb as number,
    )
      ? (r.bodyLimitKb as BodyLimitKb)
      : DEFAULT_NETWORK_SETTINGS.bodyLimitKb,
    includeSensitive: r.includeSensitive === true,
    lastUrl: typeof r.lastUrl === 'string' ? r.lastUrl.slice(0, 2048) : '',
  };
}

function load(): NetworkSettings {
  try {
    return clean(
      JSON.parse(storage.getString(StorageKeys.NetworkSettings) ?? 'null'),
    );
  } catch {
    return DEFAULT_NETWORK_SETTINGS;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: NetworkSettings | null = null;

function read(): NetworkSettings {
  if (!cache) cache = load();
  return cache;
}

function write(next: NetworkSettings) {
  cache = clean(next);
  storage.set(StorageKeys.NetworkSettings, JSON.stringify(cache));
  listeners.forEach(l => l());
}

export const networkSettingsStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Turning capture on starts recording; turning it off stops it at once. */
  setEnabled(enabled: boolean) {
    write({ ...read(), enabled, session: enabled ? 'recording' : 'stopped' });
  },

  /** Ignored while the global toggle is off. */
  setSession(session: CaptureSession) {
    const current = read();
    if (!current.enabled) return;
    write({ ...current, session });
  },

  /** Adds (or updates) a domain; returns false for an invalid one. */
  addDomain(input: string, includeSubdomains: boolean): DomainRule | null {
    const rule = parseDomainInput(input, includeSubdomains);
    if (!rule) return null;
    const current = read();
    const others = current.domains.filter(d => d.host !== rule.host);
    if (others.length >= MAX_DOMAINS) return null;
    write({ ...current, domains: [...others, rule] });
    return rule;
  },

  removeDomain(host: string) {
    const current = read();
    write({
      ...current,
      domains: current.domains.filter(d => d.host !== host),
    });
  },

  setSubdomains(host: string, includeSubdomains: boolean) {
    const current = read();
    write({
      ...current,
      domains: current.domains.map(d =>
        d.host === host ? { ...d, includeSubdomains } : d,
      ),
    });
  },

  update(
    patch: Partial<
      Pick<
        NetworkSettings,
        'scope' | 'bodyLimitKb' | 'includeSensitive' | 'lastUrl'
      >
    >,
  ) {
    write({ ...read(), ...patch });
  },

  resetCacheForTest() {
    cache = null;
    listeners.clear();
  },
};
