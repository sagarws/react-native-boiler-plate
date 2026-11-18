import { useState } from 'react'
import { SkipForward } from 'lucide-react'
import type { ScheduledTaskId } from '@shared/types/automationSchedule'
import { useToast } from '@renderer/hooks/useToast'
import { skipRunningPlatform } from '@renderer/services/automationSchedule.service'

/**
 * "Leave this marketplace and get on with the next one."
 *
 * WHY IT SITS ON THE CHIP. The Skip already on the task abandons the whole
 * run: one slow marketplace and the other six go unasked. What an operator
 * wants at 02:00 is narrower — Myntra is grinding through 580 rows, or one
 * marketplace is timing out on every claim — and the chip is where they are
 * already looking when they decide it.
 *
 * TAKES EFFECT AT THE NEXT ROW, not instantly, and the toast says so. A claim
 * half-filed is how a ticket is created on a marketplace with nothing here
 * recording it, so every loop reading this checks between rows. One row is a
 * wait an operator will accept; a marketplace is not.
 *
 * NO CONFIRM. It is reversible in the only sense that matters — nothing is
 * attempted, no attempt is charged, and the rows file normally on the next
 * run — so a dialog would cost more than the mistake.
 */
export const SkipPlatformButton = ({
  taskId,
  platform,
  label
}: {
  taskId: ScheduledTaskId
  /** The platform KEY. A label here is a skip that silently does nothing. */
  platform: string
  label: string
}) => {
  const toast = useToast()
  const [asked, setAsked] = useState(false)

  const skip = async (): Promise<void> => {
    setAsked(true)

    const response = await skipRunningPlatform(taskId, platform)

    if (!response.success) {
      setAsked(false)
      toast.error(response.error.message)

      return
    }

    toast.info(`${label} will be passed over after the row in hand.`)
  }

  return (
    <button
      type='button'
      disabled={asked}
      onClick={() => void skip()}
      title={`Pass over ${label} and carry on with the rest`}
      aria-label={`Skip ${label}`}
      className='ms-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium ring-1 ring-current/30 transition-opacity hover:opacity-80 disabled:opacity-50'
    >
      <SkipForward size={10} aria-hidden='true' />
      {asked ? 'Skipping' : 'Skip'}
    </button>
  )
}
