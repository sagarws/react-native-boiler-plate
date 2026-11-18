import { networkStorage, StorageKeys } from '@/store/mmkv';
import type {
  CallSummary,
  CapturedBody,
  CapturedRequest,
  ResourceType,
} from '../types';
import { endpointOf, hostOf, parseUrl } from '../utils/url';

/**
 * NetworkCaptureRepository: captured calls in their own MMKV file
 * (`networkStorage`). One key per full record, plus one ordered index of
 * light summaries for lists, search and filters, so a list never parses
 * request/response bodies. Writes are batched by the capture manager.
 *
 * Oldest records drop off past MAX_RECORDS. Nothing here is logged.
 */

export const MAX_RECORDS = 1000;

const recordKey = (id: string) => `${StorageKeys.NetworkRecordPrefix}${id}`;

type Listener = () => void;
const listeners = new Set<Listener>();
let index: CallSummary[] | null = null;

function str(v: unknown, max = 8192): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cleanSummary(v: unknown): CallSummary | null {
  const r = v as Partial<CallSummary> | null;
  if (!r || typeof r.id !== 'string' || typeof r.url !== 'string') return null;
  return {
    id: r.id,
    method: str(r.method, 16) || 'GET',
    url: str(r.url),
    host: str(r.host, 300),
    endpoint: str(r.endpoint),
    status: numOrNull(r.status),
    error: typeof r.error === 'string' ? r.error.slice(0, 300) : null,
    pending: r.pending === true,
    durationMs: numOrNull(r.durationMs),
    startedAt: str(r.startedAt, 40),
    pageOrigin: str(r.pageOrigin, 300),
  };
}

function loadIndex(): CallSummary[] {
  try {
    const parsed: unknown = JSON.parse(
      networkStorage.getString(StorageKeys.NetworkIndex) ?? '[]',
    );
    return Array.isArray(parsed)
      ? parsed.map(cleanSummary).filter((s): s is CallSummary => s !== null)
      : [];
  } catch {
    return [];
  }
}

function readIndex(): CallSummary[] {
  if (!index) index = loadIndex();
  return index;
}

function commitIndex(next: CallSummary[]) {
  index = next;
  networkStorage.set(StorageKeys.NetworkIndex, JSON.stringify(next));
  listeners.forEach(l => l());
}

export function toSummary(record: CapturedRequest): CallSummary {
  return {
    id: record.id,
    method: record.method,
    url: record.url,
    host: hostOf(record.url),
    endpoint: endpointOf(record.url),
    status: record.status,
    error: record.error,
    pending: record.metadata.pending,
    durationMs: record.durationMs,
    startedAt: record.startedAt,
    pageOrigin: parseUrl(record.pageUrl)?.origin ?? '',
  };
}

const RESOURCE_TYPES: readonly ResourceType[] = ['Fetch', 'XHR', 'Beacon'];

function cleanBody(v: unknown): CapturedBody | null {
  const b = v as Partial<CapturedBody> | null;
  if (!b || typeof b !== 'object' || typeof b.kind !== 'string') return null;
  return {
    kind: (['json', 'text', 'formData', 'binary', 'unknown'] as const).includes(
      b.kind,
    )
      ? b.kind
      : 'unknown',
    value: b.value ?? null,
    truncated: b.truncated === true,
    sizeBytes: numOrNull(b.sizeBytes),
    ...(b.encoding === 'base64' ? { encoding: 'base64' as const } : {}),
  };
}

function cleanHeaders(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value === 'string') out[k] = value;
  }
  return out;
}

/** Shape-checks a stored record; a damaged one reads as missing. */
function cleanRecord(v: unknown): CapturedRequest | null {
  const r = v as Partial<CapturedRequest> | null;
  if (!r || typeof r.id !== 'string' || typeof r.url !== 'string') return null;
  const meta = (r.metadata ?? {}) as Partial<CapturedRequest['metadata']>;
  return {
    id: r.id,
    source: 'webview',
    tabId: null,
    frameId: typeof r.frameId === 'string' ? r.frameId : null,
    pageUrl: str(r.pageUrl),
    origin: str(r.origin, 300),
    method: str(r.method, 16) || 'GET',
    url: r.url,
    requestHeaders: cleanHeaders(r.requestHeaders),
    requestBody: cleanBody(r.requestBody),
    status: numOrNull(r.status),
    statusText: typeof r.statusText === 'string' ? r.statusText : null,
    responseHeaders: cleanHeaders(r.responseHeaders),
    responseBody: cleanBody(r.responseBody),
    resourceType: RESOURCE_TYPES.includes(r.resourceType as ResourceType)
      ? (r.resourceType as ResourceType)
      : 'Fetch',
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : null,
    startedAt: str(r.startedAt, 40),
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
    durationMs: numOrNull(r.durationMs),
    error: typeof r.error === 'string' ? r.error : null,
    curl: str(r.curl, 4_000_000),
    metadata: {
      requestId: str(meta.requestId, 200),
      normalizedEndpoint: str(meta.normalizedEndpoint),
      pending: meta.pending === true,
      ...(Array.isArray(meta.inferredHeaders)
        ? {
            inferredHeaders: meta.inferredHeaders.filter(
              (n): n is string => typeof n === 'string',
            ),
          }
        : {}),
    },
  };
}

const byNewest = (a: CallSummary, b: CallSummary) =>
  a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;

export const networkRepository = {
  /** Newest first. The same array until something changes. */
  summaries: readIndex,

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  get(id: string): CapturedRequest | null {
    try {
      const raw = networkStorage.getString(recordKey(id));
      return raw ? cleanRecord(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },

  /** Inserts or replaces records in one index write. */
  upsertMany(records: readonly CapturedRequest[]) {
    if (!records.length) return;
    const byId = new Map(readIndex().map(s => [s.id, s]));
    for (const record of records) {
      networkStorage.set(recordKey(record.id), JSON.stringify(record));
      byId.set(record.id, toSummary(record));
    }
    const next = [...byId.values()].sort(byNewest);
    for (const dropped of next.splice(MAX_RECORDS)) {
      networkStorage.delete(recordKey(dropped.id));
    }
    commitIndex(next);
  },

  /**
   * Records left "pending" by an earlier browser session (e.g. the app was
   * killed mid-request) can never complete: close them out with [reason].
   */
  closeStalePending(reason: string) {
    const stale = readIndex().filter(s => s.pending);
    const closed: CapturedRequest[] = [];
    for (const summary of stale) {
      const record = this.get(summary.id);
      if (record) {
        closed.push({
          ...record,
          error: reason,
          metadata: { ...record.metadata, pending: false },
        });
      }
    }
    this.upsertMany(closed);
  },

  remove(ids: readonly string[]) {
    if (!ids.length) return;
    const gone = new Set(ids);
    ids.forEach(id => networkStorage.delete(recordKey(id)));
    commitIndex(readIndex().filter(s => !gone.has(s.id)));
  },

  clear() {
    networkStorage.clearAll();
    commitIndex([]);
  },

  /** Drops the in-memory index and re-reads it from storage. */
  resetCacheForReload() {
    index = loadIndex();
    listeners.forEach(l => l());
  },

  resetCacheForTest() {
    index = null;
    listeners.clear();
  },
};
