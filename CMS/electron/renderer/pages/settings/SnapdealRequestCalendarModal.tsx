import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, DatabaseZap, Download, Eraser, Send, X } from 'lucide-react'
import type { SnapdealRequest, SnapdealRequestCoverage } from '@shared/types/snapdealBackup'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import {
  collectSnapdealRange,
  collectSnapdealRequest,
  forgetSnapdealRequests,
  requestSnapdealRange,
  snapdealRequestCoverage
} from '@renderer/services/snapdealBackup.service'
import { classNames } from '@renderer/utils/format'
import { CALENDAR_MONTHS, REQUEST_STYLES, calendarDate } from './snapdealCalendar'

/**
 * What was ASKED of Snapdeal, day by day — and the way to act on it.
 *
 * THE CALENDAR THE AJIO CARD DOES NOT NEED. AJIO answers a request with the
 * rows, so "did we ask" and "do we hold" are the same question. Snapdeal
 * answers with a receipt and builds the file over minutes, so they are two
 * questions and only one of them is visible in the data:
 *
 *   amber   asked for, Snapdeal is still building it
 *   blue    built, and sitting on the portal waiting to be downloaded
 *   green   downloaded and stored
 *   red     Snapdeal refused it — the one that needs a person
 *
 * Three actions follow from that, and each is the obvious move for one of the
 * colours. REQUEST for days with no colour at all. DOWNLOAD for amber and
 * blue — the manual fetch, for an operator who does not want to wait for the
 * scheduled pass. FORGET for red, which is the only way out of a window
 * Snapdeal refused: a request row covering a window stops anything asking for
 * it again, so a refusal would otherwise lock that window out for ever.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** So the card's month chips refresh after a request, a fetch or a forget. */
  onChanged: () => void
}

/** The requests whose window touches a range — what an action will act on. */
const overlapping = (requests: SnapdealRequest[], range: { from: string; to: string }): SnapdealRequest[] =>
  requests.filter(record => record.from <= range.to && record.to >= range.from)

