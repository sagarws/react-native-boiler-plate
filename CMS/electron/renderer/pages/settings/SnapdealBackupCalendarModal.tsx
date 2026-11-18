import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'
import type { SnapdealCoverage } from '@shared/types/snapdealBackup'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import { deleteSnapdealRange, snapdealCoverage } from '@renderer/services/snapdealBackup.service'
import { classNames } from '@renderer/utils/format'
import { CALENDAR_MONTHS, calendarDate } from './snapdealCalendar'

/**
 * What the Snapdeal backup actually HOLDS, day by day.
 *
 * NO "SYNC RANGE" BUTTON HERE, which is the one way this differs from the AJIO
 * version. Snapdeal cannot be asked for a range and answer with it — asking is
 * a separate act with a wait attached — so the fix for a gap lives in the
 * Requests calendar next door, where the state of each request is visible.
 * Offering a sync button here would be a button that silently queues work and
 * appears to do nothing.
 *
 * Delete stays, because deleting is immediate and local.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** So the card's month chips refresh after a delete. */
  onChanged: () => void
}

export const SnapdealBackupCalendarModal = ({ open, onClose, onChanged }: Props) => {
  const toast = useToast()
  const [coverage, setCoverage] = useState<SnapdealCoverage | null>(null)
  const [cursor, setCursor] = useState(() => {
    const today = new Date()

    return { year: today.getFullYear(), month: today.getMonth() }
  })
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void snapdealCoverage().then(response => {
      if (cancelled || !response.success) return

      setCoverage(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [open, reloads])

  /** date → rows held, for the green. */
  const held = useMemo(() => {
    const map = new Map<string, number>()

    for (const day of coverage?.days ?? []) map.set(day.date, day.rows)

    return map
  }, [coverage])

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay()
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()

  const pick = (date: string): void => {
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

  const remove = async (): Promise<void> => {
    if (!selection) return

    setBusy(true)

    const response = await deleteSnapdealRange(selection)

    setBusy(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    toast.success(`${response.data.removed.toLocaleString()} row(s) deleted`)
    setReloads(current => current + 1)
    onChanged()
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Backup coverage · Snapdeal Return Report"
      description="Green days are days this machine holds. Pick a range to delete it."
      onClose={onClose}
      busy={busy}
      headerActions={
        <button
          type="button"
          aria-label="Close"
          disabled={busy}
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
              ? `${selection.from} → ${selection.to} · ${selectedRows.toLocaleString()} row(s) held`
              : 'Pick a day, then another for a range'}
          </p>
          <div className="flex-1" />
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            disabled={!selection || selectedRows === 0}
            loading={busy}
            onClick={() => void remove()}
          >
            Delete
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
            {CALENDAR_MONTHS[cursor.month]} {cursor.year}
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
            const date = calendarDate(cursor.year, cursor.month, index + 1)
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
                      ? 'bg-success-surface text-success-fg ring-1 ring-success-border hover:bg-success-surface/70'
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
