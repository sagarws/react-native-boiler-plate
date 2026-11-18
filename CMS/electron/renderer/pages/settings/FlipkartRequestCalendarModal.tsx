import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, DatabaseZap, Download, Eraser, Send, X } from 'lucide-react'
import type {
  FlipkartReport,
  FlipkartRequest,
  FlipkartRequestCoverage,
  FlipkartRequestStatus
} from '@shared/types/flipkartBackup'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import {
  collectFlipkartRange,
  collectFlipkartRequest,
  flipkartRequestCoverage,
  forgetFlipkartRequests,
  requestFlipkartRange
} from '@renderer/services/flipkartBackup.service'
import { classNames } from '@renderer/utils/format'
import { CALENDAR_MONTHS, REQUEST_STYLES, calendarDate } from './snapdealCalendar'

/**
 * What was ASKED of Flipkart for one report, day by day — and the way to act
 * on it. The Snapdeal request calendar, for Flipkart's report:
 *
 *   amber   asked for, Flipkart is still building it
 *   green   downloaded and stored
 *   red     Flipkart refused or failed it
 *
 * Flipkart has no blue: a finished file is only known by listing the Report
 * Centre, which is what Download does, so "built, waiting" is never stored.
 *
 * REQUEST for days with no colour. DOWNLOAD for amber — the manual fetch.
 * FORGET for red, to clear a refused window from the calendar. STORE on a row
 * fetches that one request's file again, whatever its state.
 */

interface Props {
  open: boolean
  report: FlipkartReport
  /** The account the card is set to — requests and downloads are made as it. */
  username: string
  onClose: () => void
  /** So the card's month chips refresh after a request, a fetch or a forget. */
  onChanged: () => void
}

const REPORT_TITLE: Record<FlipkartReport, string> = { forward: 'Orders Report', return: 'Returns Report' }

/** Snapdeal's palette — one meaning per colour across both cards — with Flipkart's words. */
const STYLES: Record<FlipkartRequestStatus, { className: string; label: string }> = {
  stored: REQUEST_STYLES.stored,
  requested: { ...REQUEST_STYLES.requested, label: 'asked for — Flipkart is still building it' },
  failed: { ...REQUEST_STYLES.failed, label: 'Flipkart refused it' }
}

/** The requests whose window touches a range — what an action will act on. */
const overlapping = (requests: FlipkartRequest[], range: { from: string; to: string }): FlipkartRequest[] =>
  requests.filter(record => record.from <= range.to && record.to >= range.from)

export const FlipkartRequestCalendarModal = ({ open, report, username, onClose, onChanged }: Props) => {
  const toast = useToast()
  const [coverage, setCoverage] = useState<FlipkartRequestCoverage | null>(null)
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

    void flipkartRequestCoverage(report).then(response => {
      if (cancelled || !response.success) return

      setCoverage(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [open, report, reloads])

  /** date → how far the furthest request covering it got. */
  const asked = useMemo(() => {
    const map = new Map<string, FlipkartRequestStatus>()

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

  const chaseable = touched.filter(record => record.status === 'requested')
  const refused = touched.filter(record => record.status === 'failed')

  const after = (response: { success: boolean }): void => {
    if (!response.success) return

    setReloads(current => current + 1)
    onChanged()
  }

  const ask = async (): Promise<void> => {
    if (!selection) return

    setBusy('request')

    const response = await requestFlipkartRange({ username, report, ...selection })

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

  /** The manual download: fetch the files for the requests covering these days. */
  const download = async (): Promise<void> => {
    if (!selection) return

    setBusy('download')

    const response = await collectFlipkartRange({ username, report, ...selection })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { stored, added, pending, failed } = response.data

    toast.success(
      [
        `${stored} report(s) downloaded`,
        added > 0 ? `${added.toLocaleString()} row(s) saved` : '',
        // A report Flipkart has not finished cannot be fetched, and saying
        // nothing here reads as the download failing.
        pending > 0 ? `${pending} still building at Flipkart` : '',
        failed > 0 ? `${failed} failed` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    )
    after(response)
  }

  /**
   * "Store" on one row: download that request's report and store it, whatever
   * state the row is in — the way back for one marked failed after Flipkart
   * had already built it.
   */
  const store = async (request: FlipkartRequest): Promise<void> => {
    setBusy('store')
    setStoring(request.id)

    // A refused row has no portal id to quote, so it is named by its window.
    const label = request.requestId ? `#${request.requestId}` : `${request.from} → ${request.to}`
    const response = await collectFlipkartRequest({ id: request.id })

    setBusy(null)
    setStoring(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { stored, added, pending } = response.data

    if (stored === 0) {
      toast.error(
        pending > 0
          ? `${label}: not on Flipkart's finished list yet — still building, or too old to fetch`
          : `${label}: the report could not be downloaded`
      )
    } else {
      toast.success(`${label} stored · ${added.toLocaleString()} row(s) saved`)
    }

    after(response)
  }

  const forget = async (): Promise<void> => {
    if (!selection) return

    setBusy('forget')

    const response = await forgetFlipkartRequests({ report, ...selection })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    toast.success(`${response.data.removed} request(s) forgotten — those windows can be asked for again`)
    after(response)
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={`Request coverage · Flipkart ${REPORT_TITLE[report]}`}
      description="Which days were asked of Flipkart, and how far each report got. Pick a range to request, download or forget it."
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
            disabled={!selection || !username || busy !== null}
            loading={busy === 'request'}
            title={
              !username
                ? 'Choose the Flipkart account on the card first'
                : 'Asks Flipkart to build reports for any window here that nothing has asked for'
            }
            onClick={() => void ask()}
          >
            Request
          </Button>
          <Button
            icon={<Download size={14} />}
            disabled={!selection || !username || chaseable.length === 0}
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
                title={status ? STYLES[status].label : 'Nothing asked for this day'}
                className={classNames(
                  'flex h-9 flex-col items-center justify-center rounded-md text-xs transition-colors',
                  inRange
                    ? 'bg-accent text-on-accent'
                    : status
                      ? STYLES[status].className
                      : 'text-textSecondary ring-1 ring-subtle hover:bg-surface-hover'
                )}
              >
                {index + 1}
              </button>
            )
          })}
        </div>

        {/* The legend is not decoration here: colours with no key is a calendar
            an operator has to be told about by somebody else. */}
        <div className="flex flex-wrap items-center gap-3 text-2xs text-muted">
          {(['stored', 'requested', 'failed'] as const).map(status => (
            <span key={status} className="flex items-center gap-1.5">
              <span className={classNames('h-2.5 w-2.5 rounded-sm', STYLES[status].className)} />
              {STYLES[status].label}
            </span>
          ))}
        </div>

        {/* The requests themselves, newest first. The calendar says WHEN; this
            says Flipkart's request id and how many rows came of it. */}
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
                      <span className={classNames('rounded px-1.5 py-0.5', STYLES[request.status].className)}>
                        {request.status}
                      </span>
                      {request.error && <span className="ms-1.5 text-danger-fg">{request.error}</span>}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-muted">{request.requestId ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {request.status === 'stored' ? request.rows.toLocaleString() : '—'}
                    </td>
                    {/* On EVERY row. A refused request has no Flipkart id, but the
                        portal sometimes built the report anyway (a 502 on submit is
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
                            : `Look for a finished report for this window on Flipkart and store it`
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
