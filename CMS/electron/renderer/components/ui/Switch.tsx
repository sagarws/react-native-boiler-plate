// React Imports
import type { ReactNode } from 'react'

// MUI Imports
import FormControlLabel from '@mui/material/FormControlLabel'
import MuiSwitch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'

/**
 * An on/off switch, rebuilt on Monitor's.
 *
 * A checkbox says "include this in what I am about to do"; a switch says "this
 * is on now". The difference matters wherever the control IS the setting, which
 * is why the two are still different components rather than one with a prop.
 *
 * Rebuilt for the same reason as Button, Badge and Checkbox: it appears on
 * screens that are still waiting their turn, and it was the last hand-drawn
 * control on the settings page.
 */
export const Switch = ({
  checked,
  onChange,
  label,
  description,
  disabled,
  compact = false
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  /** The consequence, in the operator's terms. Rendered under the label. */
  description?: ReactNode
  disabled?: boolean
  /**
   * Inline, with no description under it — for a dialog header or a toolbar,
   * where the second line would be the largest thing on the line.
   */
  compact?: boolean
}) => {
  const control = (
    <MuiSwitch
      checked={checked}
      disabled={disabled}
      onChange={event => onChange(event.target.checked)}
    />
  )

  /*
   * 13px label, 12px description — the field-title / helper-text pair every
   * other option in a dialog uses. FormControlLabel's default is body1 (14px),
   * which made a switch the one option set a size larger than its neighbours.
   *
   * THE LABEL IS WRAPPED, NOT SET THROUGH `slotProps.typography`. That prop
   * works in development and CRASHES THE PACKAGED BUILD: the renderer's
   * javascript-obfuscator pass turns it into a call to something that is not
   * a function, and Manage Claims rendered blank. Verified by bisecting the
   * obfuscated build. Check `npm run build` output, not just `npm run dev`.
   */
  if (compact || !description) {
    return (
      <FormControlLabel
        control={control}
        label={<Typography variant='body2' component='span'>{label}</Typography>}
        disabled={disabled}
      />
    )
  }

  return (
    <FormControlLabel
      control={control}
      disabled={disabled}
      label={
        <span className='flex flex-col'>
          <Typography variant='body2' component='span' className='font-medium'>
            {label}
          </Typography>
          <Typography variant='caption' component='span' color='text.secondary'>
            {description}
          </Typography>
        </span>
      }
    />
  )
}
