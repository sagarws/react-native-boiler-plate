import type { TFunction } from 'i18next';

/** Localised "x min ago"; falls back to a short date beyond 30 days. */
export function formatAgo(
  t: TFunction,
  epochMs: number,
  now: number = Date.now(),
): string {
  const sec = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (sec < 60) return t('time.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('time.minutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('time.hoursAgo', { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t('time.daysAgo', { count: day });
  const date = new Date(epochMs);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}
