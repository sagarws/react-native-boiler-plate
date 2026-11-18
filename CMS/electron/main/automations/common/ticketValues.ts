import type { TicketThreadField } from '@shared/types/ticketThread'

/**
 * Coercion for the ticket window — shared by every platform's ticket view
 * (AJIO, Meesho, Snapdeal), so a value reads the same whichever portal sent it.
 *
 * Every input here is a marketplace response, so nothing is trusted: strings
 * are capped, only https URLs survive, and anything that is not a plain value
 * becomes "" — which the Details panel reads as "leave the row out".
 */

export const MAX_TEXT = 20_000
export const MAX_VALUE = 2_000
export const MAX_COMMENTS = 300

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const text = (value: unknown, max = MAX_TEXT): string =>
  typeof value === 'string' ? value.slice(0, max) : ''

/** A value as the Details panel shows it; empty means "leave the row out". */
export const display = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value.trim().slice(0, MAX_VALUE)

  return ''
}

export const httpsUrl = (value: unknown): string | null => {
  const raw = text(value, 4_000).trim()

  try {
    return new URL(raw).protocol === 'https:' ? raw : null
  } catch {
    return null
  }
}

/** "forwardAwbNumber" / "reopen_count" → "Forward awb number" / "Reopen count". */
export const humaniseKey = (key: string): string => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim()

  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Named fields off one object, in the given order, blanks dropped. */
export const fieldsOf = (source: Record<string, unknown>, keys: readonly [string, string][]): TicketThreadField[] =>
  keys
    .map(([key, label]) => ({ label, value: display(source[key]) }))
    .filter((field) => field.value !== '')

/** Every plain value on an object not already shown — "show all data". */
export const remainingFieldsOf = (
  source: Record<string, unknown>,
  skip: ReadonlySet<string>
): TicketThreadField[] =>
  Object.entries(source)
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => ({ label: humaniseKey(key), value: display(value) }))
    .filter((field) => field.value !== '')

/** Oldest first, as a chat reads. Entries without a readable time keep their place. */
export const oldestFirst = <T>(items: T[], at: (item: T) => string | null): T[] =>
  items
    .map((item, index) => ({ item, index, time: Date.parse((at(item) ?? '').replace(' ', 'T')) }))
    .sort((a, b) =>
      Number.isNaN(a.time) || Number.isNaN(b.time) ? a.index - b.index : a.time - b.time || a.index - b.index
    )
    .map(({ item }) => item)
