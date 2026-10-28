import type { CodeKind } from '../types';

/** What a scanned code means, and the actions it safely allows. */
export type ParsedCode =
  | { kind: 'url'; url: string; host: string; warning: UrlWarning | null }
  | { kind: 'phone'; phone: string }
  | { kind: 'email'; email: string; subject: string; body: string }
  | { kind: 'sms'; phone: string; body: string }
  | {
      kind: 'wifi';
      ssid: string;
      password: string;
      security: string;
      hidden: boolean;
    }
  | { kind: 'geo'; lat: number; lng: number }
  | { kind: 'product'; code: string }
  | { kind: 'text'; text: string };

/** Why a link deserves a second look before opening. */
export type UrlWarning = 'insecure' | 'ip' | 'punycode' | 'credentials';

const PRODUCT_FORMATS = new Set(['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E']);
const PHONE_RE = /^\+?[\d\s().-]{4,20}$/;

/**
 * A link is offered only for http(s) URLs that parse cleanly. Anything else
 * (javascript:, intent:, file:, data:, app schemes…) is shown as plain text
 * and never opened.
 */
export function safeUrl(
  raw: string,
): { url: string; host: string; warning: UrlWarning | null } | null {
  const text = raw.trim();
  const m = /^(https?):\/\/([^/?#\s]+)([^\s]*)$/i.exec(text);
  if (!m) return null;
  const authority = m[2];
  const credentials = authority.includes('@');
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const host = hostPort.replace(/:\d{1,5}$/, '').toLowerCase();
  if (!host || !/^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/i.test(host)) return null;
  let warning: UrlWarning | null = null;
  if (credentials) warning = 'credentials';
  else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('['))
    warning = 'ip';
  else if (host.split('.').some(label => label.startsWith('xn--')))
    warning = 'punycode';
  else if (m[1].toLowerCase() === 'http') warning = 'insecure';
  return { url: text, host, warning };
}

/** WIFI:T:WPA;S:name;P:pass;H:true;; with \\ escapes. */
function parseWifi(text: string): ParsedCode | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields: Record<string, string> = {};
  const re = /([A-Z]):((?:\\.|[^;\\])*);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.slice(5))))
    fields[m[1].toUpperCase()] = m[2].replace(/\\(.)/g, '$1');
  if (!fields.S) return null;
  return {
    kind: 'wifi',
    ssid: fields.S,
    password: fields.P ?? '',
    security: fields.T || 'nopass',
    hidden: /^true$/i.test(fields.H ?? ''),
  };
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Reads a code's text (and format) into something the UI can act on. */
export function parseCode(value: string, format: string): ParsedCode {
  const text = value.trim();
  const url = safeUrl(text);
  if (url) return { kind: 'url', ...url };

  const wifi = parseWifi(text);
  if (wifi) return wifi;

  let m = /^tel:(.+)$/i.exec(text);
  if (m && PHONE_RE.test(m[1]))
    return { kind: 'phone', phone: m[1].replace(/[^\d+]/g, '') };

  m = /^(?:mailto:)([^?\s]+)(?:\?(.*))?$/i.exec(text);
  if (m) {
    const params = new Map(
      (m[2] ?? '')
        .split('&')
        .filter(Boolean)
        .map(p => {
          const [k, v = ''] = p.split('=');
          return [k.toLowerCase(), decode(v)] as const;
        }),
    );
    return {
      kind: 'email',
      email: decode(m[1]),
      subject: params.get('subject') ?? '',
      body: params.get('body') ?? '',
    };
  }
  m = /^MATMSG:TO:([^;]*);(?:SUB:([^;]*);)?(?:BODY:([^;]*);)?/i.exec(text);
  if (m)
    return {
      kind: 'email',
      email: m[1],
      subject: m[2] ?? '',
      body: m[3] ?? '',
    };

  m = /^(?:sms|smsto):([+\d\s().-]{4,20})(?:[:?](?:body=)?(.*))?$/i.exec(text);
  if (m)
    return {
      kind: 'sms',
      phone: m[1].replace(/[^\d+]/g, ''),
      body: decode(m[2] ?? ''),
    };

  m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      return { kind: 'geo', lat, lng };
  }

  if (PRODUCT_FORMATS.has(format) && /^\d{6,14}$/.test(text))
    return { kind: 'product', code: text };
  if (/^\+\d[\d\s().-]{6,18}$/.test(text))
    return { kind: 'phone', phone: text.replace(/[^\d+]/g, '') };
  return { kind: 'text', text };
}

export const kindOf = (value: string, format: string): CodeKind =>
  parseCode(value, format).kind;
