/**
 * Phone numbers for calling and WhatsApp. A contact keeps its country
 * calling code separately from the national number; nothing assumes a
 * particular country. Typing a full international number ("+1 415…" or
 * "00 1 415…") in the number field overrides the selected code.
 */

const DIAL_RE = /^\+[1-9]\d{0,3}$/;
/** E.164: at most 15 digits including the country code. */
const MAX_E164 = 15;
const MIN_E164 = 8;
const MIN_NATIONAL = 4;
/** Italy keeps the leading 0 of landline numbers in international format. */
const KEEPS_TRUNK_ZERO = new Set(['+39']);

export type PhoneError = 'phone_required' | 'phone_invalid' | 'dial_invalid';

export interface ParsedPhone {
  dial: string;
  /** National digits. */
  phone: string;
  /** Country code + national number, digits only. */
  e164: string;
}

export const isValidDial = (dial: string): boolean => DIAL_RE.test(dial);

/**
 * Normalises what the user typed. Formatting characters (spaces, dashes,
 * brackets, dots) are dropped; a national trunk "0" is removed.
 */
export function parsePhone(
  raw: string,
  dial: string,
): { ok: true; value: ParsedPhone } | { ok: false; error: PhoneError } {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'phone_required' };
  if (/[^\d\s()+.\-/]/.test(text)) return { ok: false, error: 'phone_invalid' };
  let digits = text.replace(/\D/g, '');
  const international = text.startsWith('+') || digits.startsWith('00');
  if (international) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length < MIN_E164 || digits.length > MAX_E164)
      return { ok: false, error: 'phone_invalid' };
    // The code isn't known separately here; keep the whole number.
    return { ok: true, value: { dial: '', phone: digits, e164: digits } };
  }
  if (!isValidDial(dial)) return { ok: false, error: 'dial_invalid' };
  if (!KEEPS_TRUNK_ZERO.has(dial)) digits = digits.replace(/^0+/, '');
  const e164 = dial.slice(1) + digits;
  if (
    digits.length < MIN_NATIONAL ||
    e164.length < MIN_E164 ||
    e164.length > MAX_E164
  )
    return { ok: false, error: 'phone_invalid' };
  return { ok: true, value: { dial, phone: digits, e164 } };
}

/** "+44 7700 900123"-style display; groups the national number loosely. */
export function formatPhone(contact: {
  dial: string;
  phone: string;
  e164: string;
}): string {
  if (!contact.dial) return `+${contact.e164}`;
  return `${contact.dial} ${contact.phone.replace(/(\d{4})(?=\d)/g, '$1 ')}`;
}

/** Dialer link; the user still confirms the call in the dialer. */
export const telUrl = (e164: string): string => `tel:+${e164}`;

/**
 * WhatsApp's official click-to-chat link: digits only, country code
 * included, no "+". The optional text is only pre-filled — the user sends it.
 */
export function whatsappUrl(e164: string, text?: string): string {
  const base = `https://wa.me/${e164.replace(/\D/g, '')}`;
  return text?.trim()
    ? `${base}?text=${encodeURIComponent(text.trim())}`
    : base;
}
