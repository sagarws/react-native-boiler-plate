import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Clock } from 'lucide-react'
import type { FlipkartBackupState, FlipkartReport } from '@shared/types/flipkartBackup'
import { relativeTime } from '@shared/utils/sessionHealth'
import { flipkartBackupState } from '@renderer/services/flipkartBackup.service'
import { classNames } from '@renderer/utils/format'

/**
 * Where the Flipkart backup has got to, under the schedule row.
 *
 * Snapdeal's two questions, for two reports: how far each report's rows reach,
 * and how many requests Flipkart is still building. A pass that stored nothing
 * is usually the system working — the reports it asked for take about half an
 * hour — so "waiting" is shown on its own and never as a warning.
 */

const LABEL: Record<FlipkartReport, string> = { forward: 'Orders', return: 'Returns' }

export const FlipkartReportSyncStatus = ({ running }: { running: boolean }) => {
  const [state, setState] = useState<FlipkartBackupState | null>(null)

  // `running` is a dependency so the chips re-read the moment the task stops.
  useEffect(() => {
    let cancelled = false

    void flipkartBackupState().then(answer => {
      if (!cancelled && answer.success) setState(answer.data)
    })

    return () => {
      cancelled = true
    }
  }, [running])

  if (!state) return null

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {state.reports.map(report => {
        const held = report.rows > 0

        return (
          <li
            key={report.report}
            title={
              held
                ? `${report.rows.toLocaleString()} row(s), ${report.from} → ${report.to}` +
                  (state.lastStoredAt ? `; last stored ${new Date(state.lastStoredAt).toLocaleString()}` : '')
                : `No Flipkart ${LABEL[report.report]} report has been collected on this machine yet`
            }
            className={classNames(
              'flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs ring-1',
              held
                ? 'bg-surface-sunken text-textSecondary ring-subtle'
                : 'bg-warning-surface text-warning-fg ring-warning-border'
            )}
          >
            {held ? (
              <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
            ) : (
              <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
            )}
            <span className="font-medium">{LABEL[report.report]}</span>
            <span className="truncate opacity-80">
              {held
                ? `${report.rows.toLocaleString()} rows · data to ${report.to}` +
                  (state.lastStoredAt ? ` · ${relativeTime(state.lastStoredAt)}` : '')
                : 'nothing collected yet'}
            </span>
          </li>
        )
      })}

      {state.outstanding > 0 && (
        <li
          title="Reports asked for that Flipkart has not finished building, or that have not been downloaded yet"
          className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-2xs text-textSecondary ring-1 ring-subtle"
        >
          <Clock size={12} className="shrink-0" aria-hidden="true" />
          <span className="font-medium">{state.outstanding}</span>
          <span className="opacity-80">waiting at Flipkart</span>
        </li>
      )}
    </ul>
  )
}
