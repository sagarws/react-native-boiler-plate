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
  SnapdealBackupSettings,
  SnapdealCoverage,
  SnapdealProgress,
  SnapdealRequestCoverage
} from '@shared/types/snapdealBackup'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import { sessionHealth } from '@renderer/services/platformSession.service'
import {
  collectSnapdealReports,
  eraseSnapdealBackup,
  exportSnapdealBackup,
  importSnapdealBackup,
  onSnapdealFinished,
  onSnapdealProgress,
  requestSnapdealMonths,
  saveSnapdealBackupState,
  snapdealBackupState,
  snapdealCoverage,
  snapdealRequestCoverage
} from '@renderer/services/snapdealBackup.service'
import { classNames, formatBytes } from '@renderer/utils/format'
import { SnapdealRequestCalendarModal } from './SnapdealRequestCalendarModal'
import { SnapdealBackupCalendarModal } from './SnapdealBackupCalendarModal'
import { SnapdealViewerModal } from './SnapdealViewerModal'

/**
 * Snapdeal's return report, kept on this machine.
 *
 * THE CARD HAS TO SHOW TWO THINGS AT ONCE, which is what makes it different
 * from the AJIO one. Snapdeal does not answer a report request with the rows —
 * it answers with a receipt and builds the file over the following minutes. So
 * a month can be in one of three states, not two:
 *
 *   grey    nobody has asked for it
 *   amber   asked for, Snapdeal has not finished building it
 *   green   the rows are on this machine
 *
 * An operator who cannot tell amber from grey will keep re-requesting windows
 * that are already queued, which is the one thing Snapdeal rate-limits for.
 * Hence two calendars behind two buttons: Coverage is what is HELD, Requests is
 * what was ASKED.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

const THIS_YEAR = new Date().getFullYear()

export const SnapdealBackupCard = () => {
  const toast = useToast()
  const [settings, setSettings] = useState<SnapdealBackupSettings | null>(null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [coverage, setCoverage] = useState<SnapdealCoverage | null>(null)
  const [requests, setRequests] = useState<SnapdealRequestCoverage | null>(null)
  const [year, setYear] = useState(THIS_YEAR)
  const [picked, setPicked] = useState<number[]>([])
  const [progress, setProgress] = useState<SnapdealProgress | null>(null)
  const [busy, setBusy] = useState<'request' | 'collect' | 'erase' | 'export' | 'import' | null>(null)
  const [open, setOpen] = useState<'coverage' | 'requests' | 'viewer' | null>(null)
  const [reloads, setReloads] = useState(0)

  const reload = useCallback(() => setReloads(current => current + 1), [])

  useEffect(() => {
    let cancelled = false

    void Promise.all([snapdealCoverage(), snapdealRequestCoverage()]).then(
      ([held, asked]) => {
        if (cancelled) return

        if (held.success) setCoverage(held.data)
        if (asked.success) setRequests(asked.data)
      }
    )

    return () => {
      cancelled = true
    }
  }, [reloads])

  useEffect(() => {
    let cancelled = false

    void snapdealBackupState().then(response => {
      if (!cancelled && response.success) setSettings(response.data)
    })

    // The accounts come from the session health list rather than a channel of
    // this card's own: it is the same set the Login page shows, and a second
    // source would be one more thing to disagree with it.
    void sessionHealth().then(response => {
      if (cancelled || !response.success) return

      const snapdeal = response.data.find(entry => entry.platform === 'snapdeal')

      setAccounts(
        (snapdeal?.credentials ?? [])
          .filter(row => row.visible && row.username.trim().length > 0)
          .map(row => row.username)
      )
    })

    return () => {
      cancelled = true
    }
  }, [])

  // A pass started anywhere — the schedule, this card, the request calendar —
  // moves both calendars, and it ends whether or not anyone is on this page.
  useEffect(() => {
    const stopProgress = onSnapdealProgress(setProgress)
    const stopFinished = onSnapdealFinished(finished => {
      setProgress(null)
      reload()

      if (finished.error) {
        toast.error(`Snapdeal ${finished.label}: ${finished.error}`)

        return
      }

      // SAID IN FULL, because "0 collected" is a normal outcome and an
      // operator who reads it as a failure will go and re-request everything.
      toast.success(
        [
          finished.sent > 0 ? `${finished.sent} report(s) requested` : '',
          finished.stored > 0 ? `${finished.stored} collected` : '',
          finished.added > 0 ? `${finished.added.toLocaleString()} row(s) saved` : '',
          finished.pending > 0 ? `${finished.pending} still building at Snapdeal` : ''
        ]
          .filter(Boolean)
          .join(' · ') || 'Nothing to do'
      )
    })

    return () => {
      stopProgress()
      stopFinished()
    }
  }, [reload, toast])

  /** year-month → rows held, for the green chips. */
  const heldMonths = useMemo(() => {
    const map = new Map<string, number>()

    for (const month of coverage?.months ?? []) map.set(`${month.year}-${month.month}`, month.rows)

    return map
  }, [coverage])

  /**
   * year-month → a request covering some of it is still outstanding.
   *
   * Derived from the request DAYS rather than from the request rows, because a
   * 28-day window straddles two months and the chip has to amber both.
   */
  const awaitedMonths = useMemo(() => {
    const set = new Set<string>()

    for (const day of requests?.days ?? []) {
      if (day.status !== 'requested' && day.status !== 'ready') continue

      const [entryYear, entryMonth] = day.date.split('-')

      set.add(`${Number(entryYear)}-${Number(entryMonth)}`)
    }

    return set
  }, [requests])

  const username = settings?.username ?? ''
  const running = progress?.running === true || busy !== null

  const toggleMonth = (month: number): void => {
    setPicked(current =>
      current.includes(month) ? current.filter(entry => entry !== month) : [...current, month]
    )
  }

  const request = async (): Promise<void> => {
    if (picked.length === 0 || !username) return

    setBusy('request')

    // Contiguous by design, exactly as the AJIO card is: the service walks the
    // span, so a scattered selection is read as the range it covers.
    const sorted = [...picked].sort((a, b) => a - b)
    const response = await requestSnapdealMonths({
      username,
      fromYear: year,
      fromMonth: sorted[0] ?? 1,
      toYear: year,
      toMonth: sorted.at(-1) ?? 1
    })

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    // THE REPORTS DO NOT EXIST YET, and saying so is the whole point of this
    // toast: an operator who expects rows and finds none will erase the backup
    // and start again.
    toast.success(
      `Asked Snapdeal for ${response.data.windows} report(s) — they build over the next few ` +
        'minutes. Collect now, or leave it to the scheduled pass.'
    )
    setPicked([])
    reload()
  }

  const collect = async (): Promise<void> => {
    setBusy('collect')

    const response = await collectSnapdealReports()

    setBusy(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    reload()
  }

  /**
   * Off this machine, and back on — the same pair AJIO's card has.
   *
   * The backup is the only copy of a report window Snapdeal has moved on from,
   * and it lives in one app's data folder on one laptop. Export writes it to a
   * zip in Downloads; Import merges one back (rows already held are skipped).
   */
  const exportAll = async (): Promise<void> => {
    setBusy('export')

    const response = await exportSnapdealBackup()

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

    const response = await importSnapdealBackup()

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

    const response = await eraseSnapdealBackup()

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
            Snapdeal master data backup
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Snapdeal builds a report rather than answering with one. This asks for the windows
            nothing has asked for yet, then collects the files once they exist — so a claim can
            still be argued once the report window has moved on.
          </p>
        </div>

        <span className="shrink-0 text-right text-xs tabular-nums text-muted">
          {coverage
            ? `${coverage.rows.toLocaleString()} row(s) held` +
              (coverage.bytes > 0 ? ` · ${formatBytes(coverage.bytes)}` : '')
            : ''}
          {/* The number that explains an empty month. Beside the row count
              because the two are read together: "nothing held" next to "4
              still building" is a wait, not a fault. */}
          {requests && requests.outstanding > 0 && (
            <span className="block text-warning-fg">
              {requests.outstanding} report(s) still building
            </span>
          )}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Snapdeal account"
          size="sm"
          className="w-64"
          value={username}
          onChange={event => {
            const next = event.target.value

            setSettings(current => (current ? { ...current, username: next } : current))
            void saveSnapdealBackupState({ username: next })
          }}
          options={[
            { value: '', label: 'Choose an account…' },
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
                    ? 'Asked for — Snapdeal is still building the report'
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
          title="Every row held, as one zip of monthly spreadsheets in Downloads"
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
                ? 'Choose the Snapdeal account to read from'
                : 'Asks Snapdeal to build the reports. They arrive minutes later.'
          }
          onClick={() => void request()}
        >
          Request {picked.length > 0 ? `(${picked.length})` : ''}
        </Button>
      </div>

      {/* One line, because a Snapdeal pass is a queue of requests rather than
          several months read at once — there is no second thing happening to
          report on. */}
      {progress?.running && (
        <p className="flex items-baseline justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2.5 text-xs text-textSecondary ring-1 ring-subtle">
          <span>{progress.message}</span>
          <span className="tabular-nums text-muted">
            {progress.total > 0 ? `${progress.done} of ${progress.total}` : ''}
          </span>
        </p>
      )}

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

        {/* The second calendar, and the one with no equivalent on the AJIO
            card: what was ASKED of Snapdeal, and how far each request got. */}
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
              ? 'Choose the Snapdeal account to read from'
              : 'Downloads every report Snapdeal has finished building'
          }
          onClick={() => void collect()}
        >
          Collect now
        </Button>
      </div>

      <SnapdealBackupCalendarModal
        open={open === 'coverage'}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />

      <SnapdealRequestCalendarModal
        open={open === 'requests'}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />

      <SnapdealViewerModal open={open === 'viewer'} onClose={() => setOpen(null)} />
    </section>
  )
}
