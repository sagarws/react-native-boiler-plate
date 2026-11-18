import { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import tableStyles from '@core/styles/table.module.css'
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { DateRangePicker, ROLLING_PRESETS } from '@renderer/components/ui/DateRangePicker'
import { Input } from '@renderer/components/ui/Input'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { pageWindow, rowMatches } from '@shared/constants/reportTable'
import { reportAccounts, reportPage } from '@renderer/services/masterDataReport.service'
import type { ReportAccount, ReportPage, ReportType } from '@shared/types/masterDataReport'
import {
  addPage,
  EMPTY_TALLY,
  formatBytes,
  jsonBytes,
  projectTotal,
  type DataSizeTally
} from '@shared/utils/dataSize'

/**
 * "Check master data" — AJIO's own reports, read live.
 *
 * The question behind most "why did this claim fail" investigations is what
 * AJIO actually holds for that window, and answering it meant leaving for the
 * seller portal. This is the portal's own View Reports screen, against the same
 * two endpoints, in front of the claims it explains.
 *
 * A READ, throughout. Nothing here writes to AJIO or to TrackVid, which is why
 * it needs no confirmation step and no review — unlike every other bulk tool on
 * this page.
 *
 * Two steps, because the two reports have nothing in common but their shape:
 * forward orders and returns carry different columns entirely, and a single
 * screen trying to show both would show neither well.
 */

/**
 * How many rows AJIO is asked for per page.
 *
 * A choice rather than a constant because the two ways this report gets read
 * want different answers: hunting one AWB wants a small page that comes back
 * fast, and eyeballing a month's returns wants as few page turns as possible.
 */
const PAGE_SIZES = [10, 50, 100, 150, 200] as const

// 100: the report is read by scanning, and fifty meant turning the page twice
// as often for no gain — AJIO answers a hundred rows just as quickly.
const DEFAULT_PAGE_SIZE = 100

/**
 * A whole calendar month, as the range picker holds it.
 *
 * Built field by field rather than through `toISOString()`: that converts to
 * UTC first, so east of Greenwich the 1st of a month becomes the last day of
 * the one before — which is how a "September" button quietly returns August.
 */
const monthRange = (year: number, month: number): { startDate: string; endDate: string } => {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()

  return {
    startDate: `${year}-${pad(month + 1)}-01`,
    endDate: `${year}-${pad(month + 1)}-${pad(lastDay)}`
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** This year and the four before it. */
const YEARS = Array.from({ length: 5 }, (_, index) => new Date().getFullYear() - index)

const REPORTS: { value: ReportType; label: string; blurb: string }[] = [
  {
    value: 'forward',
    label: 'Forward Report',
    blurb: 'Orders AJIO dispatched — PO, invoice, AWB, SLA and value.'
  },
  {
    value: 'return',
    label: 'Return Report',
    blurb: 'Returns AJIO raised — return AWB, status, QC, credit note.'
  }
]

/**
 * A cell's text.
 *
 * AJIO returns nulls throughout — half the fields on a return row are null
 * until QC runs — and they must read as absent rather than as the word "null".
 * A nested object gets its JSON rather than "[object Object]": these payloads
 * carry document references, and a row that silently rendered every one of them
 * identically would be worse than one that showed something ugly.
 */
const cell = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  try {
    return JSON.stringify(value) ?? '—'
  } catch {
    return '—'
  }
}

export const MasterDataModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [reportType, setReportType] = useState<ReportType | null>(null)
  const [accounts, setAccounts] = useState<ReportAccount[] | null>(null)
  const [username, setUsername] = useState('')
  /**
   * THIS MONTH, so the month row opens with one highlighted.
   *
   * A rolling 31-day window was the old default. It is the right shape for "what
   * has just come in" and the wrong one for the question this report is usually
   * opened with — reconciling a month — and it left every month button unlit,
   * which reads as "no month selected" rather than "a custom window".
   */
  const [range, setRange] = useState(() => {
    const today = new Date()

    return monthRange(today.getFullYear(), today.getMonth())
  })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  /**
   * The year the month buttons apply to. Not a range of its own — it only says
   * which January a press of "Jan" means.
   */
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  /**
   * How much disk this report would take as JSON, measured a page at a time.
   *
   * Kept while the dialog is open so an operator can page through and build a
   * sample: pressing Record size on page 1 and again on page 7 counts both. The
   * same page twice counts once — the tally remembers which pages it holds, so
   * paging back and forth cannot inflate the answer it is consulted for.
   */
  const [tally, setTally] = useState<DataSizeTally>(EMPTY_TALLY)
  const [result, setResult] = useState<ReportPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  /** POBs the operator narrowed to. Empty means all of this account's. */
  const [pobIds, setPobIds] = useState<string[]>([])
  // The button the POB list hangs from; null while it is closed.
  const [pobAnchor, setPobAnchor] = useState<HTMLElement | null>(null)
  /**
   * Filters the PAGE in hand, not the report. AJIO's endpoints take no search
   * term, so a box that claimed to search two hundred pages would be lying —
   * the count beside it says which it is.
   */
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void reportAccounts().then(response => {
      if (cancelled || !response.success) return

      setAccounts(response.data)

      // Pre-picked when there is only one, and otherwise when one account is
      // the only one that CAN be reported on — the rest need Sync POBs first.
      const usable = response.data.filter(account => account.pobCount > 0)

      if (usable.length === 1) setUsername(usable[0]?.username ?? '')
    })

    return () => {
      cancelled = true
    }
  }, [open])

  /**
   * What is being asked for, as one value.
   *
   * `loading` is DERIVED from it — the query in hand versus the query last
   * answered — rather than stored. A stored flag would have to be raised
   * synchronously inside the effect that fetches, which re-renders before the
   * request has even left; and the two would then be two sources of truth for
   * one fact, which is how a spinner gets stranded after a failed page turn.
   *
   * `nonce` is what Reload changes, since re-asking the same question is
   * otherwise indistinguishable from not asking at all.
   */
  const query = useMemo(
    () => ({
      reportType,
      username,
      from: range.startDate,
      to: range.endDate,
      page,
      pageSize,
      nonce,
      pobIds: pobIds.join(',')
    }),
    [reportType, username, range.startDate, range.endDate, page, pageSize, nonce, pobIds]
  )

  /**
   * The sample belongs to ONE query. A different month, account or POB set is a
   * different body of data, so carrying the bytes across would answer a
   * question about rows nobody measured.
   */
  const sample = `${reportType}|${username}|${range.startDate}|${range.endDate}|${pobIds.join(',')}`
  const [sampledFor, setSampledFor] = useState(sample)

  if (sampledFor !== sample) {
    setSampledFor(sample)
    setTally(EMPTY_TALLY)
  }

  const [settled, setSettled] = useState<typeof query | null>(null)
  const loading = reportType !== null && username !== '' && settled !== query

  useEffect(() => {
    if (!query.reportType || !query.username) return undefined

    let cancelled = false

    void reportPage({
      reportType: query.reportType,
      username: query.username,
      from: query.from,
      to: query.to,
      page: query.page,
      size: query.pageSize,
      pobIds: query.pobIds ? query.pobIds.split(',') : []
    }).then(response => {
      if (cancelled) return

      if (response.success) {
        setResult(response.data)
        setError(null)
      } else {
        // The rows stay on screen. A failed page-turn should not blank the page
        // that was working, and AJIO's own message says what to do.
        setError(response.error.message)
      }

      // Settled LAST, and with the query object this run was started for — so a
      // slower earlier answer cannot mark a newer question as answered.
      setSettled(query)
    })

    return () => {
      cancelled = true
    }
  }, [query])

  const reload = useCallback(() => setNonce(current => current + 1), [])

  const back = (): void => {
    setReportType(null)
    setResult(null)
    setError(null)
    setPage(0)
    setSearch('')
  }

  const account = accounts?.find(entry => entry.username === username)
  const allPobs = account?.pobIds ?? []
  const activePobs = pobIds.length > 0 ? pobIds : allPobs

  const togglePob = (id: string): void =>
    setPobIds(current => {
      // An empty selection means "all", so narrowing from all starts by
      // materialising the full list and removing one — otherwise the first
      // click would read as "none".
      const base = current.length > 0 ? current : allPobs
      const next = base.includes(id)
        ? base.filter(entry => entry !== id)
        : [...base, id]

      setPage(0)

      // Back to everything: stored as empty so a later Sync that adds a POB is
      // picked up rather than frozen out by a stale list.
      return next.length === allPobs.length ? [] : next
    })

  /** The rows actually shown — the page, narrowed by what was typed. */
  const visible = (result?.rows ?? []).filter(row =>
    rowMatches(row, result?.columns ?? [], search)
  )

  const chosen = REPORTS.find(report => report.value === reportType)
  const totalPages = result?.totalPages ?? 0
  /**
   * AJIO reports pages, not a row count, so the report's size is projected from
   * pages × page size. An over-estimate by less than one page, and the only
   * total available.
   */
  const estimate = projectTotal(tally, totalPages * pageSize)
  const counted = tally.pages.includes(`${sample}|${page}|${pageSize}`)

  /**
   * What this window would cost as JSON, without anyone pressing anything.
   *
   * The page in hand IS a sample: rows × pages gives the window's size, and the
   * page has already been fetched, so the estimate costs nothing. Record size
   * still earns its place — pressing it on several pages averages over a wider
   * sample, and this one row may not be typical.
   *
   * Measured from the ROWS, so it tracks the page size the operator chose: at
   * 10 rows a page the sample is thinner and the projection cruder, which is
   * true and worth it being visible.
   */
  const windowEstimate = useMemo(() => {
    if (!result || result.rows.length === 0 || totalPages === 0) return null

    const perRow = jsonBytes(result.rows) / result.rows.length
    const rows = totalPages * pageSize

    return { bytes: Math.round(perRow * rows), rows }
  }, [result, totalPages, pageSize])

  return (
    <Modal
      size={reportType ? 'xl' : 'md'}
      fill={reportType !== null}
      open={open}
      title={chosen ? `Check master data · ${chosen.label}` : 'Check master data'}
      description={
        chosen
          ? `Read live from AJIO for ${result ? `${result.pobCount} place(s) of business` : 'this account'}. Nothing is written.`
          : 'AJIO’s own reports, read live from the seller portal.'
      }
      onClose={onClose}
      headerActions={
        reportType ? (
          <IconButton
            size="small"
            type="button"
            onClick={back}
            aria-label="Choose another report"
            title="Choose another report"
          >
            <i className="tabler-arrow-left text-lg" />
          </IconButton>
        ) : null
      }
      toolbar={
        reportType ? (
          // Two rows: the query (account, window, POBs, filter), and the month
          // shortcuts under it. One row would wrap into two anyway, in an order
          // nobody chose.
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
            {(accounts?.length ?? 0) > 1 && (
              <Select
                aria-label="AJIO account"
                size="sm"
                className="w-56"
                value={username}
                onChange={event => {
                  setUsername(event.target.value)
                  // A selection made for another account means nothing here.
                  setPobIds([])
                  setPage(0)
                }}
                options={[
                  { value: '', label: 'Choose an account…' },
                  ...(accounts ?? []).map(account => ({
                    value: account.username,
                    // The POB count is why an account may not work, said here
                    // rather than only in the error it would produce.
                    label:
                      account.pobCount > 0
                        ? `${account.username} (${account.pobCount} POBs)`
                        : `${account.username} — no POBs synced`
                  }))
                ]}
              />
            )}

            {/* Anchored LEFT: it sits at the left of a very wide dialog, and a
                right-anchored panel would extend off that edge. */}
            <DateRangePicker
              align="left"
              size="sm"
              // Rolling windows rather than calendar periods: AJIO's reports are
              // read as "the last N days", and a Sunday-to-Saturday "This Week"
              // is the wrong shape for that question.
              presets={ROLLING_PRESETS}
              className="shrink-0"
              value={range}
              onChange={next => {
                setRange(next)
                setPage(0)
              }}
            />

            {allPobs.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<i className="tabler-filter text-base" />}
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(pobAnchor)}
                  onClick={event => setPobAnchor(pobAnchor ? null : event.currentTarget)}
                >
                  POBs ({activePobs.length}/{allPobs.length})
                </Button>

                {/* A Popover rather than a positioned span: this sits inside
                    the dialog's scrolling body, which clipped an absolutely
                    positioned panel. The Popover renders above the dialog and
                    handles click-away and Escape itself. */}
                <Popover
                  open={Boolean(pobAnchor)}
                  anchorEl={pobAnchor}
                  onClose={() => setPobAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                  slotProps={{ paper: { className: 'mbs-1 w-64 p-2' } }}
                >
                  <div className="mbe-1 flex items-center justify-between pli-1">
                    <Typography variant="subtitle2" color="text.primary" className="font-semibold">
                      Places of business
                    </Typography>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => {
                        setPobIds([])
                        setPage(0)
                      }}
                    >
                      All
                    </Button>
                  </div>

                  <div className="max-h-56 overflow-y-auto">
                    {allPobs.map(id => (
                      <div key={id} className="pli-1">
                        <Checkbox
                          label={<span className="font-mono">{id}</span>}
                          checked={activePobs.includes(id)}
                          onChange={() => togglePob(id)}
                        />
                      </div>
                    ))}
                  </div>
                </Popover>
              </>
            )}

            <Input
              aria-label="Filter this page"
              size="sm"
              className="w-64"
              placeholder="Filter this page — AWB, order no, SKU…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />

            <Button
              variant="secondary"
              size="sm"
              icon={<i className="tabler-refresh text-base" />}
              loading={loading}
              disabled={!username}
              onClick={reload}
            >
              Reload
            </Button>

            {/* Pushed right: it answers a question about the report as a whole,
                not about what is being asked for. */}
            <span className="ms-auto flex items-center gap-2">
              {tally.rows > 0 && (
                <Typography variant="caption" color="text.secondary" className="tabular-nums">
                  <span className="font-semibold text-textPrimary">{formatBytes(tally.bytes)}</span>
                  {' over '}
                  {tally.rows} row{tally.rows === 1 ? '' : 's'}
                  {/* The projection is the reason to press it at all: "can this
                      report live on this machine as JSON". Stated as an
                      estimate, because it is one — the average of what was
                      actually measured, applied to the rest. */}
                  {estimate !== null && (
                    <>
                      {' · whole report ≈ '}
                      <span className="font-semibold text-textPrimary">{formatBytes(estimate)}</span>
                    </>
                  )}
                </Typography>
              )}

              {tally.rows > 0 && (
                <Button variant="ghost" size="sm" type="button" onClick={() => setTally(EMPTY_TALLY)}>
                  Reset
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                icon={<i className="tabler-database text-base" />}
                disabled={!result || result.rows.length === 0}
                onClick={() => {
                  if (!result) return

                  setTally(current => addPage(current, `${sample}|${page}|${pageSize}`, result.rows))
                }}
              >
                {counted ? 'Page counted' : 'Record size'}
              </Button>
            </span>
            </div>

            {/* WHOLE MONTHS, beside the rolling picker rather than inside it.
                The picker answers "the last N days", which is how the report is
                read day to day; reconciliation asks for August, and rebuilding
                that from a calendar twice a month is the small friction that
                ends in the wrong dates. Pressing a month sets the range and
                fetches — there is nothing else to confirm. */}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Year"
                // `size="sm"` rather than a className height: the default size
                // carries `w-full`, which is what stretched this across the
                // dialog instead of sitting beside Jan.
                size="sm"
                className="w-18"
                value={String(year)}
                onChange={event => setYear(Number(event.target.value))}
                options={YEARS.map(value => ({ value: String(value), label: String(value) }))}
              />

              {MONTHS.map((label, index) => {
                const month = monthRange(year, index)
                const active =
                  range.startDate === month.startDate && range.endDate === month.endDate
                // A month that has not begun has nothing to report.
                const future = new Date(year, index, 1) > new Date()

                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={active ? 'primary' : 'secondary'}
                    aria-pressed={active}
                    className="min-is-0"
                    disabled={future || loading || !username}
                    onClick={() => {
                      setRange(month)
                      setPage(0)
                    }}
                  >
                    {label}
                  </Button>
                )
              })}

              {/* The month's size, beside the month buttons because that is what
                  it is about. An ESTIMATE, and labelled one: it is this page's
                  average row across every page AJIO says the window has. */}
              {windowEstimate && (
                <Typography variant="caption" color="text.secondary" className="ms-auto tabular-nums">
                  ≈ <span className="font-semibold text-textPrimary">{formatBytes(windowEstimate.bytes)}</span>
                  {' as JSON · ~'}
                  {windowEstimate.rows.toLocaleString()} rows
                  {/* Where the sample came from, so a surprising number can be
                      judged rather than just believed. */}
                  <span className="text-textDisabled">
                    {' '}
                    (from {result?.rows.length ?? 0} rows on this page)
                  </span>
                </Typography>
              )}
            </div>
          </div>
        ) : null
      }
      footer={
        reportType ? (
          <div className="flex is-full items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Typography variant="caption" color="text.secondary" className="tabular-nums">
                {result
                  ? search
                    ? // Both counts, because the filter acts on the page only.
                      // "12 rows" alone would read as the report having twelve.
                      `${visible.length} of ${result.rows.length} on this page`
                    : `${result.rows.length} row(s) on this page`
                  : ''}
              </Typography>

              <Select
                aria-label="Rows per page"
                size="sm"
                className="w-18"
                value={String(pageSize)}
                onChange={event => {
                  setPageSize(Number(event.target.value))
                  // Page 3 of fifty-row pages is not page 3 of two-hundred-row
                  // pages, so a changed size sends the reader back to the start
                  // rather than to a page that now means something else.
                  setPage(0)
                }}
                options={PAGE_SIZES.map(size => ({ value: String(size), label: String(size) }))}
              />
            </span>

            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<i className="tabler-chevron-left text-base" />}
                disabled={page === 0 || loading}
                onClick={() => setPage(current => Math.max(0, current - 1))}
              >
                Previous
              </Button>

              {/* Numbers, because Previous/Next alone cannot reach page 137 of
                  two hundred. The window keeps a constant width so the buttons
                  do not move under the cursor while paging. */}
              {pageWindow(page + 1, totalPages).map((token, index) =>
                token === 'gap' ? (
                  <Typography key={`gap-${index}`} variant="caption" color="text.disabled" className="pli-1">
                    …
                  </Typography>
                ) : (
                  <Button
                    key={token}
                    type="button"
                    size="sm"
                    variant={token === page + 1 ? 'primary' : 'secondary'}
                    aria-current={token === page + 1 ? 'page' : undefined}
                    className="min-w-8 tabular-nums"
                    disabled={loading}
                    onClick={() => setPage(token - 1)}
                  >
                    {token}
                  </Button>
                )
              )}

              <Button
                variant="secondary"
                size="sm"
                icon={<i className="tabler-chevron-right text-base" />}
                disabled={loading || totalPages === 0 || page >= totalPages - 1}
                onClick={() => setPage(current => current + 1)}
              >
                Next
              </Button>
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </span>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )
      }
    >
      {!reportType && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {REPORTS.map(report => (
            <li key={report.value}>
              <Card variant="outlined">
                <CardActionArea
                  onClick={() => {
                    setReportType(report.value)
                    setPage(0)
                  }}
                  className="flex items-start justify-start gap-3 p-3 text-start"
                >
                  <i className="tabler-package text-base shrink-0 mt-0.5 text-textSecondary" aria-hidden="true" />
                  <span className="flex flex-col gap-1">
                    <Typography variant="body2" color="text.primary" className="font-medium">
                      {report.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {report.blurb}
                    </Typography>
                  </span>
                </CardActionArea>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {reportType && (
        <div className="flex min-bs-0 flex-1 flex-col gap-3">
          {error && <Alert severity="error">{error}</Alert>}

          {!username && (
            <Alert severity="info" icon={<i className="tabler-info-circle text-base" />}>
              Choose an AJIO account to read the report from.
            </Alert>
          )}

          {loading && !result && (
            <Typography
              variant="body2"
              color="text.secondary"
              className="flex min-h-96 items-center gap-2 plb-6"
            >
              <CircularProgress size={16} color="inherit" />
              Reading the report from AJIO — this opens a seller login, so give it a moment.
            </Typography>
          )}

          {result && (
            // THE one scroll container: both axes, so the horizontal bar sits
            // at the bottom of the visible area rather than below the fold, and
            // the sticky header stays put while the rows move under it.
            //
            // `min-h-96` is a floor so the dialog does not jump between
            // tall and tiny as pages load — a pager that resizes the window
            // under the cursor moves Next away from the pointer about to press
            // it again.
            <Paper variant="outlined" className="min-h-96 flex-1 overflow-auto">
              <table className={tableStyles.table}>
                {/* `z-10` and an opaque background: rows scrolling under a
                    sticky header paint over it without both. The background is
                    repeated on each cell because a `thead` background does not
                    reliably paint under a sticky `th` with `border-collapse`. */}
                <thead className="sticky top-0 z-10 bg-backgroundPaper">
                  <tr>
                    {/* Counted across the whole report, not within the page: the
                        question it answers is "how far into 4,100 rows am I",
                        and a column restarting at 1 on every page answers a
                        question nobody asked. */}
                    <th className="w-12 bg-backgroundPaper text-end">#</th>
                    {result.columns.map(column => (
                      <th key={column.key} className="bg-backgroundPaper">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {visible.map((row, index) => (
                    <tr
                      // AJIO's own opaque row id when it has one; the index
                      // otherwise. Guarded rather than coerced: a row whose id
                      // is an object would stringify to "[object Object]" and
                      // give every such row the same key.
                      key={typeof row.id === 'string' && row.id ? row.id : `row-${index}`}
                      className="hover:bg-actionHover"
                    >
                      <td className="text-end tabular-nums text-textDisabled">
                        {page * pageSize + index + 1}
                      </td>
                      {result.columns.map(column => (
                        <td key={column.key}>
                          {/* Selectable: an AWB or an order number is here to be
                              copied into a claim or a search. */}
                          <span className="select-text">{cell(row[column.key])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {visible.length === 0 && (
                <Typography variant="body2" color="text.secondary" className="plb-6 pli-3 text-center">
                  {result.rows.length === 0
                    ? 'AJIO returned nothing for this window.'
                    : // The rows exist; the filter hid them. Said differently,
                      // because the two call for opposite next actions.
                      `Nothing on this page matches “${search}”. Try another page.`}
                </Typography>
              )}
            </Paper>
          )}
        </div>
      )}
    </Modal>
  )
}
