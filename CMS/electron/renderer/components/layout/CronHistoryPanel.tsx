import { useEffect, useState } from 'react'
import type { CronExecution } from '@shared/types/automationSchedule'
import { CronHistoryTable } from '@renderer/components/CronHistoryTable'
import { taskHistory } from '@renderer/services/automationSchedule.service'

/**
 * Every run of every task, newest first.
 *
 * THE THIRD QUESTION. The task list says what the state is; the log says what
 * the scheduler decided; this says what actually HAPPENED — four tasks a night,
 * with their times, their outcomes and how long each took. Read end to end it
 * is the answer to "has this machine been doing its job", which neither of the
 * other two can give: one is a snapshot, the other is reasoning.
 *
 * Read on open rather than pushed. A finished run is not going to change, and
 * a table that reordered itself under somebody reading it would be worse than
 * one that is a minute old.
 */
export const CronHistoryPanel = () => {
  const [entries, setEntries] = useState<CronExecution[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // No task id: every task, merged and sorted by the main process.
    void taskHistory().then(response => {
      if (cancelled) return

      if (response.success) setEntries(response.data)
      else setError(response.error.message)
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (error !== null) return <p className='text-sm text-danger-fg'>{error}</p>

  if (entries === null) return <p className='text-xs text-muted'>Reading the history…</p>

  if (entries.length === 0) {
    return (
      <p className='text-xs text-muted'>
        Nothing has run on this machine yet. A row appears here each time a task starts.
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <p className='text-xs text-muted'>
        {entries.length} run{entries.length === 1 ? '' : 's'} on this machine, newest first.
      </p>
      <CronHistoryTable entries={entries} showTask />
    </div>
  )
}
