import type { SnapdealRequestStatus } from '@shared/types/snapdealBackup'

/**
 * What the two Snapdeal calendars share.
 *
 * Both draw a month grid and both colour days, so the month names, the
 * `yyyy-MM-dd` for a grid cell and the request palette live here rather than
 * being pasted into each — a second copy of the status colours is how the
 * "asked for" amber ends up meaning one thing in one dialog and another in the
 * next.
 */

export const CALENDAR_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

const pad = (value: number): string => String(value).padStart(2, '0')

/** `yyyy-MM-dd` for a grid cell, where `month` is zero-based as `Date` has it. */
export const calendarDate = (year: number, month: number, day: number): string =>
  `${year}-${pad(month + 1)}-${pad(day)}`

/** How each request state is painted, and what it means in words. */
export const REQUEST_STYLES: Record<
  SnapdealRequestStatus,
  { className: string; label: string }
> = {
  stored: {
    className:
      'bg-success-surface text-success-fg ring-1 ring-success-border hover:bg-success-surface/70',
    label: 'downloaded and stored'
  },
  ready: {
    className:
      'bg-info-surface text-info-fg ring-1 ring-info-border hover:bg-info-surface/70',
    label: 'built — waiting to be downloaded'
  },
  requested: {
    className:
      'bg-warning-surface text-warning-fg ring-1 ring-warning-border hover:bg-warning-surface/70',
    label: 'asked for — Snapdeal is still building it'
  },
  failed: {
    className:
      'bg-danger-surface text-danger-fg ring-1 ring-danger-border hover:bg-danger-surface/70',
    label: 'Snapdeal refused it'
  }
}
