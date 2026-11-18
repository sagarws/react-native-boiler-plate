import { useState } from 'react'

import Typography from '@mui/material/Typography'

import type { MailboxSummary } from '@shared/types/emailReply'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import { updateMailboxLastSync } from '@renderer/services/emailReply.service'
import { formatDateTime } from '@renderer/utils/format'

/** `<input type="datetime-local">` speaks local wall-clock time, without a zone. */
const toLocalInput = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * Moves a mailbox's last-sync date.
 *
 * WHAT IT IS FOR: the next fetch — TrackVid's, or a Refetch from here — reads
 * the mailbox from this date again. Earlier picks up AJIO requests a sync
 * missed; nothing already answered is answered twice, because TrackVid keeps
 * each email's status and skips anything replied.
 *
 * A date in the future would mean "fetch nothing" until the clock caught up,
 * so the field stops at now, and the main process and TrackVid both refuse it.
 */
export const LastSyncDialog = ({
  mailbox,
  onClose,
  onSaved
}: {
  mailbox: MailboxSummary
  onClose: () => void
  onSaved: () => void
}) => {
  const toast = useToast()
  const [value, setValue] = useState(() =>
    toLocalInput(mailbox.lastSyncedAt ? new Date(mailbox.lastSyncedAt) : new Date())
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const max = toLocalInput(new Date())

  const save = async (): Promise<void> => {
    const picked = new Date(value)

    if (!value || Number.isNaN(picked.getTime())) {
      setError('Choose a date and time')

      return
    }

    setSaving(true)
    setError(null)

    const response = await updateMailboxLastSync(mailbox.id, picked.toISOString())

    setSaving(false)

    if (!response.success) {
      // Kept in the dialog: the operator is looking at the field it is about.
      setError(response.error.message)

      return
    }

    toast.success(`${mailbox.email}: last sync set to ${formatDateTime(picked.toISOString())}`)
    onSaved()
    onClose()
  }

  return (
    <Modal
      open
      title='Edit last sync date'
      description={mailbox.email}
      onClose={onClose}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        <Typography variant='body2' color='text.secondary'>
          The next fetch reads this mailbox from this date. Set it earlier to pick up AJIO requests a
          sync missed — anything already replied to is not answered again.
        </Typography>
        <Input
          type='datetime-local'
          aria-label='Last sync date and time'
          value={value}
          max={max}
          invalid={error !== null}
          onChange={event => {
            setValue(event.target.value)
            setError(null)
          }}
        />
        {mailbox.lastSyncedAt && (
          <Typography variant='caption' color='text.secondary'>
            Currently {formatDateTime(mailbox.lastSyncedAt)}
          </Typography>
        )}
        {error && (
          <Typography variant='body2' color='error'>
            {error}
          </Typography>
        )}
      </div>
    </Modal>
  )
}
