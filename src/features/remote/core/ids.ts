import {
  DEFAULT_REMOTE_PORT,
  DEVICE_ID_DIGITS,
  LEGACY_DEVICE_ID_PREFIX,
  MIN_PASSWORD_LENGTH,
} from './constants';

/** The 8-digit device ID from its digits (the last 8 when given more). */
export const formatDeviceId = (digits: string): string =>
  digits.slice(-DEVICE_ID_DIGITS).padStart(DEVICE_ID_DIGITS, '0');

/** 19304289 → "1930 4289", easier to read out loud. */
export const displayDeviceId = (id: string): string =>
  /^\d{8}$/.test(id) ? `${id.slice(0, 4)} ${id.slice(4)}` : id;

/**
 * What someone typed or an older build sent, as an 8-digit ID; null if it is
 * not one. Accepts "19304289", "1930 4289" and the old "WD-019-304-289".
 */
export const parseDeviceId = (input: string): string | null => {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^\d{8}$/.test(compact)) return compact;
  const legacy = compact.startsWith(LEGACY_DEVICE_ID_PREFIX)
    ? compact.slice(LEGACY_DEVICE_ID_PREFIX.length)
    : compact;
  return /^\d{9}$/.test(legacy) ? formatDeviceId(legacy) : null;
};

export type ConnectTarget =
  | { kind: 'id'; id: string }
  | { kind: 'address'; host: string; port: number };

/** A device ID, or an IP / host name with an optional port. */
export const parseConnectTarget = (
  input: string,
  defaultPort = DEFAULT_REMOTE_PORT,
): ConnectTarget | null => {
  const id = parseDeviceId(input);
  if (id) return { kind: 'id', id };
  const raw = input.trim();
  const v6 = /^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/i.exec(raw);
  if (v6?.[1])
    return {
      kind: 'address',
      host: v6[1],
      port: v6[2] ? Number(v6[2]) : defaultPort,
    };
  const m = /^([a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(
    raw,
  );
  if (!m?.[1]) return null;
  const port = m[3] ? Number(m[3]) : defaultPort;
  if (port < 1 || port > 65535) return null;
  return { kind: 'address', host: m[1], port };
};

/**
 * A relay address, or '' when it is not one:
 *   host:port          plain TCP
 *   wss://host[/path]  WebSocket (Cloudflare Tunnel, an HTTPS proxy); https:// = wss://
 *   ws://host:port     WebSocket without TLS — testing only
 */
export const normaliseRelay = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().slice(0, 255) : '';
  if (!raw) return '';
  const ws = /^(wss?|https?):\/\/([^/?#\s@]+)([^?#\s]*)(\?[^#\s]*)?$/i.exec(
    raw,
  );
  if (ws) {
    const secure = /^(wss|https)$/i.test(ws[1]!);
    const path = (ws[3] ?? '').replace(/\/+$/, '');
    return `${secure ? 'wss' : 'ws'}://${ws[2]!.toLowerCase()}${path}${
      ws[4] ?? ''
    }`;
  }
  const match = /^([a-z0-9.-]+|\[[0-9a-f:]+\]):(\d{1,5})$/i.exec(raw);
  if (!match) return '';
  const port = Number(match[2]);
  return port > 0 && port < 65536 ? `${match[1]}:${port}` : '';
};

export const isWebSocketRelay = (relay: string): boolean =>
  /^wss?:\/\//i.test(relay);

export const normaliseIceUrl = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().slice(0, 255) : '';
  return /^(stun|turn|turns):[^\s]+$/i.test(raw) ? raw : '';
};

/** Why a new unattended password is not acceptable (an i18n key), or null. */
export const passwordProblem = (
  password: string,
): 'tooShort' | 'tooLong' | 'repeated' | 'common' | 'weak' | null => {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (password.length > 256) return 'tooLong';
  if (/^(.)\1*$/.test(password)) return 'repeated';
  if (/^(0123456789|1234567890|password|qwertyuiop)/i.test(password))
    return 'common';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter(r =>
    r.test(password),
  ).length;
  if (password.length < 12 && classes < 3) return 'weak';
  return null;
};

/** 1:05:09 / 4:59 */
export const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

// Strips control and bidi-override characters from text the other side sends.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

/** Text from the other side, made safe to show. */
export const cleanText = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value.replace(CONTROL_CHARS, '').trim().slice(0, max)
    : '';
