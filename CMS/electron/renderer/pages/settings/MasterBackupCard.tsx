import { retainedMonthsIn, retainedYears } from '@shared/utils/backupRetention'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  Database,
  Download,
  Eye,
  FileArchive,
  FileUp,
  Trash2,
  RefreshCw,
  X
} from 'lucide-react'
import type {
  BackupCoverage,
  BackupFinished,
  BackupProgress,
  BackupReport,
  BackupSettings
} from '@shared/types/masterBackup'
import type { ReportAccount } from '@shared/types/masterDataReport'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import { reportAccounts } from '@renderer/services/masterDataReport.service'
import {
  backupCoverage,
  backupMonths,
  backupState,
  eraseBackup,
  exportBackup,
  importBackup,
  onBackupFinished,
  onBackupProgress,
  saveBackupState,
  syncSinceLast
} from '@renderer/services/masterBackup.service'
import { formatBytes } from '@shared/utils/dataSize'
import { classNames } from '@renderer/utils/format'
import { BackupCalendarModal } from './BackupCalendarModal'
import { BackupViewerModal } from './BackupViewerModal'

/**
 * Keeping AJIO's master data on this machine.
 *
 * AJIO's reports are a live window, not an archive: ask for August today and
 * you get August; ask in six months and you may get nothing. Every claim this
 * app files is argued from those rows, so once a month has passed the only
 * durable copy is the one taken here.
 *
 * WHOLE MONTHS, because that is how the data is thought about and how it is
 * stored — one file per report per month, each row carrying the page it arrived
 * in. Months already held are green, so the gap is visible before anything is
 * pressed rather than discovered afterwards.
 *
 * THE TWO REPORTS ARE SEPARATE throughout. Forward and return carry different
 * columns and are backed up, counted and deleted on their own — a single
 * progress bar over both would say nothing useful about either.
 *
 * THE RUN IS A BACKGROUND JOB. A year of the return report is an hour of
 * requests, so pressing Back up starts it and hands back a job id: the card
 * follows it live, the Jobs page keeps the record, and closing this page does
 * not stop it.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


/**
 * One bar.
 *
 * AT ZERO until the total is known. AJIO reports its page count in the body of
 * the first response, so the opening tick of a month genuinely does not know
 * how far it has to go — and anything drawn in that gap is a guess that the
 * real number then contradicts.
 */
