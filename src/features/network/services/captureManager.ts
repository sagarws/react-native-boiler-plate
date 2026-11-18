import { logger } from '@/shared/utils';
import type {
  CapturedBody,
  CapturedRequest,
  FormDataEntry,
  NetworkSettings,
  ResourceType,
} from '../types';
import { isUrlAllowed } from '../utils/domainFilter';
import { normalizedEndpointOf, parseUrl } from '../utils/url';
import { uuidV4 } from '../utils/uuid';
import { CAPTURE_PROTOCOL } from './captureScript';
import { generateCurl } from './curl';

/**
 * NetworkCaptureManager: turns the page's capture messages into records.
 *
 * Gating, re-checked natively for every message (the page script is only a
 * first filter):
 * - the global toggle must be on — when off, nothing is recorded, not even
 *   the end of a request that was already in flight;
 * - new requests are recorded only while the session is `recording`; a
 *   request already recorded still gets its response after a pause;
 * - the sending frame's origin (reported by the WebView, not by the page)
 *   must be on an allowed domain, and with scope `allowedOnly` so must the
 *   request URL;
 * - the message must carry this browser session's random token.
 *
 * Each request has its own lifecycle keyed by its in-page id (page session
 * + counter), so concurrent calls to the same URL never mix up responses
 * and a repeated event is ignored. Records are written in batches.
 *
 * Browser-added headers the page reconstructed are kept with their names in
 * `metadata.inferredHeaders`; the Cookie header comes from [CaptureDeps.cookies].
 */

export interface CaptureDeps {
  settings: () => NetworkSettings;
  persist: (records: CapturedRequest[]) => void;
  /**
   * The browser's cookies for a URL (the WebView cookie store, HttpOnly
   * included), for requests the browser sends cookies with. Absent where
   * the store can't be read; then the page's `document.cookie` is used.
   */
  cookies?: (url: string) => Promise<string | null>;
  /** Batch window for storage writes. */
  flushMs?: number;
  now?: () => number;
}

/** Cancel reasons, kept as codes; the screens translate them. */
export const CANCEL_PAGE_LEFT = 'Page was left before the response arrived';
export const CANCEL_BROWSER_CLOSED =
  'Browser was closed before the response arrived';
export const CANCEL_CAPTURE_OFF =
  'Capture was turned off before the response arrived';

const MAX_MESSAGE_CHARS = 16 * 1024 * 1024;
const MAX_TRACKED = 2000;
const MAX_HEADERS = 200;
const BODY_KINDS = ['json', 'text', 'formData', 'binary', 'unknown'] as const;
const RESOURCE_TYPES: readonly ResourceType[] = ['Fetch', 'XHR', 'Beacon'];
/** Latest version of recent records, for a cookie lookup that lands late. */
const MAX_RECENT = 300;
const MAX_COOKIE_CHARS = 16 * 1024;

const hasHeader = (h: Record<string, string>, name: string) =>
  Object.keys(h).some(k => k.toLowerCase() === name);

type R = Record<string, unknown>;

function headers(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let count = 0;
  for (const [k, value] of Object.entries(v as R)) {
    if (count++ >= MAX_HEADERS) break;
    if (typeof value === 'string' && k.length <= 256) {
      out[k] = value.slice(0, 16 * 1024);
    }
  }
  return out;
}

function body(v: unknown, limitBytes: number): CapturedBody | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as R;
  const kind = (BODY_KINDS as readonly string[]).includes(b.kind as string)
    ? (b.kind as CapturedBody['kind'])
    : 'unknown';
  let value: unknown = b.value ?? null;
  let truncated = b.truncated === true;
  if (
    kind === 'text' &&
    typeof value === 'string' &&
    value.length > limitBytes
  ) {
    // Defence in depth: the page already capped it.
    value = value.slice(0, limitBytes);
    truncated = true;
  }
  if (kind === 'formData') {
    value = Array.isArray(value)
      ? value
          .filter((e): e is R => !!e && typeof e === 'object')
          .slice(0, 500)
          .map(
            (e): FormDataEntry => ({
              name: String(e.name ?? ''),
              value: typeof e.value === 'string' ? e.value : null,
              ...(typeof e.fileName === 'string'
                ? { fileName: e.fileName }
                : {}),
              ...(typeof e.type === 'string' && e.type ? { type: e.type } : {}),
              ...(typeof e.sizeBytes === 'number'
                ? { sizeBytes: e.sizeBytes }
                : {}),
            }),
          )
      : [];
  }
  if (kind === 'binary' && typeof value !== 'string') value = null;
  return {
    kind,
    value,
    truncated,
    sizeBytes:
      typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes)
        ? b.sizeBytes
        : null,
    ...(kind === 'binary' && b.encoding === 'base64' && value !== null
      ? { encoding: 'base64' as const }
      : {}),
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const finiteMs = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

