import { useEffect, useMemo, useState } from 'react'
import { ListChecks, Search, X } from 'lucide-react'
import type { BackupRecord, BackupReport, BackupSearchHit } from '@shared/types/masterBackup'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { Select } from '@renderer/components/ui/Select'
import {
  backupCoverage,
  backupMonth,
  lookupBackup,
  searchBackup
} from '@renderer/services/masterBackup.service'
import { formatBytes, jsonBytes } from '@shared/utils/dataSize'

/**
 * What is stored, as it is stored.
 *
 * The same table the live report shows, plus the three columns that make the
 * backup readable: YEAR, MONTH and PAGE. Those are why a gap is findable — a
 * month whose pages run 0,1,2,4 is missing page 3, which no row count would
 * tell you.
 *
 * TWO WAYS IN, answering different questions.
 *
 *   BROWSE  a report and a month, for "what did we get in January".
 *   SEARCH  an AWB or EAN across EVERYTHING held, for "do we have this row" —
 *           which is the question somebody actually arrives with. They have the
 *           number in their hand, and that number says nothing about which
 *           month or which report it is in, so making them pick first was
 *           asking them to answer the question in order to ask it.
 *
 * Case and spacing are ignored: an AWB pasted out of a spreadsheet arrives
 * however it arrives, and none of that says whether the row is held.
 *
 * THE SIZE IS IN THE HEADER because the question behind this dialog is usually
 * capacity: this is JSON on somebody's laptop, and "a year of the return
 * report" is a number of megabytes before it is anything else. Measured from
 * the rows actually loaded — the real serialised bytes, not an estimate.
 */

interface Props {
  open: boolean
  /** The report the card was showing. The dialog opens on it and can switch. */
  report: BackupReport
  onClose: () => void
}

const PAGE_SIZE = 100

/** Below this a search matches most of a year, so it is not run. */
const MIN_SEARCH = 3

const REPORTS: { value: BackupReport; label: string }[] = [
  { value: 'return', label: 'Return Report' },
  { value: 'forward', label: 'Forward Report' }
]

/** AJIO's rows are untyped JSON, so a cell can be anything. Show it readably. */
const cellText = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return JSON.stringify(value)
}

/**
 * The columns worth reading, rather than everything AJIO returned.
 *
 * A row carries forty-odd fields — tax components, credit-note numbers,
 * carrier timestamps — and a table showing all of them is a horizontal scroll
 * nobody reads to the end of. These seven are what somebody checking the backup
 * against a claim actually looks at: where the row came from, then the four
 * identifiers a claim is argued with.
 *
 * THE TWO REPORTS SPELL THEM DIFFERENTLY, which is why each column is a
 * function rather than a key: `returnAwbNo` against `awbNumber`, `sellerSku`
 * against `sellerSKU`, `returnOrderNo` against `orderNo`. The AWB and the EAN
 * are read off the RECORD, where they were normalised when the row was stored,
 * so they are the same pair the backup is keyed and searched on.
 */
const COLUMNS: { label: string; of: (record: BackupRecord) => unknown }[] = [
  { label: 'Year', of: record => record.year },
  { label: 'Month', of: record => String(record.month).padStart(2, '0') },
  // One-based on screen, as the files are named.
  { label: 'Page', of: record => record.page + 1 },
  { label: 'AWB Number', of: record => record.awb || record.row.returnAwbNo || record.row.awbNumber },
  { label: 'Return Order No', of: record => record.row.returnOrderNo ?? record.row.orderNo },
  { label: 'EAN', of: record => record.ean || record.row.ean },
  { label: 'Seller SKU', of: record => record.row.sellerSku ?? record.row.sellerSKU }
]

