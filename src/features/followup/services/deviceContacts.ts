import { isDayKey, type DayKey } from '@/shared/utils/dayKey';

/** A phone address-book entry (read on the device, never stored as a whole). */
export interface DeviceContact {
  id: string;
  name: string;
  phones: string[];
  email?: string;
  organization?: string;
  /** As Android stores it: "1990-05-12", or "--05-12" without a year. */
  birthday?: string;
}

/** What a chosen contact fills into the contact form. */
export interface ContactFill {
  name: string;
  dial: string;
  phone: string;
  email: string;
  organization: string;
  birthDate: DayKey | '';
}

/** Parses the native JSON, dropping malformed entries. */
export function parseDeviceContacts(json: string): DeviceContact[] {
  try {
    const raw: unknown = JSON.parse(json);
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list
      .filter(
        (c): c is DeviceContact =>
          !!c &&
          typeof c === 'object' &&
          typeof c.id === 'string' &&
          typeof c.name === 'string' &&
          Array.isArray(c.phones),
      )
      .map(c => ({
        ...c,
        name: c.name.trim(),
        phones: c.phones.filter(
          (p): p is string => typeof p === 'string' && /\d/.test(p),
        ),
      }))
      .filter(c => c.phones.length > 0);
  } catch {
    return [];
  }
}

/** Name contains the text, or (3+ digits) any number contains those digits. */
export function searchContacts(
  list: readonly DeviceContact[],
  query: string,
): DeviceContact[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...list];
  const digits = q.replace(/\D/g, '');
  return list.filter(
    c =>
      c.name.toLocaleLowerCase().includes(q) ||
      (digits.length >= 3 &&
        c.phones.some(p => p.replace(/\D/g, '').includes(digits))),
  );
}

/**
 * Splits a stored number into the form's country code + number. "+44 …"
 * takes the longest matching known code; an unknown "+code" is kept whole
 * as "00…" (the form's any-country format); a local number keeps the
 * currently selected code.
 */
export function splitNumber(
  raw: string,
  currentDial: string,
  knownDials: readonly string[],
): { dial: string; phone: string } {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  const international = trimmed.startsWith('+') || digits.startsWith('00');
  if (!international) return { dial: currentDial, phone: digits };
  const full = digits.startsWith('00') ? digits.slice(2) : digits;
  const match = [...knownDials]
    .map(d => d.slice(1))
    .sort((a, b) => b.length - a.length)
    .find(code => full.startsWith(code));
  return match
    ? { dial: `+${match}`, phone: full.slice(match.length) }
    : { dial: currentDial, phone: `00${full}` };
}

/** "1990-05-12" → day key; "--05-12" (no year) or anything odd → ''. */
export function birthDateOf(value: string | undefined): DayKey | '' {
  const v = (value ?? '').trim().slice(0, 10);
  return isDayKey(v) ? v : '';
}

export function fillFrom(
  contact: DeviceContact,
  phone: string,
  currentDial: string,
  knownDials: readonly string[],
): ContactFill {
  return {
    name: contact.name,
    ...splitNumber(phone, currentDial, knownDials),
    email: contact.email ?? '',
    organization: contact.organization ?? '',
    birthDate: birthDateOf(contact.birthday),
  };
}
