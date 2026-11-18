import { useEffect, useMemo, useState } from 'react'
import { RE_CLAIM_BATCH_SIZE } from '@shared/constants/reClaim'
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import CustomChip from '@core/components/mui/Chip'
import CustomTextField from '@core/components/mui/TextField'
import tableStyles from '@core/styles/table.module.css'
import { Badge } from '@renderer/components/ui/Badge'
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import {
  chooseReClaimSheet,
  downloadReClaimTemplate,
  manualReClaimRows,
  onReClaimProgress,
  reClaimAccounts,
  reClaimProgress,
  reClaimTicket,
  startBulkReClaim,
  stopReClaim,
  submitReClaim
} from '@renderer/services/reClaim.service'
import type {
  ReClaimProgress,
  ReClaimResult,
  ReClaimRow,
  ReClaimSheet
} from '@shared/types/reClaim'
import { rowMatches } from '@shared/constants/reportTable'
import { ReClaimTicketModal, type TicketView } from './ReClaimTicketModal'
import { SessionGateModal } from './SessionGateModal'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { useSessionGate } from '@renderer/hooks/useSessionGate'
import { classNames } from '@renderer/utils/format'

/**
 * Re-claim — working down a rejection export, disputing one ticket at a time.
 *
 * A rejected SPF claim can be reopened with an argument and the same proofs,
 * and Myntra re-validates it. What the operator brings is the export; what each
 * row needs is a sentence explaining why the rejection was wrong.
 *
 * SENT ONE AT A TIME, whether one row or a hundred were chosen. Each dispute is
 * an argument a person is making — the description is the whole substance of it,
 * and a ticket's reopen is spent the moment it is sent.
 *
 * So the bulk path is built around the operator having chosen: nothing is
 * pre-ticked, the count is on the button, the sentence they are about to send
 * to every one of them is quoted back in a confirmation, and the run can be
 * stopped mid-way. What it does NOT do is invent a per-ticket argument — every
 * selected ticket gets the same description, which is the operator's call to
 * make and the reason they are shown it before it goes.
 *
 * The sheet is shown as the operator's own: the columns this app knows are laid
 * out first, and anything else they exported is still there to read.
 */

/**
 * The three columns a dispute is built from, in the order the template has them.
 * Always shown, because a blank one is the reason a row cannot be sent.
 */
const BASE_COLUMNS = [
  { key: 'ticketId', label: 'Ticket' },
  { key: 'RR Remarks', label: 'Remarks — sent as the dispute' },
  { key: 'issueCategory', label: 'Issue category' }
]

/**
 * Columns Myntra's own export carries. Shown only when the sheet actually has
 * them, so a file straight off the portal reads as richly as it always did
 * while a three-column template does not get five headers over empty cells.
 */
const EXPORT_COLUMNS = [
  { key: 'status', label: 'Status' },
  { key: 'rejectionReason', label: 'Rejection reason' },
  { key: 'createdOn', label: 'Created' },
  { key: 'rejectedOn', label: 'Rejected' },
  { key: 'closedOn', label: 'Closed' }
]

/** One row as it is being typed. Mirrors the template's three columns. */
interface ManualRow {
  ticketId: string
  description: string
  issueCategory: string
}

/** Whether any row actually has something under this header. */
const anyValue = (rows: ReClaimRow[], key: string): boolean =>
  rows.some(row => {
    const value = row.raw[key]

    // A cell is whatever the spreadsheet held, so only the primitives it can
    // actually produce count as a value — an object would stringify to
    // "[object Object]" and make an empty column look populated.
    if (typeof value === 'string') return value.trim().length > 0

    return typeof value === 'number' || typeof value === 'boolean'
  })

const columnsFor = (rows: ReClaimRow[]): typeof BASE_COLUMNS => [
  ...BASE_COLUMNS,
  ...EXPORT_COLUMNS.filter(column => anyValue(rows, column.key))
]

/**
 * The opening argument, which the operator edits before sending.
 *
 * Pre-filled because most disputes on one export say the same thing, and a
 * blank box on every row is how a sentence ends up copy-pasted from the last
 * one without being read. It is theirs to rewrite.
 */
const DEFAULT_DESCRIPTION =
  'Please recheck this claim. The rejection reason does not match the evidence attached to ' +
  'the ticket, and the supporting images and video were provided at the time of filing.'

const cell = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return '—'
}

