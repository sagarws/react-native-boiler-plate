import { retainedMonthsIn, retainedYears } from '@shared/utils/backupRetention'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CalendarDays,
  Database,
  Download,
  Eye,
  FileArchive,
  FileUp,
  RefreshCw,
  Send,
  Trash2
} from 'lucide-react'
import type {
  FlipkartCardState,
  FlipkartCoverage,
  FlipkartReport,
  FlipkartRequestCoverage
} from '@shared/types/flipkartBackup'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import { sessionHealth } from '@renderer/services/platformSession.service'
import {
  collectFlipkartReports,
  eraseFlipkartBackup,
  exportFlipkartBackup,
  importFlipkartBackup,
  flipkartCardState,
  flipkartCoverage,
  flipkartRequestCoverage,
  requestFlipkartMonths,
  saveFlipkartCardState
} from '@renderer/services/flipkartBackup.service'
import { classNames, formatBytes } from '@renderer/utils/format'
import { FlipkartBackupCalendarModal } from './FlipkartBackupCalendarModal'
import { FlipkartRequestCalendarModal } from './FlipkartRequestCalendarModal'
import { FlipkartViewerModal } from './FlipkartViewerModal'

/**
 * Flipkart's Orders and Returns reports, kept on this machine.
 *
 * THE SNAPDEAL CARD, WITH A REPORT DROPDOWN. Flipkart answers a report request
 * with a request id and builds the file over about half an hour, so a month is
 * in one of three states, exactly as on the Snapdeal card:
 *
 *   grey    nobody has asked for it
 *   amber   asked for, Flipkart has not finished building it
 *   green   the rows are on this machine
 *
 * The one difference is that Flipkart has TWO reports. The dropdown picks which
 * one the chips, Request, both calendars, the viewer and Erase all act on.
 * Collect now is the exception: it fetches whatever this account has finished,
 * both reports, because a finished file is worth having whichever it is.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const THIS_YEAR = new Date().getFullYear()

const REPORTS: { value: FlipkartReport; label: string }[] = [
  { value: 'forward', label: 'Orders Report' },
  { value: 'return', label: 'Returns Report' }
]

const REPORT_NAME: Record<FlipkartReport, string> = { forward: 'Orders', return: 'Returns' }

export const FlipkartBackupCard = () => {
  const toast = useToast()
  const [report, setReport] = useState<FlipkartReport>('return')
  const [settings, setSettings] = useState<FlipkartCardState | null>(null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [coverage, setCoverage] = useState<FlipkartCoverage | null>(null)
  const [requests, setRequests] = useState<FlipkartRequestCoverage | null>(null)
  const [year, setYear] = useState(THIS_YEAR)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState<'request' | 'collect' | 'erase' | 'export' | 'import' | null>(null)
  const [open, setOpen] = useState<'coverage' | 'requests' | 'viewer' | null>(null)
  const [reloads, setReloads] = useState(0)

  const reload = useCallback(() => setReloads(current => current + 1), [])

  useEffect(() => {
    let cancelled = false

    void Promise.all([flipkartCoverage(report), flipkartRequestCoverage(report)]).then(([held, asked]) => {
      if (cancelled) return

      if (held.success) setCoverage(held.data)
      if (asked.success) setRequests(asked.data)
    })

    return () => {
      cancelled = true
    }
  }, [report, reloads])

  useEffect(() => {
    let cancelled = false

    void Promise.all([flipkartCardState(), sessionHealth()]).then(([state, health]) => {
      if (cancelled) return

      // The accounts come from the session health list, as on the Snapdeal
      // card: the same set the Login page shows.
      const flipkart = health.success ? health.data.find(entry => entry.platform === 'flipkart') : undefined
      const names = (flipkart?.credentials ?? [])
        .filter(row => row.visible && row.username.trim().length > 0)
        .map(row => row.username)

      setAccounts(names)

      if (!state.success) return

      // Nothing chosen yet: the first account, rather than an empty box that
      // leaves every button disabled for no visible reason.
      const first = names[0]

      if (!state.data.username && first) {
        setSettings({ ...state.data, username: first })
        void saveFlipkartCardState({ username: first })
      } else {
        setSettings(state.data)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  /** year-month → rows held, for the green chips. */
  const heldMonths = useMemo(() => {
    const map = new Map<string, number>()

    for (const month of coverage?.months ?? []) map.set(`${month.year}-${month.month}`, month.rows)

    return map
  }, [coverage])

  /**
   * year-month → a request covering some of it is still outstanding.
   *
   * Derived from the request DAYS, because a 60-day window straddles months
   * and the chip has to amber each of them.
   */
  const awaitedMonths = useMemo(() => {
    const set = new Set<string>()

    for (const day of requests?.days ?? []) {
      if (day.status !== 'requested') continue

      const [entryYear, entryMonth] = day.date.split('-')

      set.add(`${Number(entryYear)}-${Number(entryMonth)}`)
    }

    return set
  }, [requests])

  const username = settings?.username ?? ''
  const running = busy !== null

  const toggleMonth = (month: number): void => {
    setPicked(current =>
      current.includes(month) ? current.filter(entry => entry !== month) : [...current, month]
    )
  }

  const request = async (): Promise<void> => {
    if (picked.length === 0 || !username) return

    setBusy('request')

    // Contiguous by design, as on the other cards: a scattered selection is
    // read as the span it covers.
    const sorted = [...picked].sort((a, b) => a - b)
    const response = await requestFlipkartMonths({
      username,
      report,
      year,
      fromMonth: sorted[0] ?? 1,
      toMonth: sorted.at(-1) ?? 1
    })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { sent, skipped, failed } = response.data

    // THE REPORTS DO NOT EXIST YET, and saying so is the point of this toast:
    // an operator who expects rows and finds none will erase and start again.
    if (sent > 0) {
      toast.success(
        `Asked Flipkart for ${sent} ${REPORT_NAME[report]} report(s) — they build over about half an ` +
          'hour. Collect now, or leave it to the scheduled pass.'
      )
    } else if (failed > 0) {
      toast.error(`Flipkart refused ${failed} request(s) — see Requests`)
    } else if (skipped > 0) {
      toast.info('Those months are already asked for or collected')
    }

    setPicked([])
    reload()
  }

  const collect = async (): Promise<void> => {
    if (!username) return

    setBusy('collect')

    const response = await collectFlipkartReports(username)

    setBusy(null)
    reload()

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { stored, added, pending, failed } = response.data

    // SAID IN FULL, because "0 collected" is a normal outcome and an operator
    // who reads it as a failure will go and re-request everything.
    toast.success(
      [
        stored > 0 ? `${stored} collected` : '',
        added > 0 ? `${added.toLocaleString()} row(s) saved` : '',
        pending > 0 ? `${pending} still building at Flipkart` : '',
        failed > 0 ? `${failed} failed` : ''
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing to collect'
    )
  }

  /**
   * Off this machine, and back on — the same pair AJIO's card has.
   *
   * The backup is the only copy of a report window Flipkart has moved on from,
   * and it lives in one app's data folder on one laptop. Export writes it to a
   * zip in Downloads; Import merges one back (rows already held are skipped).
   */
  const exportAll = async (): Promise<void> => {
    setBusy('export')

    const response = await exportFlipkartBackup(report)

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { rows, months, path } = response.data

    toast.success(`${rows.toLocaleString()} row(s) from ${months} month(s) exported — ${path}`)
  }

  const importAll = async (): Promise<void> => {
    setBusy('import')

    const response = await importFlipkartBackup(report)

    setBusy(null)

    if (!response.success) {
      // Closing the file picker is not a failure worth a toast.
      if (response.error.message !== 'Cancelled') toast.error(response.error.message)

      return
    }

    const { added, updated, skipped, failed, months } = response.data

    toast.success(
      `${added.toLocaleString()} row(s) imported from ${months} month(s)` +
        (updated > 0 ? `, ${updated.toLocaleString()} filled in` : '') +
        (skipped > 0 ? `, ${skipped.toLocaleString()} already held` : '') +
        (failed > 0 ? `, ${failed} file(s) failed` : '')
    )
    reload()
  }

  const erase = async (): Promise<void> => {
    setBusy('erase')

    const response = await eraseFlipkartBackup(report)

    setBusy(null)

    if (!response.success) {
      // Closing the confirmation is not a failure worth a toast.
      if (response.error.message !== 'Cancelled') toast.error(response.error.message)

      return
    }

    toast.success(`${response.data.rows.toLocaleString()} row(s) erased`)
    reload()
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-surface p-5 ring-1 ring-subtle">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
            <Database size={16} className="text-faint" aria-hidden="true" />
            Flipkart master data backup
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Flipkart builds the Orders and Returns reports rather than answering with them. This asks
            for the windows nothing has asked for yet, then collects the files once they exist — the
            rows Create Claim fills a Flipkart claim from.
          </p>
        </div>

        <span className="shrink-0 text-right text-xs tabular-nums text-muted">
          {coverage
            ? `${coverage.rows.toLocaleString()} row(s) held` +
              (coverage.bytes > 0 ? ` · ${formatBytes(coverage.bytes)}` : '')
            : ''}
          {/* Beside the row count because the two are read together: nothing
              held next to "3 still building" is a wait, not a fault. */}
          {requests && requests.outstanding > 0 && (
            <span className="block text-warning-fg">{requests.outstanding} report(s) still building</span>
          )}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Report"
          size="sm"
          className="w-40"
          value={report}
          disabled={running}
          onChange={event => {
            setReport(event.target.value as FlipkartReport)
            setPicked([])
          }}
          options={REPORTS}
        />

        <Select
          aria-label="Flipkart account"
          size="sm"
          className="w-64"
          value={username}
          onChange={event => {
            const next = event.target.value

            setSettings(current => (current ? { ...current, username: next } : current))
            void saveFlipkartCardState({ username: next })
          }}
          options={[
            { value: '', label: accounts.length === 0 ? 'No Flipkart account' : 'Choose an account…' },
            ...accounts.map(account => ({ value: account, label: account }))
          ]}
        />

        <Select
          aria-label="Year"
          size="sm"
          className="w-24"
          value={String(year)}
          onChange={event => {
            setYear(Number(event.target.value))
            setPicked([])
          }}
          options={retainedYears().map(value => ({ value: String(value), label: String(value) }))}
        />
      </div>

      {/* Green is held, amber is asked-for-and-waiting, grey is neither. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Only the months the backup keeps (see backupRetention): an older one
            would be deleted again by the next prune. */}
        {retainedMonthsIn(year).map(month => {
          const label = MONTHS[month - 1] ?? ''
          const rows = heldMonths.get(`${year}-${month}`) ?? 0
          const awaited = awaitedMonths.has(`${year}-${month}`)
          const chosen = picked.includes(month)

          return (
            <button
              key={label}
              type="button"
              disabled={running}
              onClick={() => toggleMonth(month)}
              title={
                rows > 0
                  ? `${rows.toLocaleString()} row(s) held` +
                    (awaited ? ' · a report covering this month is still building' : '')
                  : awaited
                    ? 'Asked for — Flipkart is still building the report'
                    : 'Nothing asked for yet'
              }
              className={classNames(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                chosen
                  ? 'bg-accent text-on-accent'
                  : rows > 0
                    ? 'bg-success-surface text-success-fg ring-1 ring-success-border hover:bg-success-surface/70'
                    : awaited
                      ? 'bg-warning-surface text-warning-fg ring-1 ring-warning-border hover:bg-warning-surface/70'
                      : 'text-textSecondary ring-1 ring-subtle hover:bg-surface-hover',
                'disabled:cursor-not-allowed disabled:opacity-40'
              )}
            >
              {label}
            </button>
          )
        })}

        {/* Off this machine and back on, beside Request as on the AJIO card. */}
        <Button
          className="ml-auto"
          variant="secondary"
          icon={<FileArchive size={14} />}
          loading={busy === 'export'}
          disabled={running || busy !== null || (coverage?.rows ?? 0) === 0}
          title="Every row held for this report, as one zip of monthly spreadsheets in Downloads"
          onClick={() => void exportAll()}
        >
          Export
        </Button>

        <Button
          variant="secondary"
          icon={<FileUp size={14} />}
          loading={busy === 'import'}
          disabled={running || busy !== null}
          title="Read a zip back in — rows already held are skipped"
          onClick={() => void importAll()}
        >
          Import
        </Button>

        <Button
          icon={<Send size={14} />}
          disabled={picked.length === 0 || !username || running}
          loading={busy === 'request'}
          title={
            picked.length === 0
              ? 'Pick one or more months first'
              : !username
                ? 'Choose the Flipkart account to read from'
                : `Asks Flipkart to build the ${REPORT_NAME[report]} report. It arrives in about half an hour.`
          }
          onClick={() => void request()}
        >
          Request {picked.length > 0 ? `(${picked.length})` : ''}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          icon={<CalendarDays size={14} />}
          disabled={running}
          title="Which days hold rows on this machine"
          onClick={() => setOpen('coverage')}
        >
          Coverage
        </Button>

        <Button
          variant="secondary"
          icon={<CalendarClock size={14} />}
          disabled={running}
          title="Which days were asked for, and whether the report has arrived"
          onClick={() => setOpen('requests')}
        >
          Requests
        </Button>

        <Button
          variant="secondary"
          icon={<Eye size={14} />}
          disabled={running}
          title="The stored rows, month by month"
          onClick={() => setOpen('viewer')}
        >
          View data
        </Button>

        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          loading={busy === 'erase'}
          disabled={running || (coverage?.rows ?? 0) === 0}
          onClick={() => void erase()}
        >
          Erase all
        </Button>

        <Button
          className="ml-auto"
          variant="secondary"
          icon={busy === 'collect' ? <RefreshCw size={14} /> : <Download size={14} />}
          loading={busy === 'collect'}
          disabled={running || !username}
          title={
            !username
              ? 'Choose the Flipkart account to read from'
              : 'Downloads every report Flipkart has finished building'
          }
          onClick={() => void collect()}
        >
          Collect now
        </Button>
      </div>

      <FlipkartBackupCalendarModal
        open={open === 'coverage'}
        report={report}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />

      <FlipkartRequestCalendarModal
        open={open === 'requests'}
        report={report}
        username={username}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />

      {/* Keyed on the report, so switching it starts the viewer afresh. */}
      <FlipkartViewerModal
        key={report}
        open={open === 'viewer'}
        report={report}
        onClose={() => setOpen(null)}
      />
    </section>
  )
}
