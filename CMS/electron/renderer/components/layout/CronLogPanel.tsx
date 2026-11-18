import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Info,
  Play,
  SkipForward,
  XCircle
} from 'lucide-react'
import type { CronLogEntry, CronLogLevel } from '@shared/types/cronLog'
import { Button } from '@renderer/components/ui/Button'
import { useDevMode } from '@renderer/context/DevModeContext'
import {
  clearCronActivityLog,
  cronActivityLog,
  onCronLog
} from '@renderer/services/automationSchedule.service'

/**
 * What the scheduler is doing, and what it decided not to do.
 *
 * WHY THIS EXISTS BESIDE THE TASK LIST. The list answers "what is the state of
 * things" — running, queued, off. It cannot answer "why has nothing happened
 * since nine o'clock", because the interesting cases are all absences: a task
 * blocked behind a failure, one waiting out a retry, one deferred because a
 * bulk claim had the browser. Those never appear in a list of tasks; they only
 * exist as decisions, and this is where the decisions are written down.
 *
 * ICONS CARRY THE LEVEL, because the question asked of a log is almost always
 * "is anything wrong" and that should be answerable without reading it.
 */

const ICONS: Record<CronLogLevel, typeof Info> = {
  start: Play,
  success: CheckCircle2,
  partial: AlertTriangle,
  failure: XCircle,
  blocked: Ban,
  skip: SkipForward,
  waiting: Clock,
  info: Info
}

const TONES: Record<CronLogLevel, string> = {
  start: 'text-accent',
  success: 'text-success-fg',
  partial: 'text-warning-fg',
  failure: 'text-danger-fg',
  blocked: 'text-danger-fg',
  skip: 'text-muted',
  waiting: 'text-warning-fg',
  info: 'text-muted'
}

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const day = (iso: string): string => new Date(iso).toLocaleDateString()

export const CronLogPanel = () => {
  const [entries, setEntries] = useState<CronLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { devMode } = useDevMode()
  const seen = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false

    void cronActivityLog().then(response => {
      if (cancelled) return

      if (response.success) {
        seen.current = new Set(response.data.map(entry => entry.id))
        setEntries(response.data)
      } else setError(response.error.message)
    })

    // Live, so a run started while this is open fills in rather than needing a
    // reopen — which is the moment somebody actually has it open for.
    const stop = onCronLog(entry => {
      if (seen.current.has(entry.id)) return

      seen.current.add(entry.id)
      setEntries(current => [entry, ...(current ?? [])])
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const clear = async (): Promise<void> => {
    await clearCronActivityLog()
    seen.current.clear()
    setEntries([])
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-xs text-muted'>
          {devMode
            ? 'Kept on this machine, so yesterday can be read back.'
            : 'This session only. Turn on developer mode to keep it across restarts.'}
        </p>
        {entries !== null && entries.length > 0 && (
          <Button variant='secondary' onClick={() => void clear()}>
            Clear
          </Button>
        )}
      </div>

      {error !== null && <p className='text-sm text-danger-fg'>{error}</p>}

      {error === null && entries === null && <p className='text-xs text-muted'>Reading the log…</p>}

      {entries !== null && entries.length === 0 && (
        <p className='text-xs text-muted'>
          Nothing yet. Lines appear as the scheduler checks, starts and finishes tasks.
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        /* Scrollable and bounded: a machine left running writes hundreds of
           lines, and the dialog must not grow past the window. */
        <ul className='max-h-[var(--dialog-scroll-max)] overflow-y-auto pe-1'>
          {entries.map((entry, index) => {
            const Icon = ICONS[entry.level]
            const previous = entries[index - 1]
            const newDay = index === 0 || (previous && day(previous.at) !== day(entry.at))

            return (
              <li key={entry.id}>
                {/* A date only where it changes — the log is read within one
                    day almost always, and stamping every line with one buries
                    the times that matter. */}
                {newDay && (
                  <p className='sticky top-0 bg-surface py-1 text-2xs font-semibold uppercase tracking-wide text-muted'>
                    {day(entry.at)}
                  </p>
                )}
                <div className='flex items-start gap-2 border-b border-subtle py-2 last:border-b-0'>
                  <Icon size={14} className={`mt-0.5 shrink-0 ${TONES[entry.level]}`} />
                  <div className='min-w-0 flex-1'>
                    <p className='text-xs text-body'>
                      <span className='font-medium'>{entry.label}</span>
                      <span className='text-muted'> — {entry.message}</span>
                    </p>
                    {/* The marketplace's own words, or the error. Wrapped
                        rather than truncated: this is the half somebody opened
                        the log to read. */}
                    {entry.detail && (
                      <p className='mt-0.5 break-words text-2xs text-muted'>{entry.detail}</p>
                    )}
                  </div>
                  <span className='shrink-0 text-2xs tabular-nums text-muted'>{time(entry.at)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