export const BackupViewerModal = ({ open, report, onClose }: Props) => {
  /**
   * The report being looked at — the card's, until it is changed here.
   *
   * Switchable in the dialog because "what do we hold" is one question about
   * two reports: closing this, changing a dropdown on the card and reopening it
   * is three steps for a glance.
   */
  /**
   * Seeded from the card, and remounted with it — the call site keys this
   * dialog on the card's report and on whether it is open, so every opening
   * starts from what the card was showing without an effect writing state on
   * mount.
   */
  const [chosenReport, setChosenReport] = useState<BackupReport>(report)
  const [months, setMonths] = useState<{ year: number; month: number; rows: number }[]>([])
  /** Empty until a month is picked; the newest held stands in. */
  const [picked, setPicked] = useState('')
  const [loaded, setLoaded] = useState<{
    key: string
    report: BackupReport
    rows: BackupRecord[]
  } | null>(null)
  const [term, setTerm] = useState('')
  /**
   * Results TAGGED with the term they answer.
   *
   * Tagged rather than held beside a `searching` flag, because the flag would
   * have to be raised synchronously as the term changes — and that is a render
   * inside an effect. Carrying the term with the rows makes "still searching" a
   * comparison instead of a second piece of state that can disagree.
   */
  const [hits, setHits] = useState<{
    term: string
    rows: BackupSearchHit[]
    capped: boolean
    /** Why the search could not run, when it could not. */
    error: string | null
  } | null>(null)
  const [page, setPage] = useState(0)
  /**
   * A pasted list of AWBs, and what came back.
   *
   * Its own box rather than the search one: they answer different questions.
   * The search is "is this number anywhere", typed a character at a time; this
   * is "which of THESE do we hold", pasted whole, and its useful half is the
   * numbers that are MISSING — which a "contains" search could never report.
   */
  const [pasted, setPasted] = useState('')
  const [looked, setLooked] = useState<{
    term: string
    rows: BackupSearchHit[]
    found: string[]
    missing: string[]
    /** Why the look-up could not run, when it could not. */
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void backupCoverage(chosenReport).then(response => {
      if (cancelled || !response.success) return

      setMonths(response.data.months)
      setPicked('')
      setPage(0)
    })

    return () => {
      cancelled = true
    }
  }, [open, chosenReport])

  const newest = months[0]
  const chosen = picked || (newest ? `${newest.year}-${newest.month}` : '')

  useEffect(() => {
    if (!open || !chosen) return undefined

    const [year, month] = chosen.split('-').map(Number)
    let cancelled = false

    void backupMonth({ report: chosenReport, year: year ?? 0, month: month ?? 0 }).then(response => {
      if (cancelled) return

      setLoaded({
        key: chosen,
        report: chosenReport,
        rows: response.success ? response.data.rows : []
      })
    })

    return () => {
      cancelled = true
    }
  }, [open, chosen, chosenReport])

  /**
   * The search, debounced, across every month of both reports.
   *
   * Run in the main process rather than over the rows already loaded: what is
   * loaded is one month of one report, and looking past that is the point.
   */
  const wanted = term.trim()
  const list = pasted.trim()
  const listMode = list.length > 0
  const lookedUp = looked?.term === list ? looked : null
  const looking = listMode && lookedUp === null
  // The list wins: it is the deliberate act, and the search box is where a
  // stray character can leave a term behind.
  const searchMode = !listMode && wanted.length >= MIN_SEARCH
  const answered = hits?.term === wanted ? hits : null
  const searching = searchMode && answered === null

  useEffect(() => {
    if (!listMode) return undefined

    let cancelled = false
    const timer = setTimeout(() => {
      void lookupBackup(list).then(response => {
        if (cancelled) return

        /**
         * A FAILED CALL IS NOT AN EMPTY BACKUP.
         *
         * Both of these used to map a failure onto zero rows, so an IPC channel
         * the main process had not registered yet — or any other error — read
         * as "no stored row carries that AWB", about rows that were sitting in
         * the table behind the dialog. The reason is kept and shown.
         */
        setLooked({
          term: list,
          rows: response.success ? response.data.hits : [],
          found: response.success ? response.data.found : [],
          missing: response.success ? response.data.missing : [],
          error: response.success ? null : response.error.message
        })
      })
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [list, listMode])

  useEffect(() => {
    if (wanted.length < MIN_SEARCH) return undefined

    let cancelled = false
    const timer = setTimeout(() => {
      void searchBackup(wanted).then(response => {
        if (cancelled) return

        setHits({
          term: wanted,
          rows: response.success ? response.data.hits : [],
          capped: response.success ? response.data.capped : false,
          error: response.success ? null : response.error.message
        })
      })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [wanted])
  const monthRows = useMemo(
    () => (loaded && loaded.key === chosen && loaded.report === chosenReport ? loaded.rows : []),
    [loaded, chosen, chosenReport]
  )
  const rows: (BackupRecord | BackupSearchHit)[] = listMode
    ? (lookedUp?.rows ?? [])
    : searchMode
      ? (answered?.rows ?? [])
      : monthRows
  /** Either way of looking past the chosen month. */
  const everywhere = listMode || searchMode
  const loadingMonth =
    !everywhere &&
    open &&
    chosen !== '' &&
    (loaded?.key !== chosen || loaded.report !== chosenReport)

  /** What this month takes on disk, measured rather than guessed. */
  const bytes = useMemo(() => (monthRows.length > 0 ? jsonBytes(monthRows) : 0), [monthRows])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  // Clamped rather than reset in an effect: switching from a month of 9,000
  // rows to a search with three leaves the page index past the end, and a
  // dialog that answers an empty table to a search that DID match reads as a
  // search that failed.
  const safePage = Math.min(page, totalPages - 1)
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <Modal
      open={open}
      size="xl"
      fill
      title={`Stored data · ${chosenReport === 'forward' ? 'Forward' : 'Return'} Report`}
      description="What this machine holds — with the year, month and page each row arrived in."
      onClose={onClose}
      headerActions={
        <div className="flex items-center gap-2">
          <span
            className="rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium tabular-nums text-textSecondary ring-1 ring-subtle"
            title={`${monthRows.length.toLocaleString()} stored row(s) for this month, as JSON on this machine`}
          >
            {loadingMonth ? '—' : formatBytes(bytes)}
          </span>

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1.5 text-faint ring-1 ring-subtle hover:bg-surface-active hover:text-textSecondary"
          >
            <X size={16} />
          </button>
        </div>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Report"
            size="sm"
            className="w-40"
            value={chosenReport}
            onChange={event => setChosenReport(event.target.value as BackupReport)}
            options={REPORTS.map(entry => ({ value: entry.value, label: entry.label }))}
          />

          {/* Disabled while searching, because a search is not of this month —
              leaving it live would suggest the results were filtered by it. */}
          <Select
            aria-label="Month"
            size="sm"
            className="w-44"
            value={chosen}
            disabled={everywhere}
            onChange={event => {
              setPicked(event.target.value)
              setPage(0)
            }}
            options={months.map(month => ({
              value: `${month.year}-${month.month}`,
              label: `${month.year}-${String(month.month).padStart(2, '0')} · ${month.rows} rows`
            }))}
          />

          <span className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              aria-label="Search AWB or EAN"
              className="h-8 w-64 pl-8 text-xs"
              placeholder="Search AWB or EAN everywhere…"
              value={term}
              onChange={event => setTerm(event.target.value)}
            />
          </span>

          <span className="relative">
            <ListChecks
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              aria-label="Look up many AWB numbers"
              className="h-8 w-72 pl-8 text-xs"
              placeholder="Paste AWBs — comma or newline separated"
              value={pasted}
              onChange={event => setPasted(event.target.value)}
            />
          </span>

          <span className="text-xs tabular-nums text-muted">
            {looking
              ? 'Looking them up…'
              : searching
                ? 'Searching every month…'
                : loadingMonth
                  ? 'Reading…'
                  : `${rows.length.toLocaleString()}${answered?.capped ? '+' : ''} row(s)`}
          </span>

          {everywhere && !searching && !looking && (
            <span className="text-xs text-muted">across every month held</span>
          )}
        </div>
      }
      footer={
        <>
          <p className="self-center text-xs tabular-nums text-muted">
            Page {safePage + 1} of {totalPages}
          </p>
          <div className="flex-1" />
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(Math.max(0, safePage - 1))}
            className="rounded-md px-3 py-1.5 text-xs ring-1 ring-subtle disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={safePage + 1 >= totalPages}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md px-3 py-1.5 text-xs ring-1 ring-subtle disabled:opacity-40"
          >
            Next
          </button>
        </>
      }
    >
      {/* What went wrong, when something did — never silently an empty table. */}
      {(lookedUp?.error || answered?.error) && (
        <p className="mb-2 rounded-md bg-danger-surface px-3 py-2 text-xs text-danger-fg ring-1 ring-inset ring-danger-border">
          {lookedUp?.error ?? answered?.error}
        </p>
      )}

      {/* The half of the answer the table cannot show: numbers nothing is held
          for, in the order they were pasted so the list reads against the one
          it came from. */}
      {lookedUp && !lookedUp.error && lookedUp.missing.length > 0 && (
        <p className="mb-2 rounded-md bg-warning-surface px-3 py-2 text-xs text-warning-fg ring-1 ring-inset ring-warning-border">
          {/* Counted by the numbers asked about, not by the rows found: one
              AWB can hold several articles, so rows and numbers are not the
              same count. */}
          <span className="font-medium">
            {lookedUp.missing.length} of {lookedUp.found.length + lookedUp.missing.length} not held:
          </span>{' '}
          <span className="select-text">{lookedUp.missing.join(', ')}</span>
        </p>
      )}

      <div className="min-h-80 flex-1 overflow-auto rounded-md ring-1 ring-subtle">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-surface-sunken text-left shadow-xs">
            <tr>
              {/* Which report a hit came from, when the search spans both. */}
              {everywhere && (
                <th className="whitespace-nowrap px-3 py-2 font-medium text-muted">Report</th>
              )}
              {COLUMNS.map(column => (
                <th
                  key={column.label}
                  className="whitespace-nowrap px-3 py-2 font-medium text-textSecondary"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visible.map(record => (
              <tr
                key={`${(record as BackupSearchHit).report ?? chosenReport}-${record.key}-${record.page}`}
                className="border-t border-hairline hover:bg-surface-hover"
              >
                {everywhere && (
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {(record as BackupSearchHit).report === 'forward' ? 'Forward' : 'Return'}
                  </td>
                )}
                {COLUMNS.map(column => (
                  <td
                    key={column.label}
                    className="whitespace-nowrap px-3 py-2 tabular-nums text-body"
                  >
                    <span className="select-text">{cellText(column.of(record))}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted">
            {looking
              ? 'Looking those numbers up…'
              : searching
                ? 'Looking through every month held…'
                : lookedUp?.error || answered?.error
                  ? 'Nothing was read — see above.'
                  : everywhere
                    ? 'No stored row carries that AWB or EAN, in either report.'
                  : loadingMonth
                    ? 'Reading what is held…'
                    : 'Nothing is held for this month yet.'}
          </p>
        )}
      </div>
    </Modal>
  )
}
