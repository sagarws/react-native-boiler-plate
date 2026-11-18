import { useMemo, useState } from 'react'

// MUI Imports
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'

import type { BulkSpfResultRow } from '@shared/types/bulkSpf'
import { BULK_RETRY_SCOPES, isRetryableRow, type BulkRetryScope } from '@shared/utils/bulkRetry'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'

/**
 * What a bulk claim's Retry files again — Failed, Skipped, or both.
 *
 * Whichever is picked, the retry files INTO the same run: the result stays one
 * combined report. The counts come from the same rule the main process files
 * by (`isRetryableRow`), so the number on the option is the number re-filed —
 * less any row the sheet, re-read, still cannot file, which keeps its reason.
 */

interface Props {
  open: boolean
  rows: readonly BulkSpfResultRow[]
  busy: boolean
  onClose: () => void
  onRetry: (scope: BulkRetryScope) => void
}

const OPTIONS: Record<BulkRetryScope, { label: string; blurb: string }> = {
  failed: {
    label: 'Failed',
    blurb: 'Rows AJIO refused or that errored — and any a crashed run never reached.'
  },
  skipped: {
    label: 'Skipped',
    blurb:
      'Rows not filed for a reason outside AJIO — no AJIO login holding the POB, no POB in the sheet, the run stopped. Fix the cause first.'
  },
  both: {
    label: 'Both',
    blurb: 'Every failed and skipped row.'
  }
}

export const RetryScopeModal = ({ open, rows, busy, onClose, onRetry }: Props) => {
  const counts = useMemo(
    () =>
      Object.fromEntries(
        BULK_RETRY_SCOPES.map(scope => [scope, rows.filter(row => isRetryableRow(row, scope)).length])
      ) as Record<BulkRetryScope, number>,
    [rows]
  )

  // Both by default — nothing left behind unless the operator narrows it. The
  // parent remounts this per opening, so every opening starts here again.
  const [scope, setScope] = useState<BulkRetryScope>('both')

  return (
    <Modal
      open={open}
      size="md"
      title="Retry"
      description="Choose which rows to file again. The results go into this same job, so the report stays one combined result."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={busy || counts[scope] === 0}
            icon={<i className="tabler-refresh text-base" />}
            onClick={() => onRetry(scope)}
          >
            Retry {counts[scope]}
          </Button>
        </>
      }
    >
      <RadioGroup
        value={scope}
        onChange={event => setScope(event.target.value as BulkRetryScope)}
        className="flex flex-col gap-2"
      >
        {BULK_RETRY_SCOPES.map(option => (
          <FormControlLabel
            key={option}
            value={option}
            disabled={counts[option] === 0}
            className="m-0 items-start gap-1"
            control={<Radio size="small" className="pbs-0.5" />}
            label={
              <span className="flex flex-col">
                <Typography variant="body2" color="text.primary" className="font-medium">
                  {OPTIONS[option].label} ({counts[option]})
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {OPTIONS[option].blurb}
                </Typography>
              </span>
            }
          />
        ))}
      </RadioGroup>
    </Modal>
  )
}
