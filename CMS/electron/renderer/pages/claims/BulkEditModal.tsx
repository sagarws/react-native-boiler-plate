import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import type { BulkFieldOption } from '@shared/types/cmsList'
import { Button } from '@renderer/components/ui/Button'
import { FormField } from '@renderer/components/ui/FormField'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { Select } from '@renderer/components/ui/Select'
import { bulkFieldOptions } from '@renderer/services/cmsList.service'
import { SIX_SIDE_REBUILD_FIELD } from './create/platforms/ajio/sixSideRebuild'

/**
 * An ACTION, not a field the server sets: it builds a PDF from the VMS
 * screenshots on this machine and saves its key. Offered on the AJIO tab only,
 * and kept out of the server's allowlist because there is no value to send.
 */
const AJIO_SIX_SIDE_OPTION: BulkFieldOption = {
  key: SIX_SIDE_REBUILD_FIELD,
  label: 'Six side images (rebuild PDF from VMS)',
  allowEmpty: true
}

/**
 * One field, one value, every claim that was ticked.
 *
 * WHAT IT REPLACES. Correcting the same field on forty rows meant opening
 * forty rows — or editing Mongo by hand, which is scoped to nothing and
 * recorded nowhere.
 *
 * THE FIELD LIST COMES FROM THE SERVER, not from here. The server keeps the
 * allowlist of what may be written, so a list hard-coded in this file would
 * drift the moment the two versions differed — offering a field the backend
 * refuses, or hiding one it now accepts. Asking it also means the vocabulary
 * (the statuses) arrives with the field, so the form offers a picker rather
 * than a text box whose value will be rejected.
 *
 * THE COUNT IS IN THE BUTTON, not only in the heading. This writes to every
 * ticked row at once and cannot be undone; "Update 38 claims" is the last
 * chance to notice it says 38 and not 3.
 */
export const BulkEditModal = ({
  open,
  count,
  platform,
  saving,
  onSubmit,
  onClose
}: {
  open: boolean
  /** How many rows are ticked — shown on the button, because it is the blast radius. */
  count: number
  /** The platform tab; AJIO adds the six-side rebuild. */
  platform: string
  saving: boolean
  onSubmit: (field: string, value: string) => void
  onClose: () => void
}) => {
  const [fields, setFields] = useState<BulkFieldOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [field, setField] = useState('')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!open) return

    let cancelled = false

    // Every setState is INSIDE the promise, not beside it. A synchronous one in
    // an effect body re-renders before this render has committed, which React
    // flags as cascading — and the reset it was doing belongs with the answer
    // anyway: clearing the error before the request means a dialog reopened
    // after a failure flashes clean and then fails again.
    void bulkFieldOptions().then(response => {
      if (cancelled) return

      if (!response.success) {
        /*
         * A 404 HERE MEANS THE BACKEND IS OLDER THAN THIS APP, not that
         * something went wrong with the request.
         *
         * Express answers an unknown path with an HTML page, which carries no
         * `message` for the client to show — so this surfaced as the generic
         * "The request could not be completed" over an empty, unusable
         * dropdown, with nothing to say the feature simply is not deployed
         * yet. That is a diagnosis, and it belongs on the screen rather than in
         * somebody's afternoon.
         */
        setError(
          response.error.code === 'NOT_FOUND'
            ? 'This TrackVid server does not have bulk update yet. It needs updating before this can be used.'
            : response.error.message
        )

        return
      }

      setError(null)
      setFields(response.data)
      // Nothing preselected: the first field in a list is not a choice, and
      // this dialog's whole risk is acting on a field nobody looked at.
      setField('')
      setValue('')
    })

    return () => {
      cancelled = true
    }
  }, [open])

  const isAjio = platform.toLowerCase() === 'ajio'

  const offered = useMemo(
    () => (fields && isAjio ? [...fields, AJIO_SIX_SIDE_OPTION] : fields),
    [fields, isAjio]
  )

  const chosen = useMemo(() => offered?.find(f => f.key === field) ?? null, [offered, field])
  const isSixSide = chosen?.key === SIX_SIDE_REBUILD_FIELD

  // A field that cannot be cleared needs something typed; one that can is
  // allowed to submit empty, because clearing is the point of it.
  const ready = Boolean(chosen) && (chosen?.allowEmpty === true || value.trim().length > 0)

  return (
    <Modal
      open={open}
      title={`Update ${count} claim${count === 1 ? '' : 's'}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={saving}
            disabled={!ready || saving}
            onClick={() => onSubmit(field, value)}
          >
            Update {count} claim{count === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}

        <FormField label="Field">
          {({ id }) => (
            <Select
              size="sm"
              className="is-full"
              id={id}
              value={field}
              disabled={saving || !offered}
              options={[
                { value: '', label: offered ? 'Choose a field…' : 'Loading…' },
                ...(offered ?? []).map(option => ({ value: option.key, label: option.label }))
              ]}
              onChange={event => {
                setField(event.target.value)
                // Cleared with the field: a status carried over into a phone
                // number is a value nobody chose for the field it lands on.
                setValue('')
              }}
            />
          )}
        </FormField>

        {isSixSide && (
          <Typography variant="body2" color="text.secondary">
            For each selected AJIO claim, the VMS screenshots of its return and forward AWB are
            combined into one six-side PDF, which replaces the stored attachment. Claims with
            fewer than 3 side images are skipped. This cannot be undone.
          </Typography>
        )}

        {/* A picker where the field has a vocabulary, a text box where it does
            not — so a status can only ever be one the server accepts. */}
        {!isSixSide && <FormField label="New value">
          {({ id }) =>
            chosen?.options ? (
              <Select
                size="sm"
                className="is-full"
                id={id}
                value={value}
                disabled={saving}
                options={[
                  { value: '', label: 'Choose a value…' },
                  ...chosen.options.map(option => ({ value: option, label: option }))
                ]}
                onChange={event => setValue(event.target.value)}
              />
            ) : (
              <Input
                size="sm"
                className="is-full"
                id={id}
                value={value}
                disabled={saving || !chosen}
                onChange={event => setValue(event.target.value)}
                placeholder={chosen?.allowEmpty ? 'Leave empty to clear' : ''}
              />
            )
          }
        </FormField>}

        {chosen && !isSixSide && (
          <Typography variant="body2" color="text.secondary">
            {chosen.label} will be set to{' '}
            <span className="font-medium text-textPrimary">
              {value.trim() ? value : 'nothing'}
            </span>{' '}
            on all {count} selected claim{count === 1 ? '' : 's'}. This cannot be undone.
          </Typography>
        )}
      </div>
    </Modal>
  )
}