export const SnapdealRequestCalendarModal = ({ open, onClose, onChanged }: Props) => {
  const toast = useToast()
  const [coverage, setCoverage] = useState<SnapdealRequestCoverage | null>(null)
  const [cursor, setCursor] = useState(() => {
    const today = new Date()

    return { year: today.getFullYear(), month: today.getMonth() }
  })
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [busy, setBusy] = useState<'request' | 'download' | 'forget' | 'store' | null>(null)
  /** The request row whose "Store" is running — so only its button spins. */
  const [storing, setStoring] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void snapdealRequestCoverage().then(response => {
      if (cancelled || !response.success) return

      setCoverage(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [open, reloads])

  /** date → how far the furthest request covering it got. */
  const asked = useMemo(() => {
    const map = new Map<string, SnapdealRequest['status']>()

    for (const day of coverage?.days ?? []) map.set(day.date, day.status)

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

  /** What the selection is actually made of — which decides what is offered. */
  const touched = useMemo(
    () => (selection ? overlapping(coverage?.requests ?? [], selection) : []),
    [coverage, selection]
  )

  const chaseable = touched.filter(
    record => record.status === 'requested' || record.status === 'ready'
  )
  const refused = touched.filter(record => record.status === 'failed')

  const after = (response: { success: boolean }): void => {
    if (!response.success) return

    setReloads(current => current + 1)
    onChanged()
  }

  const ask = async (): Promise<void> => {
    if (!selection) return

    setBusy('request')

    const response = await requestSnapdealRange(selection)

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { sent, skipped, failed } = response.data

    toast.success(
      [
        sent > 0 ? `${sent} report(s) requested` : '',
        skipped > 0 ? `${skipped} window(s) already covered` : '',
        failed > 0 ? `${failed} refused` : ''
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing to ask for'
    )
    after(response)
  }

  /**
   * The manual download: fetch the files for the requests covering these days.
   *
   * What an operator reaches for when they can see amber on the calendar and
   * do not want to wait for the scheduled pass — and the answer to "the report
   * is ready on the portal, why is it not here yet".
   */
  const download = async (): Promise<void> => {
    if (!selection) return

    setBusy('download')

    const response = await collectSnapdealRange(selection)

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { stored, added, skipped, pending } = response.data

    toast.success(
      [
        `${stored} report(s) downloaded`,
        added > 0 ? `${added.toLocaleString()} row(s) saved` : '',
        skipped > 0 ? `${skipped.toLocaleString()} already held` : '',
        // The honest half: a report Snapdeal has not finished cannot be
        // fetched, and saying nothing here reads as the download failing.
        pending > 0 ? `${pending} still building at Snapdeal` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    )
    after(response)
  }

  /**
   * "Store" on one row: download that request's report and store it, whatever
   * state the row is in — the way back for a request that came back with no
   * rows, or one marked failed after Snapdeal had already accepted it.
   */
  const store = async (request: SnapdealRequest): Promise<void> => {
    setBusy('store')
    setStoring(request.id)

    // A refused row has no portal id to quote, so it is named by its window.
    const label = request.requestId ? `#${request.requestId}` : `${request.from} → ${request.to}`
    const response = await collectSnapdealRequest({ id: request.id })

    setBusy(null)
    setStoring(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { stored, added, skipped, pending, error } = response.data

    if (stored === 0) {
      toast.error(
        error ??
          (pending > 0
            ? `${label}: not on Snapdeal's finished list yet — still building, or too old to fetch`
            : `${label}: the report could not be downloaded`)
      )
    } else {
      toast.success(
        [
          `${label} stored`,
          `${added.toLocaleString()} row(s) saved`,
          skipped > 0 ? `${skipped.toLocaleString()} already held` : ''
        ]
          .filter(Boolean)
          .join(' · ')
      )
    }

    after(response)
  }

  const forget = async (): Promise<void> => {
    if (!selection) return

    setBusy('forget')

    const response = await forgetSnapdealRequests(selection)

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    toast.success(
      `${response.data.removed} request(s) forgotten — those windows can be asked for again`
    )
    after(response)
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Request coverage · Snapdeal Return Report"
      description="Which days were asked of Snapdeal, and how far each report got. Pick a range to request, download or forget it."
      onClose={onClose}
      // NEVER LOCKED. A Store or Download can wait minutes behind a running
      // pass, and a dialog that cannot be closed until then traps the
      // operator. The call carries on after closing; onChanged refreshes the
      // card when it lands.
      headerActions={
        <button
          type="button"
          aria-label="Close"
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
              ? `${selection.from} → ${selection.to} · ${touched.length} request(s)` +
                (chaseable.length > 0 ? `, ${chaseable.length} to download` : '')
              : 'Pick a day, then another for a range'}
          </p>
          <div className="flex-1" />
          {/* Only offered when there is something refused to clear: a button
              that is always there invites somebody to press it on a healthy
              range and quietly re-open windows that were already covered. */}
          {refused.length > 0 && (
            <Button
              variant="secondary"
              icon={<Eraser size={14} />}
              loading={busy === 'forget'}
              disabled={!selection}
              title="Forgets the request rows so these windows can be asked for again. The stored rows are kept."
              onClick={() => void forget()}
            >
              Forget {refused.length}
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<Send size={14} />}
            disabled={!selection || busy !== null}
            loading={busy === 'request'}
            title="Asks Snapdeal to build reports for any window here that nothing has asked for"
            onClick={() => void ask()}
          >
            Request
          </Button>
          <Button
            icon={<Download size={14} />}
            disabled={!selection || chaseable.length === 0}
            loading={busy === 'download'}
            title={
              chaseable.length === 0
                ? 'Nothing is outstanding for these days'
                : `Download ${chaseable.length} report(s) and store them`
            }
            onClick={() => void download()}
          >
            Download {chaseable.length > 0 ? `(${chaseable.length})` : ''}
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
            const status = asked.get(date)
            const inRange = selection ? date >= selection.from && date <= selection.to : false

            return (
              <button
                key={date}
                type="button"
                onClick={() => pick(date)}
                title={status ? REQUEST_STYLES[status].label : 'Nothing asked for this day'}
                className={classNames(
                  'flex h-9 flex-col items-center justify-center rounded-md text-xs transition-colors',
                  inRange
                    ? 'bg-accent text-on-accent'
                    : status
                      ? REQUEST_STYLES[status].className
                      : 'text-textSecondary ring-1 ring-subtle hover:bg-surface-hover'
                )}
              >
                {index + 1}
              </button>
            )
          })}
        </div>

        {/* The legend is not decoration here: four colours with no key is a
            calendar an operator has to be told about by somebody else. */}
        <div className="flex flex-wrap items-center gap-3 text-2xs text-muted">
          {(['stored', 'ready', 'requested', 'failed'] as const).map(status => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className={classNames('h-2.5 w-2.5 rounded-sm', REQUEST_STYLES[status].className)}
              />
              {REQUEST_STYLES[status].label}
            </span>
          ))}
        </div>

        {/* The requests themselves, newest first. The calendar says WHEN; this
            says what Snapdeal actually called the file and how many rows came
            of it — which is what somebody chasing a short month needs. */}
        {(coverage?.requests.length ?? 0) > 0 && (
          <div className="max-h-48 overflow-auto rounded-md ring-1 ring-subtle">
            <table className="w-full text-left text-2xs">
              <thead className="sticky top-0 bg-surface-sunken text-faint">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Window</th>
                  <th className="px-2 py-1.5 font-medium">State</th>
                  <th className="px-2 py-1.5 font-medium">Request id</th>
                  <th className="px-2 py-1.5 text-right font-medium">Rows</th>
                  <th className="px-2 py-1.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {(coverage?.requests ?? []).slice(0, 60).map(request => (
                  <tr key={request.id} className="border-t border-subtle">
                    <td className="px-2 py-1.5 tabular-nums text-textSecondary">
                      {request.from} → {request.to}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={classNames('rounded px-1.5 py-0.5', REQUEST_STYLES[request.status].className)}>
                        {request.status}
                      </span>
                      {request.error && (
                        <span className="ms-1.5 text-danger-fg">{request.error}</span>
                      )}
                    </td>
                    {/* Snapdeal's own id. It cannot fetch the file — the
                        reports list carries no id to match it against — but it
                        is the number to quote to Snapdeal about a report that
                        never built. */}
                    <td className="px-2 py-1.5 tabular-nums text-muted">
                      {request.requestId ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {request.status === 'stored' ? request.rows.toLocaleString() : '—'}
                    </td>
                    {/* On EVERY row. A refused request has no Snapdeal id, but the
                        portal sometimes built the report anyway (a 502 on generate is
                        often a timeout, not a refusal) — Store looks for a finished
                        file for the same window and claims it. */}
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<DatabaseZap size={12} />}
                        loading={storing === request.id}
                        disabled={busy !== null}
                        title={
                          request.requestId
                            ? `Download report #${request.requestId} and store its rows`
                            : `Look for a finished report for this window on Snapdeal and store it`
                        }
                        onClick={() => void store(request)}
                      >
                        Store
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
