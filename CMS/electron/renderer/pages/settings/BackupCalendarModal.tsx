import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Trash2, X } from 'lucide-react'
import type { BackupCoverage, BackupReport } from '@shared/types/masterBackup'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import {
  backupCoverage,
  deleteBackupRange,
  syncBackupRange
} from '@renderer/services/masterBackup.service'
import { classNames } from '@renderer/utils/format'

/**
 * What the backup actually holds, day by day — and the way to fix a gap.
 *
 * THE CALENDAR IS THE POINT. "Which months did we back up" is answerable from a
 * list; "is there a hole in the middle of August" is not, and a hole is the
 * failure this feature exists to prevent. Green days are days with rows.
 *
 * ANY range can be picked, held or not: re-syncing a day already held is how a
 * day that was half-written gets completed, and the AWB + EAN skip makes it
 * cost nothing. The same selection can be deleted — the one destructive action
 * here, so it names the range and the row count before it runs.
 */

interface Props {
  open: boolean
  report: BackupReport
  onClose: () => void
  /** So the card's month chips refresh after a sync or a delete. */
  onChanged: () => void
}

const pad = (value: number): string => String(value).padStart(2, '0')
const ymd = (year: number, month: number, day: number): string =>
  `${year}-${pad(month + 1)}-${pad(day)}`

const MONTH_NAMES = [
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

export const BackupCalendarModal = ({ open, report, onClose, onChanged }: Props) => {
  const toast = useToast()
  const [coverage, setCoverage] = useState<BackupCoverage | null>(null)
  const [cursor, setCursor] = useState(() => {
    const today = new Date()

    return { year: today.getFullYear(), month: today.getMonth() }
  })
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [busy, setBusy] = useState<'sync' | 'delete' | null>(null)

  /** Bumped after a sync or a delete, to re-read what is held. */
  const [reloads, setReloads] = useState(0)

  // Every setState happens after an await, so the dialog never re-renders
  // synchronously from inside the effect.
  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void backupCoverage(report).then(response => {
      if (cancelled || !response.success) return

      setCoverage(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [open, report, reloads])

  /** date → rows held, for the green. */
  const held = useMemo(() => {
    const map = new Map<string, number>()

    for (const day of coverage?.days ?? []) map.set(day.date, day.rows)

    return map
  }, [coverage])

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay()
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()

  const pick = (date: string): void => {
    // First click starts a range, second completes it, third starts again —
    // the gesture every date picker uses, so nobody has to be told.
    if (!from || (from && to)) {
      setFrom(date)
      setTo(null)
    } else if (date < from) {
      setFrom(date)
      setTo(from)
    } else {
      setTo(date)
    }
  }

  const selection = useMemo(() => (from ? { from, to: to ?? from } : null), [from, to])

  const selectedRows = useMemo(() => {
    if (!selection) return 0

    let rows = 0

    for (const [date, count] of held) {
      if (date >= selection.from && date <= selection.to) rows += count
    }

    return rows
  }, [held, selection])

  const run = async (action: 'sync' | 'delete'): Promise<void> => {
    if (!selection) return

    setBusy(action)

    const response =
      action === 'sync'
        ? await syncBackupRange({ report, ...selection })
        : await deleteBackupRange({ report, ...selection })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    if ('removed' in response.data) {
      toast.success(`${response.data.removed} row(s) deleted`)
    } else {
      const { added, skipped, failed } = response.data

      toast.success(
        `${added} row(s) saved` +
          (skipped > 0 ? `, ${skipped} already held` : '') +
          (failed > 0 ? `, ${failed} page(s) failed` : '')
      )
    }

    setReloads(current => current + 1)
    onChanged()
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={`Backup coverage · ${report === 'forward' ? 'Forward' : 'Return'} Report`}
      description="Green days are days this machine holds. Pick any range to re-sync or delete it."
      onClose={onClose}
      busy={busy !== null}
      headerActions={
        // The footer is two actions that DO something — deleting and syncing —
        // and neither of them is "I am finished looking". Escape closed this
        // already; a button says so to anyone who does not know that.
        <button
          type="button"
          aria-label="Close"
          disabled={busy !== null}
          onClick={onClose}
          className="rounded-md p-1.5 text-faint ring-1 ring-subtle hover:bg-surface-active hover:text-textSecondary disabled:opacity-40"
        >
          <X size={16} />
        </button>
      }
      footer={
        <>
          <p className="self-center text-xs text-muted">
            {selection
              ? `${selection.from} → ${selection.to} · ${selectedRows} row(s) held`
              : 'Pick a day, then another for a range'}
          </p>
          <div className="flex-1" />
          <Button
            variant="secondary"
            icon={<Trash2 size={14} />}
            disabled={!selection || selectedRows === 0}
            loading={busy === 'delete'}
            onClick={() => void run('delete')}
          >
            Delete
          </Button>
          <Button
            icon={<RefreshCw size={14} />}
            disabled={!selection}
            loading={busy === 'sync'}
            onClick={() => void run('sync')}
          >
            Sync range
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            className="rounded p-1.5 text-faint hover:bg-surface-active hover:text-textSecondary"
            onClick={() =>
              setCursor(current =>
                current.month === 0
                  ? { year: current.year - 1, month: 11 }
                  : { ...current, month: current.month - 1 }
              )
            }
          >
            <ChevronLeft size={16} />
          </button>

          <p className="text-sm font-medium text-body">
            {MONTH_NAMES[cursor.month]} {cursor.year}
          </p>

          <button
            type="button"
            aria-label="Next month"
            className="rounded p-1.5 text-faint hover:bg-surface-active hover:text-textSecondary"
            onClick={() =>
              setCursor(current =>
                current.month === 11
                  ? { year: current.year + 1, month: 0 }
                  : { ...current, month: current.month + 1 }
              )
            }
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-2xs text-faint">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekday }, (_, index) => (
            <span key={`pad-${index}`} />
          ))}

          {Array.from({ length: daysInMonth }, (_, index) => {
            const date = ymd(cursor.year, cursor.month, index + 1)
            const rows = held.get(date) ?? 0
            const inRange = selection ? date >= selection.from && date <= selection.to : false

            return (
              <button
                key={date}
                type="button"
                onClick={() => pick(date)}
                title={rows > 0 ? `${rows} row(s) held` : 'Nothing held for this day'}
                className={classNames(
                  'flex h-9 flex-col items-center justify-center rounded-md text-xs transition-colors',
                  inRange
                    ? 'bg-accent text-on-accent'
                    : rows > 0
                      ? // Green means held. The count is in the tooltip rather
                        // than the cell: forty-two rows and four look the same
                        // at this size, and the question is "is it there".
                        'bg-success-surface text-success-fg ring-1 ring-success-border hover:bg-success-surface/70'
                      : 'text-textSecondary ring-1 ring-subtle hover:bg-surface-hover'
                )}
              >
                {index + 1}
              </button>
            )
          })}
        </div>

        <p className="text-xs text-muted">
          {coverage
            ? `${coverage.rows.toLocaleString()} row(s) held across ${coverage.months.length} month(s).`
            : 'Reading what is held…'}
        </p>
      </div>
    </Modal>
  )
}
