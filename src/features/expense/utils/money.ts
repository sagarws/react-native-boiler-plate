/**
 * Rupee amounts are held as integer paise everywhere (₹1 = 100) and only
 * turned into text at the edges, so sums never drift by a paisa.
 */

/** ₹1 crore — far above any single personal expense; guards typos. */
export const MAX_AMOUNT = 1_00_00_000 * 100;

/** "1,250.5" / "₹ 99" / ".75" → paise; null when it isn't a valid amount. */
export function parseAmount(raw: string): number | null {
  const text = raw.trim().replace(/[\s,₹]/g, '');
  const m = /^(\d{0,9})(?:\.(\d{0,2}))?$/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  const paise = Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return paise > 0 && paise <= MAX_AMOUNT ? paise : null;
}

/** Indian digit grouping: 1234567 → "12,34,567". */
function group(rupees: number): string {
  const s = String(rupees);
  if (s.length <= 3) return s;
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${s.slice(-3)}`;
}

/**
 * Paise → "₹1,23,456.50"; whole rupees drop the ".00". The currency symbol is
 * notation, not translatable text.
 */
export function formatInr(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const sign = paise < 0 ? '-' : '';
  const fraction = rest ? `.${String(rest).padStart(2, '0')}` : '';
  return `${sign}₹${group(rupees)}${fraction}`;
}

/** Paise → "500.00", the form UPI links expect. */
export function toUpiAmount(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** Paise → what goes back into an amount field: "500" or "500.50". */
export function toAmountInput(paise: number): string {
  return paise % 100 ? toUpiAmount(paise) : String(paise / 100);
}
