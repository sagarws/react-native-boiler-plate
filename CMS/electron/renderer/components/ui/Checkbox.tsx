// React Imports
import type { ReactNode } from 'react'

// MUI Imports
import MuiCheckbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'

/**
 * The app's checkbox, rebuilt on Monitor's.
 *
 * REBUILT RATHER THAN MIGRATED SCREEN BY SCREEN — same reasoning as Button and
 * Badge: it is rendered on screens that have not had their turn yet, and a
 * hand-drawn box beside a MUI one is the thing that makes a window look like
 * two applications. The props are exactly what they were, so no caller moved.
 *
 * INDETERMINATE stays a first-class state: a "select all" header with some
 * rows ticked is lying when it shows either box. MUI models it the same way.
 */
export const Checkbox = ({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
  ariaLabel
}: {
  checked: boolean
  /** Some but not all children selected — renders a dash, not a tick. */
  indeterminate?: boolean
  onChange: () => void
  /** Rendered beside the box. Omit for a bare control in a table header. */
  label?: ReactNode
  disabled?: boolean
  ariaLabel?: string
}) => {
  const control = (
    <MuiCheckbox
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onChange={() => onChange()}
      inputProps={ariaLabel ? { 'aria-label': ariaLabel } : undefined}
    />
  )

  if (!label) return control

  return <FormControlLabel control={control} label={label} disabled={disabled} />
}
