import { toUpiAmount } from '../utils/money';

/**
 * UPI QR parsing and link building. A QR code is untrusted input: only a
 * `upi://pay` link with a well-formed UPI ID, a valid amount and INR is
 * accepted, and what we display (name, UPI ID, amount) is validated.
 *
 * The link handed to the UPI app keeps the QR's own parameters exactly as
 * scanned (mode, purpose, orgid, sign, …): UPI apps check them, and a signed
 * merchant QR is rejected if anything in it is altered. Only the amount is
 * set (when the QR has none, or the user chose theirs on an unsigned QR),
 * plus `cu` / `tn` when the QR doesn't carry them.
 */

export interface UpiPayee {
  /** `pa` — the payee's UPI ID (VPA), e.g. merchant@okbank. */
  upiId: string;
  /** `pn` — display name; '' when absent. */
  name: string;
  /** `am` in paise; null when the QR leaves the amount to the payer. */
  amount: number | null;
  /** `mc` — merchant category code (4 digits); '' when absent. */
  merchantCode: string;
  /** `tr` — merchant's transaction reference; '' when absent. */
  reference: string;
  /** The QR's parameters as scanned (still percent-encoded), in order. */
  params: [string, string][];
  /** Carries a `sign`: must reach the UPI app unaltered, amount included. */
  signed: boolean;
  /**
   * No merchant category code (or the "person" code 0000): a payment to a
   * person, which UPI apps often restrict when another app starts it.
   */
  personal: boolean;
}

export type UpiParseError =
  | 'not_upi'
  | 'invalid_upi_id'
  | 'invalid_amount'
  | 'unsupported_currency';

export type UpiParseResult =
  | { ok: true; payee: UpiPayee }
  | { ok: false; error: UpiParseError };

/** What a UPI app reported on return. A hint for the user — never proof. */
export type UpiAppReport = 'success' | 'failure' | 'submitted' | 'unknown';

const MAX_LINK = 2048;
const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const AMOUNT_RE = /^\d{1,7}(?:\.\d{1,2})?$/;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,20}$/;
// Control characters and bidi overrides: a spoofed name like "Shop‮abc"
// could otherwise display as something it isn't.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** Display text from untrusted input: unsafe characters out, trimmed, capped. */
export function cleanText(value: string, max: number): string {
  return value
    .replace(UNSAFE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export const isUpiId = (value: string): boolean => VPA_RE.test(value);

/** Reads a scanned QR's text as a UPI payment request. */
export function parseUpiQr(raw: string): UpiParseResult {
  const text = raw.trim();
  if (text.length > MAX_LINK) return { ok: false, error: 'not_upi' };
  const m = /^upi:\/\/pay\?(.+)$/i.exec(text);
  if (!m) return { ok: false, error: 'not_upi' };

  const params = new Map<string, string>();
  const rawParams: [string, string][] = [];
  for (const pair of m[1].split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const rawKey = pair.slice(0, eq);
    // Parameter names are short identifiers; anything else is junk.
    if (!PARAM_KEY.test(rawKey)) continue;
    const key = rawKey.toLowerCase();
    const value = decode(pair.slice(eq + 1));
    if (value === null) continue;
    rawParams.push([rawKey, pair.slice(eq + 1)]);
    // A repeated payee or amount is ambiguous — which one would the UPI app use?
    if (params.has(key) && (key === 'pa' || key === 'am')) {
      return {
        ok: false,
        error: key === 'pa' ? 'invalid_upi_id' : 'invalid_amount',
      };
    }
    if (!params.has(key)) params.set(key, value);
  }

  const upiId = (params.get('pa') ?? '').trim();
  if (!isUpiId(upiId)) return { ok: false, error: 'invalid_upi_id' };

  const currency = (params.get('cu') ?? '').trim();
  if (currency && currency.toUpperCase() !== 'INR') {
    return { ok: false, error: 'unsupported_currency' };
  }

  let amount: number | null = null;
  const am = (params.get('am') ?? '').trim();
  if (am) {
    if (!AMOUNT_RE.test(am)) return { ok: false, error: 'invalid_amount' };
    const [rupees, paise = ''] = am.split('.');
    amount = Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
    // "0" / "0.00" means "payer enters the amount" in some QR generators.
    if (amount === 0) amount = null;
  }

  const mc = (params.get('mc') ?? '').trim();
  const tr = (params.get('tr') ?? '').trim();
  return {
    ok: true,
    payee: {
      upiId,
      name: cleanText(params.get('pn') ?? '', 100),
      amount,
      merchantCode: /^\d{4}$/.test(mc) ? mc : '',
      reference: /^[A-Za-z0-9._-]{1,35}$/.test(tr) ? tr : '',
      params: rawParams,
      signed: !!params.get('sign')?.trim(),
      personal: !/^\d{4}$/.test(mc) || mc === '0000',
    },
  };
}

/** Percent-encodes a value, keeping '@' readable (some UPI apps need it raw). */
const encode = (value: string) =>
  encodeURIComponent(value).replace(/%40/g, '@');

/**
 * The `upi://pay` link handed to the UPI app: the QR's own parameters as
 * scanned, with the amount set to [amountPaise] and `cu` / `tn` added only
 * when missing (never `tn` on a signed QR — it would break the signature).
 */
export function buildUpiUri(
  payee: UpiPayee,
  amountPaise: number,
  note: string,
): string {
  const amount = toUpiAmount(amountPaise);
  const has = (key: string) =>
    payee.params.some(([k]) => k.toLowerCase() === key);
  const out: [string, string][] = payee.params.map(([k, v]) =>
    // The QR's amount stays byte-for-byte when it's the one being paid.
    k.toLowerCase() === 'am' && payee.amount !== amountPaise
      ? [k, amount]
      : [k, v],
  );
  if (!has('am')) out.push(['am', amount]);
  if (!has('cu')) out.push(['cu', 'INR']);
  const tn = cleanText(note, 80);
  if (tn && !has('tn') && !payee.signed) out.push(['tn', encode(tn)]);
  return `upi://pay?${out.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/** Reads the `Status` a UPI app returned ("txnId=…&Status=SUCCESS"). */
export function parseUpiResponse(response: string): UpiAppReport {
  const m = /(?:^|[&?])status=([a-z]+)/i.exec(response);
  switch (m?.[1]?.toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
    case 'failed':
      return 'failure';
    case 'submitted':
    case 'pending':
      return 'submitted';
    default:
      return 'unknown';
  }
}
