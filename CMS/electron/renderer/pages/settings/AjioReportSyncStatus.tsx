import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import type { BackupReport, BackupSettings } from '@shared/types/masterBackup'
import { relativeTime } from '@shared/utils/sessionHealth'
import { backupState, onBackupFinished } from '@renderer/services/masterBackup.service'
import { classNames } from '@renderer/utils/format'

/**
 * When each AJIO report last landed rows on this machine.
 *
 * WHY THE ROW ABOVE IS NOT ENOUGH. "AJIO report sync" is one task but two runs:
 * the forward report and the return report are separate endpoints, and either
 * can fail on its own. The task's last line reports the run as a whole, so a
 * night where the return report brought back nothing at all reads exactly like
 * a night where it had nothing new — and the claims argued from the return
 * report are the ones that then cannot be argued.
 *
 * TWO CHIPS, ONE PER REPORT, each saying when it last ran and the date its rows
 * cover to. A report that has never synced says so rather than showing an empty
 * space, which reads as a report that synced and found nothing.
 *
 * A SLOT, not a branch in the card: handed in by the Settings page the same way
 * the Session update row's account list is — see AutomationScheduleCard.
 */

const REPORTS: { value: BackupReport; label: string }[] = [
  { value: 'forward', label: 'Forward' },
  { value: 'return', label: 'Return' }
]

export const AjioReportSyncStatus = ({ running }: { running: boolean }) => {
  const [settings, setSettings] = useState<BackupSettings | null>(null)

  // `running` is a dependency so the chips re-read the moment the task stops,
  // which is the moment they have something new to say.
  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      const response = await backupState()

      if (cancelled || !response.success) return

      setSettings(response.data)
    }

    void load()

    // A sync started anywhere — the schedule, Sync now, a month backup — moves
    // these, and it ends whether or not anyone is on this page.
    const unsubscribe = onBackupFinished(() => void load())

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [running])

  if (!settings) return null

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {REPORTS.map(({ value, label }) => {
        const stamp = settings.lastSyncByReport?.[value] ?? null

        return (
          <li
            key={value}
            title={
              stamp
                ? `${label} report — last synced ${new Date(stamp.at).toLocaleString()}, rows covering up to ${stamp.coveredTo}`
                : `${label} report — nothing has been synced into the backup on this machine yet`
            }
            className={classNames(
              'flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs ring-1',
              stamp
                ? 'bg-surface-sunken text-textSecondary ring-subtle'
                : 'bg-warning-surface text-warning-fg ring-warning-border'
            )}
          >
            {stamp ? (
              <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
            ) : (
              <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
            )}
            <span className="font-medium">{label}</span>
            <span className="truncate opacity-80">
              {stamp ? `${relativeTime(stamp.at)} · data to ${stamp.coveredTo}` : 'never synced'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