export class CaptureManager {
  private readonly token: string;
  private readonly deps: CaptureDeps;
  /** In-page request id → record (only while its response is awaited). */
  private readonly inflight = new Map<string, CapturedRequest>();
  /** Every in-page id seen this session, for de-duplication (bounded). */
  private readonly seen = new Set<string>();
  private readonly dirty = new Map<string, CapturedRequest>();
  /** In-page id → the record's latest version (bounded). */
  private readonly recent = new Map<string, CapturedRequest>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private started = 0;

  constructor(token: string, deps: CaptureDeps) {
    this.token = token;
    this.deps = deps;
  }

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * One WebView message. [frameUrl] is the sender's origin/URL as reported
   * by the WebView itself. Returns how many events were accepted.
   */
  handleMessage(data: string, frameUrl: string): number {
    if (this.disposed || typeof data !== 'string') return 0;
    if (data.length > MAX_MESSAGE_CHARS || !data.includes(this.token)) return 0;
    let message: R;
    try {
      message = JSON.parse(data) as R;
    } catch {
      return 0;
    }
    if (message.ni !== this.token || message.v !== CAPTURE_PROTOCOL) return 0;
    if (!Array.isArray(message.events)) return 0;

    const settings = this.deps.settings();
    if (!settings.enabled) {
      [...this.inflight.keys()].forEach(id =>
        this.cancel(id, CANCEL_CAPTURE_OFF),
      );
      return 0;
    }
    if (!isUrlAllowed(frameUrl, settings.domains)) return 0;

    let accepted = 0;
    for (const event of message.events) {
      if (!event || typeof event !== 'object') continue;
      try {
        if (this.handleEvent(event as R, settings)) accepted++;
      } catch (error) {
        // Never the content — only that an event was malformed.
        logger.warn(
          'Network Inspector: capture event rejected',
          (error as Error)?.name,
        );
      }
    }
    return accepted;
  }

  private handleEvent(e: R, settings: NetworkSettings): boolean {
    const id = typeof e.id === 'string' ? e.id.slice(0, 200) : '';
    switch (e.t) {
      case 's':
        return this.onStart(id, e, settings);
      case 'e':
        return this.onEnd(id, e, settings);
      case 'u':
        if (!Array.isArray(e.ids)) return false;
        e.ids.forEach(pending => {
          if (typeof pending === 'string')
            this.cancel(pending, CANCEL_PAGE_LEFT);
        });
        return true;
      default:
        return false;
    }
  }

  private onStart(id: string, e: R, settings: NetworkSettings): boolean {
    if (!id || this.seen.has(id) || settings.session !== 'recording')
      return false;
    const url = typeof e.url === 'string' ? e.url.slice(0, 16 * 1024) : '';
    const parsed = parseUrl(url);
    if (!parsed || (parsed.scheme !== 'http' && parsed.scheme !== 'https')) {
      return false;
    }
    if (
      settings.scope === 'allowedOnly' &&
      !isUrlAllowed(url, settings.domains)
    ) {
      return false;
    }
    const pageUrl =
      typeof e.page === 'string' ? e.page.slice(0, 16 * 1024) : '';
    if (!isUrlAllowed(pageUrl, settings.domains)) return false;

    this.remember(id);
    const limit = settings.bodyLimitKb * 1024;
    const startedMs = finiteMs(e.ts, this.now());
    const requestHeaders = headers(e.headers);
    const inferredHeaders = Array.isArray(e.added)
      ? e.added
          .filter(
            (n): n is string => typeof n === 'string' && n in requestHeaders,
          )
          .slice(0, 30)
      : [];
    const wantsCookies =
      e.cred === true && !hasHeader(requestHeaders, 'cookie');
    if (
      wantsCookies &&
      !this.deps.cookies &&
      typeof e.ck === 'string' &&
      e.ck
    ) {
      requestHeaders.Cookie = e.ck.slice(0, MAX_COOKIE_CHARS);
      inferredHeaders.push('Cookie');
    }
    const requestBody = body(e.body, limit);
    const method =
      typeof e.method === 'string' &&
      /^[A-Z]{1,16}$/.test(e.method.toUpperCase())
        ? e.method.toUpperCase()
        : 'GET';
    const record: CapturedRequest = {
      id: uuidV4(),
      source: 'webview',
      tabId: null,
      frameId: typeof e.frame === 'string' ? e.frame.slice(0, 16 * 1024) : null,
      pageUrl,
      origin: parseUrl(pageUrl)?.origin ?? '',
      method,
      url,
      requestHeaders,
      requestBody,
      status: null,
      statusText: null,
      responseHeaders: {},
      responseBody: null,
      resourceType: RESOURCE_TYPES.includes(e.type as ResourceType)
        ? (e.type as ResourceType)
        : 'Fetch',
      mimeType: null,
      startedAt: iso(startedMs),
      completedAt: null,
      durationMs: null,
      error: null,
      // Stored redacted; copies/exports regenerate it under the setting.
      curl: generateCurl(
        {
          method,
          url,
          requestHeaders,
          requestBody,
          pageUrl,
          responseHeaders: {},
          responseBody: null,
          frameId: null,
        },
        false,
      ),
      metadata: {
        requestId: id,
        normalizedEndpoint: normalizedEndpointOf(url),
        pending: true,
        inferredHeaders,
      },
    };
    this.inflight.set(id, record);
    this.started++;
    this.markDirty(record);
    if (wantsCookies && this.deps.cookies) this.addCookies(id, url);
    return true;
  }

