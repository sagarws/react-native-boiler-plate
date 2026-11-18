import type { CapturedBody, CapturedRequest } from '../types';

/**
 * Redaction for copies and exports (stored records keep the originals so the
 * user can inspect them on the device). On by default; the user can opt in
 * to including sensitive values.
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
]);

/** Any key or header name containing one of these is treated as secret. */
const SENSITIVE_PART =
  /pass(word|wd)|^pass$|pwd|secret|token|api[-_]?key|authoriz|(^|[-_])auth($|[-_])|session|cookie|^otp$|(^|[-_])otp|^pin$|cvv|credential|signature|private[-_]?key/i;

export function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADERS.has(lower) || SENSITIVE_PART.test(lower);
}

/** `a=1; sid=x` → `a=[REDACTED]; sid=[REDACTED]`: names stay readable. */
export function redactCookies(cookie: string): string {
  return cookie
    .split(/;\s*/)
    .filter(Boolean)
    .map(part => {
      const i = part.indexOf('=');
      return i < 0 ? REDACTED : `${part.slice(0, i)}=${REDACTED}`;
    })
    .join('; ');
}

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] =
      name.toLowerCase() === 'cookie'
        ? redactCookies(value)
        : isSensitiveName(name)
        ? REDACTED
        : value;
  }
  return out;
}

/** Deep copy with sensitive keys' values replaced. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 50 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      isSensitiveName(key) && v !== null && typeof v !== 'object'
        ? REDACTED
        : redactValue(v, depth + 1);
  }
  return out;
}

/** `a=1&token=x` → `a=1&token=[REDACTED]`; also used for url-encoded bodies. */
export function redactQueryString(query: string): string {
  return query.replace(
    /([?&]|^)([^=&#]+)=([^&#]*)/g,
    (whole, sep: string, key: string) => {
      let name = key;
      try {
        name = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        name = key;
      }
      return isSensitiveName(name) ? `${sep}${key}=${REDACTED}` : whole;
    },
  );
}

export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const query = hash < 0 ? url.slice(q) : url.slice(q, hash);
  return (
    url.slice(0, q) +
    redactQueryString(query) +
    (hash < 0 ? '' : url.slice(hash))
  );
}

function looksUrlEncoded(text: string): boolean {
  return /^[^=&\s{}[\]"]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(text.trim());
}

export function redactBody(body: CapturedBody | null): CapturedBody | null {
  if (!body) return body;
  switch (body.kind) {
    case 'json':
      return { ...body, value: redactValue(body.value) };
    case 'formData':
      return {
        ...body,
        value: Array.isArray(body.value)
          ? body.value.map(entry =>
              entry &&
              typeof entry === 'object' &&
              isSensitiveName(
                String((entry as { name?: unknown }).name ?? ''),
              ) &&
              (entry as { value?: unknown }).value !== null
                ? { ...entry, value: REDACTED }
                : entry,
            )
          : body.value,
      };
    case 'text':
      return typeof body.value === 'string' && looksUrlEncoded(body.value)
        ? { ...body, value: redactQueryString(body.value) }
        : body;
    default:
      return body;
  }
}

/** The record as it may leave the app (copy/export) under the setting. */
export function redactRecord(
  record: CapturedRequest,
  includeSensitive: boolean,
): CapturedRequest {
  if (includeSensitive) return record;
  return {
    ...record,
    url: redactUrl(record.url),
    pageUrl: redactUrl(record.pageUrl),
    frameId: record.frameId ? redactUrl(record.frameId) : null,
    requestHeaders: redactHeaders(record.requestHeaders),
    responseHeaders: redactHeaders(record.responseHeaders),
    requestBody: redactBody(record.requestBody),
    responseBody: redactBody(record.responseBody),
  };
}
