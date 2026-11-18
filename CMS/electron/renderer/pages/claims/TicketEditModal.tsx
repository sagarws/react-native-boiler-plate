import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import type { CmsRow } from '@shared/types/cmsList'
import { MAX_TICKET_LENGTH } from '@shared/constants/claims'
import { Button } from '@renderer/components/ui/Button'
import { FormField } from '@renderer/components/ui/FormField'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { updateClaimTicket } from '@renderer/services/cmsList.service'

/**
 * Add or correct one claim's ticket number — for a claim filed by hand on the
 * marketplace, or a number the automation recorded wrong.
 *
 * SAYS WHAT HAPPENS TO THE STATUS. Saving moves a Pending or Failed to Proceed
 * claim to In Review, which takes it off the filing queue: that is the effect
 * that matters, so it is stated before the button rather than discovered after.
 *
 * Keyed by the row in the caller, so each opening starts from that row's value.
 */
export const TicketEditModal = ({
  row,
  onClose,
  onSaved
}: {
  /** The claim being edited; null when closed. */
  row: CmsRow | null
  onClose: () => void
  onSaved: (ticket: string) => void
}) => {
  const [ticket, setTicket] = useState(row?.ticket ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = ticket.trim()
  const unchanged = value === (row?.ticket ?? '').trim()
  const ready = value.length > 0 && value.length <= MAX_TICKET_LENGTH && !unchanged
  const moves = row !== null && row.status !== 'In Review'

  const save = async (): Promise<void> => {
    if (!row || !ready) return

    setSaving(true)
    setError(null)

    const response = await updateClaimTicket({ cmsId: row.id, ticket: value, status: row.status })

    setSaving(false)

    if (!response.success) {
      setError(response.error.message)

      return
    }

    onSaved(response.data.ticket)
  }

  return (
    <Modal
      open={row !== null}
      title={row?.ticket ? 'Update ticket' : 'Add ticket'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button size='sm' variant='secondary' onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size='sm' loading={saving} disabled={!ready || saving} onClick={() => void save()}>
            {row?.ticket ? 'Update ticket' : 'Add ticket'}
          </Button>
        </>
      }
    >
      <form
        className='flex flex-col gap-4'
        onSubmit={event => {
          event.preventDefault()
          void save()
        }}
      >
        {error && (
          <Alert severity='error' role='alert'>
            {error}
          </Alert>
        )}

        <Typography variant='body2' color='text.secondary'>
          {row?.platform} · {row?.returnAwb || row?.id}
        </Typography>

        <FormField label='Ticket number'>
          {({ id }) => (
            <Input
              size='sm'
              className='is-full'
              id={id}
              value={ticket}
              autoFocus
              disabled={saving}
              // Not `maxLength`: Input hands unknown props to the field's
              // wrapper, not the input, so the limit is shown instead.
              invalid={value.length > MAX_TICKET_LENGTH}
              onChange={event => setTicket(event.target.value)}
            />
          )}
        </FormField>

        <Typography variant='body2' color='text.secondary'>
          {moves ? (
            <>
              The claim moves from <span className='font-medium text-textPrimary'>{row?.status}</span> to{' '}
              <span className='font-medium text-textPrimary'>In Review</span>, and nothing will file it again.
            </>
          ) : (
            'The claim stays In Review; only the ticket number changes.'
          )}
        </Typography>
      </form>
    </Modal>
  )
}
