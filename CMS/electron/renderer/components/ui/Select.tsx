// React Imports
import type { SelectHTMLAttributes } from 'react'

// MUI Imports
import MenuItem from '@mui/material/MenuItem'

// Component Imports
import CustomTextField from '@core/components/mui/TextField'

export interface SelectOption {
  value: string
  label: string
}

/**
 * A select, rebuilt on Monitor's.
 *
 * Vuexy has no separate select component: it is `CustomTextField` with
 * `select`, which is what gives it the same height, the same outline and the
 * same menu as every other field in the reference. Rebuilt here for the same
 * reason as Input — the screens that have not been migrated were drawing their
 * own.
 */
type Size = 'sm' | 'md'

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size'> {
  options: readonly SelectOption[]
  invalid?: boolean
  size?: Size
}

export const Select = ({
  options,
  invalid = false,
  size = 'md',
  className,
  value,
  onChange,
  disabled,
  id,
  name,
  'aria-label': ariaLabel
}: SelectProps) => (
  <CustomTextField
    select
    error={invalid}
    size={size === 'sm' ? 'small' : 'medium'}
    fullWidth={size === 'md'}
    className={className}
    value={value ?? ''}
    disabled={disabled}
    id={id}
    name={name}
    // On the element that takes focus — MUI's combobox, not the hidden native
    // input — so a select with no visible label still has an accessible name.
    // It was accepted by the props type and silently dropped before.
    slotProps={ariaLabel ? { select: { SelectDisplayProps: { 'aria-label': ariaLabel } } } : undefined}
    // MUI hands back its own change event; the callers all read
    // `event.target.value`, which is present either way.
    onChange={onChange as never}
  >
    {options.map(option => (
      <MenuItem key={option.value} value={option.value}>
        {option.label}
      </MenuItem>
    ))}
  </CustomTextField>
)
