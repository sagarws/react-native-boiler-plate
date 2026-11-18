import { useEffect, useState } from 'react'
import type { CronExecution, ScheduledTaskId } from '@shared/types/automationSchedule'
import { Button } from '@renderer/components/ui/Button'
import { CronHistoryTable } from '@renderer/components/CronHistoryTable'
import { Modal } from '@renderer/components/ui/Modal'
import { taskHistory } from '@renderer/services/automationSchedule.service'

/**
 * Every run of one task, from the local database.
 *
 * WHY IT READS THE DATABASE RATHER THAN THE PUSHED STATE. The card carries the
 * LAST run, which answers "is it working now" and nothing else. The questions
 * that actually get asked — has this been failing all week, did last night's
 * run finish, how long does it usually take — need the rows, and the rows are
 * the only thing that survives the app being closed.
 *
 * A run with no completion is shown as such rather than hidden: it is the
 * signature of the app being killed mid-run, and it is why the tasks after it
 * are blocked.
 */

interface Props {
  open: boolean
  taskId: ScheduledTaskId
  taskLabel: string
  onClose: () => void
}

export const CronHistoryModal = ({ open, taskId, taskLabel, onClose }: Props) => {
  const [rows, setRows] = useState<CronExecution[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    let cancelled = false

    void taskHistory(taskId).then(response => {
      if (cancelled) return

      if (response.success) setRows(response.data)
      else setError(response.error.message)
    })

    return () => {
      cancelled = true
    }
  }, [open, taskId])

  return (
    <Modal
      open={open}
      size="lg"
      title={`History — ${taskLabel}`}
      description="Every run on this machine, newest first."
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {error !== null && <p className="text-sm text-danger-fg">{error}</p>}

      {error === null && rows === null && <p className="text-sm text-muted">Reading the history…</p>}

      {rows !== null && rows.length === 0 && (
        <p className="text-sm text-muted">This has not run on this machine yet.</p>
      )}

      {rows !== null && rows.length > 0 && <CronHistoryTable entries={rows} />}
    </Modal>
  )
}
