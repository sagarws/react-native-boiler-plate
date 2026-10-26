// Picker options. Flag emoji uses regional-indicator pairs and renders
// natively on iOS 10+ and most Android distributions. Dial-codes can collide
// (US/CA share +1) — the picker displays both rows; callers only store the
// dial code, so the US-vs-CA choice isn't preserved. Acceptable for phone
// capture; if ISO ever matters we'd lift state to { iso, dial }.
export interface Country {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

export const COUNTRIES: readonly Country[] = [
  { iso: 'gb', name: 'United Kingdom', dial: '+44', flag: '🇬🇧' },
  { iso: 'ie', name: 'Ireland', dial: '+353', flag: '🇮🇪' },
  { iso: 'al', name: 'Albania', dial: '+355', flag: '🇦🇱' },
  { iso: 'ro', name: 'Romania', dial: '+40', flag: '🇷🇴' },
  { iso: 'it', name: 'Italy', dial: '+39', flag: '🇮🇹' },
  { iso: 'de', name: 'Germany', dial: '+49', flag: '🇩🇪' },
  { iso: 'fr', name: 'France', dial: '+33', flag: '🇫🇷' },
  { iso: 'es', name: 'Spain', dial: '+34', flag: '🇪🇸' },
  { iso: 'pt', name: 'Portugal', dial: '+351', flag: '🇵🇹' },
  { iso: 'pl', name: 'Poland', dial: '+48', flag: '🇵🇱' },
  { iso: 'nl', name: 'Netherlands', dial: '+31', flag: '🇳🇱' },
  { iso: 'be', name: 'Belgium', dial: '+32', flag: '🇧🇪' },
  { iso: 'us', name: 'United States', dial: '+1', flag: '🇺🇸' },
  { iso: 'ca', name: 'Canada', dial: '+1', flag: '🇨🇦' },
  { iso: 'au', name: 'Australia', dial: '+61', flag: '🇦🇺' },
  { iso: 'in', name: 'India', dial: '+91', flag: '🇮🇳' },
] as const;

export const DEFAULT_COUNTRY_DIAL = '+44';
// Lightweight validation — full E.164 lives on the BE. We just want to catch
// typos before submit.
export const COUNTRY_DIAL_RE = /^\+\d{1,4}$/;
// Mobile number bounds. E.164 caps the full subscriber number at 15 digits;
// we apply the same cap to the national portion to be safe. 6 is a sane
// minimum that excludes obvious typos without blocking short-code formats.
export const MOBILE_MIN = 6;
export const MOBILE_MAX = 15;
export const MOBILE_RE = new RegExp(`^\\d{${MOBILE_MIN},${MOBILE_MAX}}$`);

export function findCountry(dial: string): Country | undefined {
  return COUNTRIES.find(c => c.dial === dial);
}

// Strips spaces and any non-digit characters so the stored value is the
// canonical national subscriber number. Callers pre-process keystrokes
// through this before validating.
export function normaliseMobile(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function isValidMobile(value: string): boolean {
  return MOBILE_RE.test(value);
}