export const ReClaimModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const toast = useToast()
  const { gate, closeGate, ensureLiveSessions, recheckGate } = useSessionGate()
  const [sheet, setSheet] = useState<ReClaimSheet | null>(null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [username, setUsername] = useState('')
  const [search, setSearch] = useState('')
  /**
   * A range of row numbers to tick at once.
   *
   * Ticking 300 of 751 boxes by hand is not work anybody does — they give up
   * and run the lot. The numbers shown in the `#` column are what these mean,
   * so "120 to 300" is read straight off the table.
   */
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION)
  /**
   * Rows being typed in, or null when the operator has not asked for that.
   *
   * A sheet is the normal way in, but an operator disputing four tickets off a
   * message should not have to build a spreadsheet to do it. These become a
   * `ReClaimSheet` — through the same validation the file goes through — so
   * everything downstream cannot tell the difference and does not need to.
   */
  const [typed, setTyped] = useState<ManualRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** Ticket ids ticked for the bulk run. Never pre-filled. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** Progress of the bulk run, and the only thing that says one is going. */
  /**
   * The paced run, pushed from the main process.
   *
   * Not local state: the run outlives this window, so a modal reopened
   * mid-sheet has to be able to ask where it got to.
   */
  const [run, setRun] = useState<ReClaimProgress | null>(null)
  const bulk = run?.running === true ? run : null
  const [confirming, setConfirming] = useState(false)
  /** Ticket id → what happened, so a row shows its own outcome. */
  const [results, setResults] = useState<Record<string, ReClaimResult>>({})
  /**
   * Ticket id → Myntra's own status for it, as each dispute lands.
   *
   * Beside the results rather than inside them: mid-run a row has a verdict but
   * no ticket read to hang it on, and inventing a half-empty ticket to carry
   * one status would put a fabricated record in front of anyone who then opened
   * the row. When the run ends the full results arrive with the real ticket and
   * this is simply no longer the one being read.
   */
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  /**
   * The ticket whose detail is open in the child window.
   *
   * One piece of state for both ways in — the eye beside a ticket id, and the
   * end of a dispute. They differ only in whether anything was sent first,
   * which is what `outcome` records.
   */
  const [detail, setDetail] = useState<TicketView | null>(null)

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void reClaimAccounts().then(response => {
      if (cancelled || !response.success) return

      setAccounts(response.data)
      // Pre-picked when there is only one: naming an account is a decision only
      // where there is one to make.
      if (response.data.length === 1) setUsername(response.data[0] ?? '')
    })

    void reClaimProgress().then(response => {
      if (!cancelled && response.success) setRun(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(
    () =>
      onReClaimProgress(next => {
        setRun(next)

        // Each ticket's outcome as it lands, so its row fills in while the run
        // carries on. Over an hour-long sheet, rows that only updated at the
        // end would leave an operator watching a bar and nothing else.
        if (next.last) {
          const done = next.last
          const status = done.status

          if (status) {
            setStatuses(current =>
              current[done.ticketId] === status ? current : { ...current, [done.ticketId]: status }
            )
          }

          // Overwritten, not skipped when the row already has one: a ticket
          // disputed again is a NEW outcome, and keeping the first would leave
          // the row showing a verdict the run has since replaced.
          setResults(current => ({
            ...current,
            [done.ticketId]: {
              ticketId: done.ticketId,
              ok: done.ok,
              message: done.message,
              // Filled in by the full result when the run ends; the row's pill
              // reads its status out of `statuses` until then.
              ticket: null,
              payload: null,
              error: done.ok ? null : done.message
            }
          }))
        }
      }),
    []
  )

  /**
   * Every sheet row with its position, 1-based.
   *
   * Numbered from the SHEET's order, not the filtered view: the number is what
   * the range box refers to, and one that renumbered itself as an operator
   * typed in the filter would select something different each time.
   */
  const numbered = useMemo(
    () => (sheet?.rows ?? []).map((row, index) => ({ ...row, index: index + 1 })),
    [sheet]
  )

  /** What this particular sheet has — see columnsFor. */
  const columns = useMemo(() => columnsFor(sheet?.rows ?? []), [sheet])

  const rows = useMemo(
    () => numbered.filter(row => rowMatches(row.raw, columns, search)),
    [numbered, columns, search]
  )

  /*
   * A PAGE AT A TIME, because the table was the thing that hung.
   *
   * A 3,003-row export drew 3,003 rows, each with a button, a checkbox and a
   * cell per column, and then re-rendered the lot on every progress tick — one
   * every five seconds for four hours. The run was never the problem; it has
   * always been one ticket at a time with a pause between them.
   *
   * Fifty is the run's batch size, so a page and a batch are the same unit and
   * the progress line can name one number that means both.
   */
  const pageCount = Math.max(1, Math.ceil(rows.length / RE_CLAIM_BATCH_SIZE))

  /*
   * THE PAGE IS DERIVED, NOT STORED, and that is what makes the run able to
   * drive it without fighting the operator.
   *
   * Written as two effects first — one resetting the page when the filter
   * changed, one jumping to the running ticket — and both were a `setState`
   * inside an effect, which is a cascading render and which this repo's lint
   * rules reject outright. They were also the wrong shape: an effect that
   * forces the page to follow the run leaves Previous and Next looking broken,
   * because every press is immediately overwritten.
   *
   * So: the page follows the ticket in flight UNLESS the operator has picked
   * one during this run. The pick carries the filter and the job it was made
   * under, so it lapses by itself — a new filter, or a new run, and the page
   * goes back to following rather than sitting where somebody left it an hour
   * ago.
   */
  const [picked, setPicked] = useState<{
    search: string
    jobId: string | null
    page: number
  } | null>(null)

  const runningJob = bulk?.jobId ?? null

  // Where the run has got to, in the rows actually on screen. Found by ticket
  // rather than by the run's batch number: batches are cut from the SELECTED
  // tickets and pages from the filtered rows, so the two only line up when
  // everything is ticked. The ticket is right either way.
  const runningAt = bulk?.ticketId ? rows.findIndex(row => row.ticketId === bulk.ticketId) : -1

  const following = picked === null || picked.search !== search || picked.jobId !== runningJob

  const current = Math.min(
    following
      ? runningAt >= 0
        ? Math.floor(runningAt / RE_CLAIM_BATCH_SIZE) + 1
        : 1
      : (picked?.page ?? 1),
    pageCount
  )

  const setPage = (next: number): void => {
    setPicked({ search, jobId: runningJob, page: Math.min(Math.max(1, next), pageCount) })
  }

  const pageRows = useMemo(
    () => rows.slice((current - 1) * RE_CLAIM_BATCH_SIZE, current * RE_CLAIM_BATCH_SIZE),
    [rows, current]
  )

  /**
   * Whether every ticked row has something to argue with.
   *
   * A row's own remarks, or the shared box for the rows that left the column
   * blank. Checked here rather than letting the run drop them: a silently
   * shorter run is the failure mode where an operator believes forty disputes
   * went out and thirty-one did.
   */
  const bulkReady = useMemo(() => {
    const chosen = numbered.filter(row => selected.has(row.ticketId))

    if (chosen.length === 0) return false

    return chosen.every(row => row.description.trim() || description.trim())
  }, [numbered, selected, description])

  /** Ticks every row whose `#` falls inside the range, ignoring the filter. */
  const selectRange = (): void => {
    const start = Number(from)
    const end = Number(to)

    if (!Number.isFinite(start) || !Number.isFinite(end)) return

    const low = Math.min(start, end)
    const high = Math.max(start, end)

    setSelected(current => {
      const next = new Set(current)

      for (const row of numbered) {
        // ADDED to what is already ticked, never replacing it: an operator
        // building a selection out of two ranges should not lose the first.
        if (row.ticketId && row.index >= low && row.index <= high) next.add(row.ticketId)
      }

      return next
    })
  }

  /**
   * What "select all" means: the rows in front of them.
   *
   * Filtered-out rows keep whatever tick they already had — a filter is a way
   * of finding rows, not of discarding a selection someone built up across
   * several searches — but the header box answers for the visible ones only,
   * because that is what it appears to be offering.
   */
  const visibleIds = useMemo(
    () => [...new Set(pageRows.filter(row => row.ticketId).map(row => row.ticketId))],
    [pageRows]
  )

  /**
   * Every row the filter matches, across all pages.
   *
   * SEPARATE FROM THE HEADER BOX ON PURPOSE. That box answers for the rows in
   * front of the operator, which is now a page — and a box that silently ticked
   * three thousand rows because fifty were on screen is the kind of thing
   * somebody finds out about an hour into a run. Selecting the rest is a second,
   * deliberate press, offered only once the page is fully ticked.
   */
  const matchingIds = useMemo(
    () => [...new Set(rows.filter(row => row.ticketId).map(row => row.ticketId))],
    [rows]
  )

  const allMatchingSelected =
    matchingIds.length > 0 && matchingIds.every(id => selected.has(id))

  const selectEveryMatch = (): void =>
    setSelected(current => {
      const next = new Set(current)

      matchingIds.forEach(id => next.add(id))

      return next
    })
  const visibleSelected = visibleIds.filter(id => selected.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && visibleSelected === visibleIds.length

  const toggleRow = (ticketId: string): void =>
    setSelected(current => {
      const next = new Set(current)

      if (!next.delete(ticketId)) next.add(ticketId)

      return next
    })

  const toggleVisible = (): void =>
    setSelected(current => {
      const next = new Set(current)

      // One box, both jobs: ticked or part-ticked clears what is on screen,
      // empty selects it. Anything hidden by the filter is left alone.
      if (allVisibleSelected || visibleSelected > 0) visibleIds.forEach(id => next.delete(id))
      else visibleIds.forEach(id => next.add(id))

      return next
    })

  /**
   * Saves the blank export.
   *
   * For the operator working from a ticket list that never came out of Myntra's
   * export — an email, a message, a note — who otherwise has to guess that the
   * one column that matters is spelled `ticketId`.
   */
  const template = async (): Promise<void> => {
    const response = await downloadReClaimTemplate()

    if (response.success) toast.success('Template saved')
    // Closing the save dialog is not a failure worth a toast.
    else if (response.error.message !== 'Cancelled') toast.error(response.error.message)
  }

  /** Starts the by-hand form with one blank row. */
  const startTyping = (): void =>
    // The boilerplate, prefilled: it is what the sheet-wide box has always
    // offered, and a row whose remarks are blank cannot be sent — so an empty
    // field would be a form that is invalid the moment it opens.
    setTyped([{ ticketId: '', description: DEFAULT_DESCRIPTION, issueCategory: '' }])

  const setTypedRow = (index: number, patch: Partial<ManualRow>): void =>
    setTyped(current =>
      (current ?? []).map((row, position) => (position === index ? { ...row, ...patch } : row))
    )

  /**
   * Turns the typed rows into a sheet.
   *
   * Validated in the MAIN process, not here: it is the same boundary the file
   * crosses and the same two rules — a ticket id and remarks, category
   * optional. Checking it in the window as well would be a second definition of
   * a valid row, and the two would drift.
   */
  const applyTyped = async (): Promise<void> => {
    const response = await manualReClaimRows(typed ?? [])

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setSheet(response.data)
    setTyped(null)
    setResults({})
    setStatuses({})
    setSelected(new Set())
  }

  const upload = async (): Promise<void> => {
    const response = await chooseReClaimSheet()

    if (!response.success) {
      // Cancelling the file dialog is not an error worth a toast.
      if (response.error.message !== 'No file chosen') toast.error(response.error.message)

      return
    }

    setSheet(response.data)
    setResults({})
    setStatuses({})
    setSelected(new Set())

    if (response.data.missing.length > 0) {
      toast.error(`The sheet has no ${response.data.missing.join(', ')} column — rows may be thin`)
    }
  }

  /**
   * One dispute, recorded on its row. The single place a re-claim is sent.
   *
   * Returns whether it was raised so the bulk run can count, and reports the
   * transport failure itself so neither caller has to — but says nothing about
   * a dispute Myntra REFUSED, because that is an outcome the row now carries
   * and a caller may want to say differently.
   */
  const send = async (
    ticketId: string,
    issueCategory: string,
    /** The row's own remarks. The box below the table is the fallback. */
    remarks: string
  ): Promise<ReClaimResult | null> => {
    setBusy(ticketId)

    const response = await submitReClaim({
      ticketId,
      description: remarks.trim() || description,
      issueCategory,
      username
    })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return null
    }

    setResults(current => ({ ...current, [ticketId]: response.data }))

    return response.data
  }

  const dispute = async (
    ticketId: string,
    issueCategory: string,
    remarks: string
  ): Promise<void> => {
    const result = await send(ticketId, issueCategory, remarks)

    if (!result) return

    // Straight into the detail: what Myntra now says about the ticket is the
    // answer, and "dispute raised" on its own is not.
    setDetail({
      ticketId,
      ticket: result.ticket,
      loading: false,
      outcome: { ok: result.ok, message: result.message },
      payload: result.payload,
      error: result.error
    })

    // Not toasted. The window carries the message, the payload and Myntra's
    // own answer — and a toast would be reporting a failure from behind the
    // modal that caused it.
  }

  /**
   * The selected tickets, disputed one after another.
   *
   * SEQUENTIAL on purpose. Each dispute is a login-bound conversation with
   * Myntra — read the ticket, reopen it, read it back — and firing several at
   * once shares one session between them; the rate limit that follows would
   * cost tickets their reopen for a speed nobody asked for.
   *
   * The detail window is not opened per ticket either: over a run of hundreds
   * it would be a window fighting the operator for the screen. Rows fill in
   * behind the progress line, and every one keeps its own outcome to open.
   */
  const runBulk = async (): Promise<void> => {
    setConfirming(false)

    // Row order, not tick order: an operator scanning afterwards reads down
    // the sheet, and a run that jumps about is impossible to follow.
    const queue = (sheet?.rows ?? [])
      .filter(
        (row, index, all) =>
          row.ticketId &&
          selected.has(row.ticketId) &&
          all.findIndex(other => other.ticketId === row.ticketId) === index
      )
      .map(row => ({
        ticketId: row.ticketId,
        // THE ROW'S OWN ARGUMENT. Each row carries its remarks, so a sheet can
        // say something different about every ticket — which is what an
        // operator disputing forty rejections for forty reasons actually needs.
        // The box below is the fallback for a row that left the column blank.
        description: row.description || description,
        issueCategory: row.issueCategory
      }))

    // RUN IN THE MAIN PROCESS, not in this loop.
    //
    // The calls are spaced out — see BASE_GAP_MS — so several hundred tickets
    // is hours, and a loop living in this window would die the moment it was
    // closed, halfway through a sheet, with no record of where it got to.
    // Progress arrives on re-claim:progress instead.
    //
    // STARTED, not awaited. The job is the main process's from here: this
    // window can be closed, and the outcome is on the Jobs page whether it is
    // open or not. Rows still fill in as they land, from the same ticks.
    const response = await startBulkReClaim({
      tickets: queue,
      username,
      source: sheet?.source ?? 'file',
      fileName: sheet?.path ?? null
    })

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    toast.success(
      `Disputing ${queue.length} ticket${queue.length === 1 ? '' : 's'} — it carries on if you ` +
        'close this window, and the result is on the Jobs page.'
    )
  }

  /**
   * Just look — no dispute, nothing sent.
   *
   * The same read the dispute opens with, offered on its own because most of
   * what an operator needs before arguing a rejection is on the ticket:
   * `validationReason` says WHY it was refused, and that decides whether it is
   * worth reopening at all.
   */
  const view = async (ticketId: string): Promise<void> => {
    setDetail({ ticketId, ticket: null, loading: true, outcome: null })

    const response = await reClaimTicket(ticketId, username)

    if (!response.success) {
      setDetail(null)
      toast.error(response.error.message)

      return
    }

    // Guarded on the id: a slow read for a ticket the operator has already
    // moved on from must not replace what they are looking at now.
    setDetail(current =>
      current?.ticketId === ticketId ? { ...current, ticket: response.data, loading: false } : current
    )
  }

  /**
   * The gate in front of a bulk run.
   *
   * The account is checked HERE rather than left to the server: with several
   * accounts on the machine and none chosen, every ticket in the queue would
   * come back refused, and the operator would have spent the run to be told
   * once per row what could be said before it started.
   */
  const startBulk = async (): Promise<void> => {
    if (accounts.length > 1 && !username) {
      toast.error('Choose which Myntra account these disputes are sent from')

      return
    }

    // The same session check every marketplace action on the Claims page runs.
    // A dispute is an API call on a stored Myntra jar, so a dead one costs the
    // whole sheet — hours of spaced-out calls — for something one probe sees.
    // Whichever account the run will use: the chosen one, or the only one.
    const account = username || accounts[0] || ''
    const target = account ? { accounts: [{ platform: 'myntra', username: account }] } : { platform: 'myntra' }

    if (!(await ensureLiveSessions(target, 'Re-claim'))) return

    setConfirming(true)
  }

  const running = run?.running === true

  /** How far through the run we are, shown as a number as well as a bar. */
  const percent = run && run.total > 0 ? Math.round((run.done / run.total) * 100) : 0

  const close = (): void => {
    setSearch('')
    onClose()
  }

  return (
    <>
      <Modal
        size="xl"
        fill={sheet !== null}
        open={open}
        // Held open while a run is going: the Stop button is the only way to
        // end it, and it is in here.
        busy={bulk !== null}
        title="Re-claim"
        description={
          sheet
            ? `${sheet.rows.length} ticket(s) from the export. Each dispute is sent on its own` +
              (selected.size > 0 ? ` — ${selected.size} selected.` : '.')
            : 'Upload a Myntra rejection export to dispute its tickets.'
        }
        onClose={close}
        toolbar={
          sheet ? (
            <div className="flex flex-wrap items-center gap-2">
              {accounts.length > 1 && (
                <Select
                  aria-label="Myntra account"
                  size="sm"
                  className="w-56"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  options={[
                    { value: '', label: 'Choose an account…' },
                    ...accounts.map(name => ({ value: name, label: name }))
                  ]}
                />
              )}

              {/* The field itself rather than the app's Input: the search icon
                  is an adornment inside the outline, which Input's props do
                  not reach. Same component underneath, same 32px height. */}
              <CustomTextField
                size="small"
                className="w-56"
                placeholder="Filter — ticket, reason…"
                value={search}
                onChange={event => setSearch(event.target.value)}
                slotProps={{
                  htmlInput: { 'aria-label': 'Filter rows' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <i className="tabler-search text-base" aria-hidden="true" />
                      </InputAdornment>
                    )
                  }
                }}
              />

              {/* Range selection. Ticking 300 of 751 boxes by hand is not work
                  anybody does — they give up and run the lot. */}
              <span className="flex items-center gap-2">
                <Typography variant="body2" color="text.secondary" component="span">
                  Rows
                </Typography>
                <Input
                  aria-label="From row"
                  size="sm"
                  className="w-16"
                  inputMode="numeric"
                  placeholder="from"
                  value={from}
                  onChange={event => setFrom(event.target.value)}
                />
                <Typography variant="body2" color="text.secondary" component="span">
                  to
                </Typography>
                <Input
                  aria-label="To row"
                  size="sm"
                  className="w-16"
                  inputMode="numeric"
                  placeholder="to"
                  value={to}
                  onChange={event => setTo(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={bulk !== null || !from || !to}
                  onClick={selectRange}
                >
                  Select
                </Button>
              </span>

              <Button
                size="sm"
                variant="secondary"
                icon={<i className="tabler-upload text-base" />}
                disabled={bulk !== null}
                onClick={() => void upload()}
              >
                Choose another
              </Button>

              {/* The bulk action, beside the filter because the filter is how a
                  selection gets built: search, select all, search again. */}
              {bulk ? (
                <Button
                  size="sm"
                  variant="danger"
                  icon={<i className="tabler-player-stop text-base" />}
                  onClick={() => {
                    void stopReClaim()
                  }}
                >
                  Stop after this one
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<i className="tabler-refresh text-base" />}
                  disabled={selected.size === 0 || busy !== null || !bulkReady}
                  title={
                    selected.size === 0
                      ? 'Tick the rows to dispute, or use the box in the table header'
                      : undefined
                  }
                  onClick={() => void startBulk()}
                >
                  Re-claim selected ({selected.size})
                </Button>
              )}

              {selected.size > 0 && !bulk && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<i className="tabler-x text-base" />}
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              )}
            </div>
          ) : null
        }
        footer={
          <>
            {/* Offered only before a sheet is loaded, like Upload export beside
                it: once the rows are on screen the template is not what the
                operator came back to the footer for. */}
            {!sheet && !typed && (
              <Button
                size="sm"
                variant="ghost"
                icon={<i className="tabler-download text-base" />}
                onClick={() => void template()}
              >
                Download template
              </Button>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              disabled={bulk !== null}
              onClick={typed ? () => setTyped(null) : close}
            >
              {typed ? 'Back' : 'Close'}
            </Button>
            {!sheet && !typed && (
              <>
                {/* The by-hand route sits beside the upload rather than
                    replacing it: a rejection export is still the normal way in,
                    and this is for the handful that never came out of one. */}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<i className="tabler-plus text-base" />}
                  onClick={startTyping}
                >
                  Add rows by hand
                </Button>
                <Button
                  size="sm"
                  icon={<i className="tabler-upload text-base" />}
                  onClick={() => void upload()}
                >
                  Upload export
                </Button>
              </>
            )}
            {typed && (
              <Button
                size="sm"
                icon={<i className="tabler-list-check text-base" />}
                disabled={!typed.some(row => row.ticketId.trim() && row.description.trim())}
                onClick={() => void applyTyped()}
              >
                Use these {typed.filter(row => row.ticketId.trim()).length || ''} row
                {typed.filter(row => row.ticketId.trim()).length === 1 ? '' : 's'}
              </Button>
            )}
          </>
        }
      >
        {typed ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Typography variant="body2" color="text.secondary">
              A ticket id and its remarks for each row. The remarks are what is sent to Myntra as
              the argument for reopening that ticket; the category is optional and blank keeps the
              one the ticket already has.
            </Typography>

            <Card variant="outlined" className="min-h-0 flex-1 overflow-auto">
              <table className={tableStyles.table}>
                <thead className="table-head-opaque sticky top-0 z-10">
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th className="w-40">Ticket</th>
                    <th>Remarks — sent as the dispute</th>
                    <th className="w-56">Issue category</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {typed.map((row, index) => (
                    <tr key={index} className="align-top">
                      <td className="text-right tabular-nums text-textDisabled">{index + 1}</td>
                      <td>
                        <Input
                          size="sm"
                          className="w-full"
                          value={row.ticketId}
                          placeholder="9160818"
                          aria-label={`Ticket id for row ${index + 1}`}
                          onChange={event => setTypedRow(index, { ticketId: event.target.value })}
                        />
                      </td>
                      <td>
                        {/* A textarea, not an input: this is a paragraph an
                            operator writes, and a single line hides all but the
                            last few words of it. */}
                        <CustomTextField
                          fullWidth
                          multiline
                          size="small"
                          rows={3}
                          value={row.description}
                          onChange={event =>
                            setTypedRow(index, { description: event.target.value })
                          }
                          slotProps={{ htmlInput: { 'aria-label': `Remarks for row ${index + 1}` } }}
                        />
                      </td>
                      <td>
                        <Input
                          size="sm"
                          className="w-full"
                          value={row.issueCategory}
                          placeholder="Optional"
                          aria-label={`Issue category for row ${index + 1}`}
                          onChange={event =>
                            setTypedRow(index, { issueCategory: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        {/* Never removes the last row: an empty form has no way
                            back to one except closing and reopening. */}
                        <IconButton
                          size="small"
                          type="button"
                          disabled={typed.length === 1}
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() =>
                            setTyped(current =>
                              (current ?? []).filter((_, position) => position !== index)
                            )
                          }
                        >
                          <i className="tabler-trash text-lg" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div>
              <Button
                size="sm"
                variant="secondary"
                icon={<i className="tabler-plus text-base" />}
                onClick={() =>
                  setTyped(current => [
                    ...(current ?? []),
                    // The remarks carried down from the row above: consecutive
                    // rows usually argue the same thing, and retyping a
                    // paragraph per ticket is the reason a sheet existed.
                    {
                      ticketId: '',
                      description: current?.[current.length - 1]?.description ?? DEFAULT_DESCRIPTION,
                      issueCategory: current?.[current.length - 1]?.issueCategory ?? ''
                    }
                  ])
                }
              >
                Add row
              </Button>
            </div>
          </div>
        ) : !sheet ? (
          <div className="flex flex-col gap-3">
            <Typography variant="body2" color="text.secondary">
              The export needs a <span className="font-mono text-textPrimary">ticketId</span> column
              and an <span className="font-mono text-textPrimary">RR Remarks</span> column — the
              argument sent for each ticket. The category is optional, and everything else in the
              file is shown as it comes.
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p">
              No export to hand? Download the template, or add the rows by hand. Nothing is sent
              either way — each ticket is disputed only when you press its button.
            </Typography>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <CustomTextField
              fullWidth
              multiline
              size="small"
              rows={3}
              label="Why this rejection should be reconsidered — sent only for rows whose Remarks column is empty"
              value={description}
              onChange={event => setDescription(event.target.value)}
            />

            {run && (
              <Card variant="outlined" className="flex shrink-0 flex-col gap-2 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <Typography variant="body2" color="text.primary" className="font-medium">
                    {running ? 'Disputing' : 'Finished'}{' '}
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      className="tabular-nums"
                    >
                      {run.done} / {run.total}
                    </Typography>
                  </Typography>

                  <Typography variant="caption" color="text.secondary" className="tabular-nums">
                    {percent}% · {run.raised} raised · {run.refused} refused
                  </Typography>
                </div>

                <LinearProgress
                  variant="determinate"
                  value={percent}
                  color={running ? 'primary' : 'success'}
                />

                {running && (
                  // The WAIT is shown, not hidden. A five-second gap with no
                  // explanation reads as the window having frozen; saying it is
                  // pacing is the difference between a pause and a fault.
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="p"
                    className="flex items-center gap-2"
                  >
                    <CircularProgress size={12} color="inherit" />
                    {run.waitingMs > 0
                      ? `Pausing ${(run.waitingMs / 1000).toFixed(1)}s before ticket ${run.ticketId} — spaced out on purpose`
                      : `Ticket ${run.ticketId}`}
                  </Typography>
                )}
              </Card>
            )}

            {/* Offered only once the page is ticked, and only when there is
                more than one page — otherwise the header box already did it.
                Worded with the filter in mind: with one active these are the
                rows that MATCH, which is not the same as the whole sheet. */}
            {rows.length > RE_CLAIM_BATCH_SIZE && allVisibleSelected && (
              <Alert
                severity="info"
                className="shrink-0"
                action={
                  allMatchingSelected ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      disabled={bulk !== null}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear the selection
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      disabled={bulk !== null}
                      onClick={selectEveryMatch}
                    >
                      Select all {matchingIds.length.toLocaleString()}{' '}
                      {search ? 'matching row(s)' : 'row(s)'}
                    </Button>
                  )
                }
              >
                {allMatchingSelected ? (
                  <>
                    All {matchingIds.length.toLocaleString()}{' '}
                    {search ? 'matching row(s)' : 'row(s)'} are selected.
                  </>
                ) : (
                  <>All {visibleIds.length} row(s) on this page are selected.</>
                )}
              </Alert>
            )}

            {/* `min-h-0`, not `min-h-72`. The dialog body is a flex column
                with a capped height and `overflow: hidden`, so whatever cannot
                shrink pushes its siblings out of the bottom — which is exactly
                what happened to the page bar when it was added: a sliver of it
                showed under the footer and its buttons could not be pressed.
                The table is the one thing here that scrolls, so it is the one
                thing that gives. */}
            <Card variant="outlined" className="min-h-0 flex-1 overflow-auto">
              <table className={tableStyles.table}>
                {/* THE BACKGROUND IS ON EVERY CELL, NOT ON THE `thead`.
                    Under `border-collapse: collapse` a background on the thead
                    does not reliably paint beneath a sticky `th`, so the rows
                    passing underneath were legible THROUGH the header — row 2
                    and the column names drawn on top of each other. The Claims
                    table hit this first and was fixed the same way. */}
                <thead className="table-head-opaque sticky top-0 z-10">
                  <tr>
                    {/* Select-all and deselect-all are the same box: ticked or
                        part-ticked, it clears; empty, it selects. Two buttons
                        for that would be one more thing to read. */}
                    <th className="w-8">
                      <Checkbox
                        checked={allVisibleSelected}
                        indeterminate={!allVisibleSelected && visibleSelected > 0}
                        disabled={visibleIds.length === 0 || bulk !== null}
                        onChange={toggleVisible}
                        ariaLabel={
                          visibleSelected > 0
                            ? `Deselect the ${visibleIds.length} row(s) shown`
                            : `Select the ${visibleIds.length} row(s) shown`
                        }
                      />
                    </th>

                    {/* The sheet's own row number, so "rows 40 to 90" in the
                        box above means something an operator can point at. */}
                    <th className="w-10 text-right">#</th>

                    {/* The action comes FIRST: it is what the row is for, and a
                        button at the end of a table this wide is off-screen. */}
                    <th>Action</th>
                    {columns.map(column => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map(row => {
                    const result = row.ticketId ? results[row.ticketId] : undefined

                    return (
                      <tr
                        key={row.rowNumber}
                        className={
                          row.ticketId && selected.has(row.ticketId)
                            ? 'bg-primaryLighter'
                            : 'hover:bg-actionHover'
                        }
                      >
                        <td>
                          {/* A row with no ticket id has nothing to send, so it
                              has no box either — not a disabled one. */}
                          {row.ticketId && (
                            <Checkbox
                              checked={selected.has(row.ticketId)}
                              disabled={bulk !== null}
                              onChange={() => toggleRow(row.ticketId)}
                              ariaLabel={`Select ticket ${row.ticketId}`}
                            />
                          )}
                        </td>

                        <td className="text-right tabular-nums text-textDisabled">{row.index}</td>

                        <td>
                          {row.ticketId ? (
                            <span className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={result?.ok ? 'secondary' : 'primary'}
                                icon={<i className="tabler-refresh text-base" />}
                                loading={busy === row.ticketId}
                                disabled={
                                  busy !== null ||
                                  running ||
                                  // Its own remarks, or the shared box — one of
                                  // the two has to say something, because
                                  // Myntra refuses a dispute with no argument.
                                  (!row.description.trim() && !description.trim())
                                }
                                onClick={() => void dispute(row.ticketId, row.issueCategory, row.description)}
                              >
                                {result?.ok ? 'Re-claim again' : 'Re-claim'}
                              </Button>

                              {result && (
                                // Myntra's own words on hover: the chip shows a
                                // status, and the reason behind a refusal is the
                                // part an operator is actually after.
                                <Tooltip label={result.message} side="top">
                                  <CustomChip
                                    round="true"
                                    size="small"
                                    variant="tonal"
                                    color={result.ok ? 'success' : 'error'}
                                    icon={
                                      <i
                                        className={classNames(
                                          result.ok ? 'tabler-check' : 'tabler-alert-triangle',
                                          'text-base'
                                        )}
                                      />
                                    }
                                    onClick={() =>
                                      setDetail({
                                        ticketId: row.ticketId,
                                        ticket: result.ticket,
                                        loading: false,
                                        outcome: { ok: result.ok, message: result.message },
                                        payload: result.payload,
                                        error: result.error
                                      })
                                    }
                                    label={
                                      /* Myntra's word first, this app's only as a
                                         fallback: "Raised" says a dispute was sent,
                                         where AWAITING_AGENT_RESPONSE says what
                                         became of it. */
                                      result.ticket?.status ??
                                      statuses[row.ticketId] ??
                                      (result.ok ? 'Raised' : 'Refused')
                                    }
                                  />
                                </Tooltip>
                              )}
                            </span>
                          ) : (
                            // Named rather than left blank: a row with no ticket
                            // id cannot be disputed, and the reason is the cell.
                            <Badge tone="warning">No ticket id</Badge>
                          )}
                        </td>

                        {columns.map(column =>
                          column.key === 'ticketId' ? (
                            <td key={column.key}>
                              <span className="flex items-center gap-1">
                                <span className="select-text">{cell(row.raw[column.key])}</span>

                                {/* A plain read. Beside the id because that is
                                    what it is about, and because deciding
                                    whether a rejection is worth arguing starts
                                    with what Myntra says the reason was. */}
                                {row.ticketId && (
                                  <IconButton
                                    size="small"
                                    type="button"
                                    onClick={() => void view(row.ticketId)}
                                    aria-label={`View ticket ${row.ticketId}`}
                                    title="Read this ticket from Myntra — nothing is sent"
                                  >
                                    <i className="tabler-eye text-lg" />
                                  </IconButton>
                                )}
                              </span>
                            </td>
                          ) : column.key === 'RR Remarks' ? (
                            // A paragraph, not a value. Left to itself it would
                            // set the table's width to the length of somebody's
                            // argument and push every other column off-screen.
                            <td key={column.key} className="max-w-88">
                              <span
                                className="block truncate select-text"
                                title={cell(row.raw[column.key])}
                              >
                                {cell(row.raw[column.key])}
                              </span>
                            </td>
                          ) : (
                            <td key={column.key}>
                              <span className="select-text">{cell(row.raw[column.key])}</span>
                            </td>
                          )
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {rows.length === 0 && (
                <Typography variant="body2" color="text.secondary" className="plb-6 pli-3 text-center">
                  Nothing in the sheet matches “{search}”.
                </Typography>
              )}
            </Card>

            {/* The page bar. Says which rows are in front of them in the
                sheet's own numbering, because that is what the range box and
                the `#` column use — a page that counted 1..50 of its own would
                be a third numbering for the operator to reconcile. */}
            {rows.length > RE_CLAIM_BATCH_SIZE && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <Typography variant="caption" color="text.secondary" className="tabular-nums">
                  Rows {(current - 1) * RE_CLAIM_BATCH_SIZE + 1}–
                  {Math.min(current * RE_CLAIM_BATCH_SIZE, rows.length)} of{' '}
                  {rows.length.toLocaleString()}
                  {bulk && following ? ' · following the run' : ''}
                </Typography>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={current <= 1}
                    onClick={() => setPage(current - 1)}
                  >
                    Previous
                  </Button>
                  <Typography variant="caption" color="text.secondary" className="tabular-nums">
                    Page {current} of {pageCount}
                  </Typography>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={current >= pageCount}
                    onClick={() => setPage(current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}

            {bulk ? (
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                className="flex shrink-0 items-center gap-2"
              >
                <CircularProgress size={12} color="inherit" />
                Disputing {Math.min(bulk.done + 1, bulk.total)} of {bulk.total}
                {bulk.batchCount > 1
                  ? ` · batch ${bulk.batch} of ${bulk.batchCount} (${bulk.batchDone}/${RE_CLAIM_BATCH_SIZE})`
                  : ''}
                . {bulk.raised} raised
                {bulk.refused > 0 ? `, ${bulk.refused} refused` : ''}.{' '}
                {/* The WAIT is shown, not hidden. A five-second gap with no
                    explanation reads as the window having frozen; saying it is
                    pacing is the difference between a pause and a fault. */}
                {bulk.waitingMs > 0
                  ? `Pausing ${(bulk.waitingMs / 1000).toFixed(1)}s before ticket ${bulk.ticketId} — spaced out on purpose.`
                  : `Ticket ${bulk.ticketId}.`}{' '}
                Stopping leaves the rest untouched.
              </Typography>
            ) : (
              busy && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="p"
                  className="flex shrink-0 items-center gap-2"
                >
                  <CircularProgress size={12} color="inherit" />
                  Disputing {busy} — reading the ticket, reopening it, then reading it back.
                </Typography>
              )
            )}
          </div>
        )}
      </Modal>

      {/* The child window: what Myntra says about the ticket after the dispute. */}
      <ReClaimTicketModal view={detail} onClose={() => setDetail(null)} />

      {/* Raised instead of the confirmation when the account's session cannot
          send a dispute — the same dialog the Claims page actions raise. */}
      <SessionGateModal
        accounts={gate?.accounts ?? null}
        action={gate?.action ?? 'Re-claim'}
        onClose={closeGate}
        onRecheck={recheckGate}
      />

      {/* Shown before a bulk run and not before a single one: the argument is
          being spent on tickets the operator is not reading one at a time, so
          the sentence going to all of them is quoted back first. */}
      <ConfirmDialog
        open={confirming}
        destructive
        title={`Re-claim ${selected.size} ticket(s)?`}
        message={
          (() => {
            const chosen = numbered.filter(row => selected.has(row.ticketId))
            const own = chosen.filter(row => row.description.trim()).length
            const falling = chosen.length - own

            // Says which sentence goes where, because that is now a real
            // question: the sheet's remarks are per row, and only the rows that
            // left the column blank get the box's text.
            return (
              `All ${selected.size} are disputed one after another. ` +
              (own > 0 ? `${own} send their own remarks from the sheet. ` : '') +
              (falling > 0
                ? `${falling} have none, and send: “${description.trim()}”. `
                : '') +
              `A ticket's reopen is spent once, so these cannot be argued again with a ` +
              `different reason.`
            )
          })()
        }
        confirmLabel={`Send ${selected.size} dispute(s)`}
        onConfirm={() => void runBulk()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
