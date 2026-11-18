import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Clock } from 'lucide-react'
import type { SnapdealBackupSettings, SnapdealRequestCoverage } from '@shared/types/snapdealBackup'
import { relativeTime } from '@shared/utils/sessionHealth'
import {
  onSnapdealFinished,
  snapdealBackupState,
  snapdealRequestCoverage
} from '@renderer/services/snapdealBackup.service'
import { classNames } from '@renderer/utils/format'

/**
 * Where the Snapdeal backup has got to, under the schedule row.
 *
 * WHY THE ROW ABOVE IS NOT ENOUGH, and it is a sharper problem than AJIO's. A
 * Snapdeal pass legitimately finishes having stored nothing — the reports it
 * asked for are still being built — so the task's own "succeeded 0" is, most
 * nights, the system working correctly. Read on its own it is indistinguishable
 * from a pass that has been failing for a week.
 *
 * So two chips. One says when rows last landed and how far they cover; the
 * other says how many reports are outstanding right now. Together they answer
 * the only question worth asking at a glance: is this waiting, or is it stuck?
 */

export const SnapdealReportSyncStatus = ({ running }: { running: boolean }) => {
  const [settings, setSettings] = useState<SnapdealBackupSettings | null>(null)
  const [coverage, setCoverage] = useState<SnapdealRequestCoverage | null>(null)

  // `running` is a dependency so the chips re-read the moment the task stops,
  // which is the moment they have something new to say.
  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      const [state, requests] = await Promise.all([
        snapdealBackupState(),
        snapdealRequestCoverage()
      ])

      if (cancelled) return

      if (state.success) setSettings(state.data)
      if (requests.success) setCoverage(requests.data)
    }

    void load()

    const unsubscribe = onSnapdealFinished(() => void load())

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [running])

  if (!settings) return null

  const stored = settings.lastStoredAt
  const outstanding = coverage?.outstanding ?? 0

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      <li
        title={
          stored
            ? `Rows last landed ${new Date(stored).toLocaleString()}` +
              (settings.coveredTo ? `, covering up to ${settings.coveredTo}` : '')
            : 'No Snapdeal report has been collected on this machine yet'
        }
        className={classNames(
          'flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs ring-1',
          stored
            ? 'bg-surface-sunken text-textSecondary ring-subtle'
            : 'bg-warning-surface text-warning-fg ring-warning-border'
        )}
      >
        {stored ? (
          <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
        ) : (
          <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
        )}
        <span className="font-medium">Return</span>
        <span className="truncate opacity-80">
          {stored
            ? `${relativeTime(stored)}${settings.coveredTo ? ` · data to ${settings.coveredTo}` : ''}`
            : 'nothing collected yet'}
        </span>
      </li>

      {/* NOT A WARNING. A report Snapdeal is building is the normal middle of
          this process, and colouring it red would have an operator chasing
          something that is simply not finished. */}
      {outstanding > 0 && (
        <li
          title="Reports asked for that Snapdeal has not finished building, or that have not been downloaded yet"
          className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-2xs text-textSecondary ring-1 ring-subtle"
        >
          <Clock size={12} className="shrink-0" aria-hidden="true" />
          <span className="font-medium">{outstanding}</span>
          <span className="opacity-80">waiting at Snapdeal</span>
        </li>
      )}
    </ul>
  )
}
