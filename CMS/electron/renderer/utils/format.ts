/** Formats an ISO timestamp using the user's locale, with a safe fallback. */
export const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export const formatDate = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export const classNames = (...values: (string | false | null | undefined)[]): string =>
  values.filter(Boolean).join(' ')

/** Human-readable file size. Uses binary units, matching what installers report. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  // Bytes are whole; everything larger reads better with one decimal.
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`
}