  /** Adds the browser's cookies once the native lookup answers. */
  private addCookies(id: string, url: string) {
    this.deps.cookies!(url).then(
      cookie => {
        if (!cookie || !this.deps.settings().enabled) return;
        const current = this.inflight.get(id) ?? this.recent.get(id);
        if (!current || hasHeader(current.requestHeaders, 'cookie')) return;
        const requestHeaders = {
          ...current.requestHeaders,
          Cookie: cookie.slice(0, MAX_COOKIE_CHARS),
        };
        const next: CapturedRequest = {
          ...current,
          requestHeaders,
          curl: generateCurl({ ...current, requestHeaders }, false),
          metadata: {
            ...current.metadata,
            inferredHeaders: [
              ...(current.metadata.inferredHeaders ?? []),
              'Cookie',
            ],
          },
        };
        if (this.inflight.has(id)) this.inflight.set(id, next);
        this.markDirty(next);
      },
      error =>
        logger.warn(
          'Network Inspector: cookies not read',
          (error as Error)?.name,
        ),
    );
  }

  private onEnd(id: string, e: R, settings: NetworkSettings): boolean {
    const record = this.inflight.get(id);
    if (!record) return false;
    this.inflight.delete(id);
    const endMs = finiteMs(e.ts, this.now());
    const status =
      typeof e.status === 'number' && Number.isInteger(e.status) && e.status > 0
        ? e.status
        : null;
    const error = typeof e.error === 'string' ? e.error.slice(0, 300) : null;
    const done: CapturedRequest = {
      ...record,
      status,
      statusText:
        typeof e.statusText === 'string' ? e.statusText.slice(0, 200) : null,
      responseHeaders: headers(e.headers),
      responseBody: body(e.body, settings.bodyLimitKb * 1024),
      mimeType: typeof e.mime === 'string' ? e.mime.slice(0, 200) : null,
      completedAt: iso(endMs),
      durationMs: Math.max(0, Math.round(endMs - Date.parse(record.startedAt))),
      // A fetch that resolved with status 0 (opaque) is not an error.
      error:
        status === null && !error && e.beacon !== true && e.status !== 0
          ? 'No response'
          : error,
      metadata: { ...record.metadata, pending: false },
    };
    this.markDirty(done);
    return true;
  }

  private cancel(id: string, reason: string) {
    const record = this.inflight.get(id);
    if (!record) return;
    this.inflight.delete(id);
    const endMs = this.now();
    this.markDirty({
      ...record,
      error: reason,
      completedAt: iso(endMs),
      durationMs: Math.max(0, Math.round(endMs - Date.parse(record.startedAt))),
      metadata: { ...record.metadata, pending: false },
    });
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > MAX_TRACKED * 4) {
      // Oldest first: a Set iterates in insertion order.
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    if (this.inflight.size > MAX_TRACKED) {
      const oldest = this.inflight.keys().next().value;
      if (oldest !== undefined) this.cancel(oldest, CANCEL_PAGE_LEFT);
    }
  }

  private markDirty(record: CapturedRequest) {
    this.dirty.set(record.id, record);
    const key = record.metadata.requestId;
    this.recent.delete(key);
    this.recent.set(key, record);
    if (this.recent.size > MAX_RECENT) {
      const oldest = this.recent.keys().next().value;
      if (oldest !== undefined) this.recent.delete(oldest);
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.deps.flushMs ?? 400);
    }
  }

  /** Writes the batch now. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty.size) return;
    const batch = [...this.dirty.values()];
    this.dirty.clear();
    try {
      this.deps.persist(batch);
    } catch (error) {
      logger.error(
        'Network Inspector: saving captured calls failed',
        (error as Error)?.name,
      );
    }
  }

  /** New calls recorded by this manager. */
  get recordedCount(): number {
    return this.started;
  }

  /** Pending requests count (for the browser's indicator). */
  get pendingCount(): number {
    return this.inflight.size;
  }

  /** Browser closing: unanswered requests are closed out, then saved. */
  dispose() {
    if (this.disposed) return;
    [...this.inflight.keys()].forEach(id =>
      this.cancel(id, CANCEL_BROWSER_CLOSED),
    );
    this.flush();
    this.disposed = true;
  }
}