const Bar = ({ done, total }: { done: number; total: number }) => {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-subtle"
      role="progressbar"
      aria-valuenow={total > 0 ? done : undefined}
      aria-valuemin={0}
      aria-valuemax={total > 0 ? total : undefined}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

const REPORTS: { value: BackupReport; label: string }[] = [
  { value: 'forward', label: 'Forward Report' },
  { value: 'return', label: 'Return Report' }
]

export const MasterBackupCard = () => {
  const toast = useToast()
  const [report, setReport] = useState<BackupReport>('return')
  const [accounts, setAccounts] = useState<ReportAccount[]>([])
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [coverage, setCoverage] = useState<BackupCoverage | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  /** The last run that ended, until it is dismissed or another starts. */
  const [finished, setFinished] = useState<BackupFinished | null>(null)
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  /** The months ticked for this run. Empty until something is picked. */
  const [picked, setPicked] = useState<number[]>([])
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  /**
   * A flag per button, deliberately.
   *
   * One shared `busy` put the spinner on whichever button happened to match its
   * condition: Back up cleared the month selection as it started, the condition
   * stopped matching there, and the spinner appeared on Sync now instead — for
   * the whole background run, and forever if its end was ever missed. A button
   * now spins only for its own call.
   */
  const [starting, setStarting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [moving, setMoving] = useState<'export' | 'import' | 'erase' | null>(null)

  /** Bumped whenever a run or a delete changes what is held. */
  const [reloads, setReloads] = useState(0)
  const loadCoverage = useCallback(() => setReloads(current => current + 1), [])

  // Every setState happens after an await — see BackupCalendarModal.
  useEffect(() => {
    let cancelled = false

    void backupCoverage(report).then(response => {
      if (cancelled || !response.success) return

      setCoverage(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [report, reloads])

  useEffect(() => {
    void reportAccounts().then(response => {
      if (!response.success) return

      const usable = response.data.filter(account => account.pobCount > 0)

      setAccounts(response.data)
      // Pre-picked when only one account can be read from — the common case,
      // and one fewer decision before the useful one.
      setSettings(current =>
        current && !current.username && usable.length === 1
          ? { ...current, username: usable[0]?.username ?? '' }
          : current
      )
    })

    void backupState().then(response => {
      if (!response.success) return

      setSettings(response.data)
    })
  }, [])

  useEffect(() => onBackupProgress(setProgress), [])

  // The run ends whether or not anyone is watching this card, so the result
  // arrives as its own event rather than as a bar quietly reaching the end.
  useEffect(
    () =>
      onBackupFinished(event => {
        setFinished(event)
        // The end, from the event that cannot be missed: if the last progress
        // tick never arrived, the card would otherwise stay "running" and keep
        // every button disabled until the app was restarted.
        setProgress(current => (current ? { ...current, running: false } : current))
        loadCoverage()

        const detail =
          `${event.added.toLocaleString()} row(s) saved` +
          (event.skipped > 0 ? `, ${event.skipped.toLocaleString()} already held` : '') +
          (event.failed > 0 ? `, ${event.failed} page(s) failed` : '')

        // A calendar range is reported by the dialog that started it; these
        // are the runs nobody is sitting in front of.
        if (event.kind === 'range') return

        if (event.error) toast.error(`Backup stopped — ${event.error}`)
        else toast.success(`Backup finished · ${event.label} · ${detail}`)
      }),
    [loadCoverage, toast]
  )

  /** year-month → rows held, for the green chips. */
  const heldMonths = useMemo(() => {
    const map = new Map<string, number>()

    for (const month of coverage?.months ?? []) map.set(`${month.year}-${month.month}`, month.rows)

    return map
  }, [coverage])

  const username = settings?.username ?? ''
  const running = progress?.running === true

  const toggleMonth = (month: number): void => {
    setPicked(current =>
      current.includes(month) ? current.filter(entry => entry !== month) : [...current, month]
    )
  }

  const start = async (): Promise<void> => {
    if (picked.length === 0 || !username) return

    setStarting(true)
    setFinished(null)

    // Contiguous by design: the service walks month to month, so a scattered
    // selection is read as the span it covers. Said in the toast rather than
    // refused — the span is what an operator means by "these months".
    const sorted = [...picked].sort((a, b) => a - b)
    const response = await backupMonths({
      report,
      username,
      fromYear: year,
      fromMonth: sorted[0] ?? 1,
      toYear: year,
      toMonth: sorted.at(-1) ?? 1
    })

    setStarting(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    // It runs on from here. The toast says where to find it afterwards, because
    // the answer arrives minutes or hours later and this card may be closed.
    toast.success(
      `Backing up ${response.data.label} · ${response.data.months} month(s) — ` +
        'it keeps going in the background and lands in Jobs when it is done'
    )

    setPicked([])
  }

  const syncNow = async (): Promise<void> => {
    setSyncing(true)

    const response = await syncSinceLast(report)

    setSyncing(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    toast.success(
      `${response.data.added} row(s) saved` +
        (response.data.skipped > 0 ? `, ${response.data.skipped} already held` : '')
    )

    loadCoverage()
  }

  /**
   * Off this machine, and back on.
   *
   * The backup is the only durable copy of reports AJIO stops serving, and it
   * lives in one app's data directory on one laptop. These two are what make
   * that recoverable.
   */
  const exportAll = async (): Promise<void> => {
    setMoving('export')

    const response = await exportBackup(report)

    setMoving(null)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { rows, files, months, path } = response.data

    toast.success(
      `${rows.toLocaleString()} row(s) from ${months} month(s) exported as ${files} file(s) — ${path}`
    )
  }

  const importAll = async (): Promise<void> => {
    setMoving('import')

    const response = await importBackup(report)

    setMoving(null)

    if (!response.success) {
      // Closing the file picker is not a failure worth a toast.
      if (response.error.message !== 'Cancelled') toast.error(response.error.message)

      return
    }

    const { added, skipped, failed, months } = response.data

    toast.success(
      `${added.toLocaleString()} row(s) imported from ${months} month(s)` +
        (skipped > 0 ? `, ${skipped.toLocaleString()} already held` : '') +
        (failed > 0 ? `, ${failed} file(s) failed` : '')
    )

    loadCoverage()
  }

  /**
   * Everything held for this report, gone.
   *
   * The confirming happens in the main process, where the dialog can state the
   * rows, the months and the size — what is about to be lost, rather than "are
   * you sure" — and where it cannot be clicked past by accident.
   */
  const eraseAll = async (): Promise<void> => {
    setMoving('erase')

    const response = await eraseBackup(report)

    setMoving(null)

    if (!response.success) {
      if (response.error.message !== 'Cancelled') toast.error(response.error.message)

      return
    }

    setFinished(null)
    toast.success(`${response.data.removed.toLocaleString()} row(s) erased`)
    loadCoverage()
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-surface p-5 ring-1 ring-subtle">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
            <Database size={16} className="text-faint" aria-hidden="true" />
            AJIO master data backup
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            AJIO&apos;s reports are a live window. This keeps a copy on this machine, month by
            month, so a claim can still be argued once the window has moved on.
          </p>
        </div>

        {/* Rows and megabytes: the second is the one that decides whether a
            year of this fits on the machine, and it is the file's real size. */}
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {coverage
            ? `${coverage.rows.toLocaleString()} row(s) held` +
              (coverage.bytes > 0 ? ` · ${formatBytes(coverage.bytes)}` : '')
            : ''}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Report"
          size="sm"
          className="w-40"
          value={report}
          onChange={event => {
            setReport(event.target.value as BackupReport)
            setPicked([])
          }}
          options={REPORTS.map(entry => ({ value: entry.value, label: entry.label }))}
        />

        <Select
          aria-label="AJIO account"
          size="sm"
          className="w-64"
          value={username}
          onChange={event => {
            const next = event.target.value

            setSettings(current => (current ? { ...current, username: next } : current))
            void saveBackupState({ username: next })
          }}
          options={[
            { value: '', label: 'Choose an account…' },
            ...accounts.map(account => ({
              value: account.username,
              label:
                account.pobCount > 0
                  ? `${account.username} (${account.pobCount} POBs)`
                  : `${account.username} — no POBs synced`
            }))
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

      {/* The months, with what is already held. Green is the answer to "have we
          got this", which is the question the card opens with. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Only the months the backup keeps (see backupRetention): an older one
            would be deleted again by the next prune. */}
        {retainedMonthsIn(year).map(month => {
          const label = MONTHS[month - 1] ?? ''
          const rows = heldMonths.get(`${year}-${month}`) ?? 0
          const chosen = picked.includes(month)

          return (
            <button
              key={label}
              type="button"
              disabled={running || starting || syncing}
              onClick={() => toggleMonth(month)}
              title={rows > 0 ? `${rows.toLocaleString()} row(s) held` : 'Nothing held yet'}
              className={classNames(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                chosen
                  ? 'bg-accent text-on-accent'
                  : rows > 0
                    ? 'bg-success-surface text-success-fg ring-1 ring-success-border hover:bg-success-surface/70'
                    : 'text-textSecondary ring-1 ring-subtle hover:bg-surface-hover',
                'disabled:cursor-not-allowed disabled:opacity-40'
              )}
            >
              {label}
            </button>
          )
        })}

        {/* Off this machine and back on. Beside Back up because they are the
            same subject — where the rows come from and where they can go —
            and because the zip they write is the only copy that survives this
            laptop. */}
        <Button
          className="ml-auto"
          variant="secondary"
          icon={<FileArchive size={14} />}
          loading={moving === 'export'}
          disabled={running || starting || (coverage?.months.length ?? 0) === 0}
          title="Every month held, as one zip of spreadsheets in Downloads"
          onClick={() => void exportAll()}
        >
          Export
        </Button>

        <Button
          variant="secondary"
          icon={<FileUp size={14} />}
          loading={moving === 'import'}
          disabled={running || starting}
          title="Read a zip back in — rows already held are skipped"
          onClick={() => void importAll()}
        >
          Import
        </Button>

        <Button
          icon={<Download size={14} />}
          disabled={picked.length === 0 || !username || running || starting}
          loading={starting}
          title={
            picked.length === 0
              ? 'Pick one or more months first'
              : !username
                ? 'Choose the AJIO account to read from'
                : undefined
          }
          onClick={() => void start()}
        >
          Back up {picked.length > 0 ? `(${picked.length})` : ''}
        </Button>
      </div>

      {/* Running: every month, each with its own line.
          NO OVERALL BAR. All the months are read at the same time, so a single
          bar over nine of them says nothing an operator can act on — "43%" does
          not tell you that August has stalled on page 2 while the rest are
          halfway. The lines do. */}
      {running && progress && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-sunken px-3 py-2.5 text-xs text-textSecondary ring-1 ring-subtle">
          <div className="flex flex-col gap-1.5">
            {progress.months.map(month => (
              <div key={month.label} className="flex flex-col gap-1">
                <p className="flex items-baseline justify-between gap-3">
                  <span
                    className={classNames(
                      'font-medium',
                      // A truncated month is NOT a finished one, whatever the bar
                      // says — green here would be the lie this warning exists
                      // to stop.
                      month.truncated
                        ? 'text-warning-fg'
                        : month.done
                          ? 'text-success-fg'
                          : 'text-textPrimary'
                    )}
                  >
                    {month.label}
                  </span>
                  <span className="tabular-nums text-muted">
                    {month.done
                      ? `${month.added.toLocaleString()} saved`
                      : month.totalPages > 0
                        ? // DAYS FIRST, PAGES SECOND. AJIO caps a window at 100
                          // pages, so a busy month is read in several windows
                          // and the page number restarts with each one — on its
                          // own it read as a bar going backwards over and over.
                          // Days only climb, and they say how much of the month
                          // is actually held; the page keeps the line alive
                          // inside a window that takes a while.
                          `${month.daysDone} of ${month.daysTotal} days · page ${month.page} of ` +
                          `${month.totalPages} · ${month.added.toLocaleString()} saved`
                        : 'reading the first page…'}
                    {month.failed > 0 ? ` · ${month.failed} failed` : ''}
                  </span>
                </p>

                {/* THE BAR CANNOT SAY THIS. It fills to the last page AJIO
                    admits to, and AJIO admits to 100 for every month — so a
                    month short by thousands of rows still draws 100%. Said in
                    words, with both numbers, because the operator's next move
                    is to re-sync that month in smaller ranges. */}
                {month.truncated && month.totalElements !== null && (
                  <p className="text-2xs text-warning-fg">
                    Incomplete — AJIO holds {month.totalElements.toLocaleString()} row(s) here but
                    would only serve {(month.totalPages * 100).toLocaleString()}. Re-sync this month
                    in smaller date ranges from Coverage.
                  </p>
                )}
                {/* Driven by DAYS, which never go backwards. Pages cannot do
                    this once a month is read in more than one window. */}
                <Bar
                  done={month.done ? month.daysTotal || 1 : month.daysDone}
                  total={month.done ? month.daysTotal || 1 : month.daysTotal}
                />
              </div>
            ))}
          </div>

          <p className="border-t border-subtle pt-2 tabular-nums">
            <span className="font-medium text-textPrimary">{progress.added.toLocaleString()}</span>{' '}
            saved in total
            {progress.skipped > 0 ? `, ${progress.skipped.toLocaleString()} already held` : ''}
            {progress.failed > 0 ? `, ${progress.failed} page(s) failed` : ''}
            {' · keeps running if you leave this page'}
          </p>
        </div>
      )}

      {/* Ended. Stays until it is dismissed or another run starts, so a backup
          that finished while the operator was elsewhere is still reported. */}
      {!running && finished && (
        <div
          className={classNames(
            'flex items-start gap-2 rounded-md px-3 py-2.5 text-xs ring-1',
            finished.error
              ? 'bg-danger-surface text-danger-fg ring-danger-border'
              : 'bg-success-surface text-success-fg ring-success-border'
          )}
        >
          {finished.error ? (
            <X size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}

          <p className="flex-1">
            <span className="font-medium">{finished.label}</span> —{' '}
            {finished.error
              ? finished.error
              : `${finished.added.toLocaleString()} row(s) saved` +
                (finished.skipped > 0
                  ? `, ${finished.skipped.toLocaleString()} already held`
                  : '') +
                (finished.failed > 0 ? `, ${finished.failed} page(s) failed` : '') +
                `. Kept in Jobs.`}
          </p>

          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            onClick={() => setFinished(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <Button
          variant="secondary"
          icon={<CalendarDays size={14} />}
          onClick={() => setCalendarOpen(true)}
        >
          Coverage
        </Button>

        <Button
          variant="secondary"
          icon={<Eye size={14} />}
          disabled={(coverage?.months.length ?? 0) === 0}
          onClick={() => setViewerOpen(true)}
        >
          View data
        </Button>

        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          loading={moving === 'erase'}
          disabled={running || starting || (coverage?.rows ?? 0) === 0}
          title="Delete every month held for this report on this machine"
          onClick={() => void eraseAll()}
        >
          Erase all
        </Button>

        <span className="ml-auto flex items-center gap-2">
          {/* WHEN the daily re-sync happens is set on the Automation schedule
              card, with the other three nightly tasks — not here. One setting,
              one timer: this card used to arm its own, which knew nothing about
              the automation lock and so could start an AJIO sync on top of a
              bulk claim, and which silently skipped the night altogether
              whenever the laptop slept through the appointed hour. */}
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} />}
            loading={syncing}
            disabled={!username || running || starting}
            onClick={() => void syncNow()}
          >
            Sync now
          </Button>
        </span>
      </div>

      {settings?.lastRunAt && (
        <p className="text-xs text-faint">
          Last daily re-sync: {new Date(settings.lastRunAt).toLocaleString()}
          {settings.lastSyncedDate ? ` · data covered to ${settings.lastSyncedDate}` : ''}
        </p>
      )}

      <BackupCalendarModal
        open={calendarOpen}
        report={report}
        onClose={() => setCalendarOpen(false)}
        onChanged={loadCoverage}
      />

      {/* The dialog reads its own months now: it can switch report, and the
          card's copy would be the wrong report's the moment it did. */}
      <BackupViewerModal
        // Keyed so each opening starts from the report the card is showing:
        // the dialog can switch report itself, and seeding that in an effect
        // would be a render inside an effect.
        key={`${report}-${viewerOpen ? 'open' : 'closed'}`}
        open={viewerOpen}
        report={report}
        onClose={() => setViewerOpen(false)}
      />
    </section>
  )
}
