/**
 * A small, strict URL splitter. React Native's `URL` lacks `hostname` and
 * friends, and domain checks must not be fooled by userinfo
 * (`https://allowed.com@evil.com`), so parsing is done here explicitly.
 */
export interface ParsedUrl {
  scheme: string;
  /** Lower-case host without port or trailing dot (IPv6 keeps brackets). */
  hostname: string;
  /** Explicit port, '' when the URL uses the scheme's default. */
  port: string;
  path: string;
  query: string;
  origin: string;
}

const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };

export function parseUrl(raw: string): ParsedUrl | null {
  const match = URL_RE.exec(raw.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  // Anything before the last '@' is userinfo, never the host.
  const authority = match[2].slice(match[2].lastIndexOf('@') + 1);
  let hostname: string;
  let port = '';
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) return null;
    hostname = authority.slice(0, end + 1).toLowerCase();
    const rest = authority.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    port = rest.slice(1);
  } else {
    const colon = authority.indexOf(':');
    hostname = (colon < 0 ? authority : authority.slice(0, colon))
      .toLowerCase()
      .replace(/\.$/, '');
    port = colon < 0 ? '' : authority.slice(colon + 1);
    if (port && !/^\d{1,5}$/.test(port)) return null;
  }
  if (!hostname) return null;
  if (port && DEFAULT_PORTS[scheme] === port) port = '';
  const path = match[3] || '/';
  return {
    scheme,
    hostname,
    port,
    path,
    query: match[4] ?? '',
    origin: `${scheme}://${hostname}${port ? `:${port}` : ''}`,
  };
}

/** `host[:port]` of a URL, '' when it can't be parsed. */
export function hostOf(raw: string): string {
  const url = parseUrl(raw);
  return url ? `${url.hostname}${url.port ? `:${url.port}` : ''}` : '';
}

/** Path + query, e.g. `/api/orders?page=2` — the "endpoint" shown in lists. */
export function endpointOf(raw: string): string {
  const url = parseUrl(raw);
  return url ? `${url.path}${url.query}` : raw;
}

/** Path only — the stable part used to group calls. */
export function normalizedEndpointOf(raw: string): string {
  return parseUrl(raw)?.path ?? raw;
}

/**
 * Turns what the user typed in the address bar into an http(s) URL:
 * a bare host gets https://. Returns null for anything else (javascript:,
 * file:, intent:, …).
 */
export function normalizeAddress(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : `https://${text}`;
  const url = parseUrl(withScheme);
  if (!url || (url.scheme !== 'http' && url.scheme !== 'https')) return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    return null;
  }
  return withScheme;
}
