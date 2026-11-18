// React Imports
import type { InputHTMLAttributes } from 'react'

// Component Imports
import CustomTextField from '@core/components/mui/TextField'

/**
 * A text field, rebuilt on Monitor's.
 *
 * `CustomTextField` is Vuexy's filled-outline field — the one every input in
 * the reference is. Rebuilt here rather than screen by screen so the screens
 * still waiting their turn stop showing a differently-shaped box beside a
 * migrated one.
 *
 * The props are what they were: `size` is the old two-step scale, `invalid`
 * becomes MUI's `error`, and everything else is a native input attribute that
 * MUI forwards.
 */
type Size = 'sm' | 'md'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean
  size?: Size
}

export const Input = ({ invalid = false, size = 'md', className, ...rest }: InputProps) => (
  /*
   * The caller's props go to the FIELD, not into `inputProps`.
   *
   * `value`, `onChange`, `placeholder`, `type` and `disabled` are props MUI's
   * TextField owns and forwards to the input itself — pushing them through
   * `inputProps` instead controls the inner element while leaving the field
   * around it unaware of its own state. Anything MUI does not recognise lands
   * on the wrapper, where a bubbled `onKeyDown` still arrives.
   */
  <CustomTextField
    {...(rest as Record<string, unknown>)}
    error={invalid}
    size={size === 'sm' ? 'small' : 'medium'}
    // `md` filled the line it was on; MUI needs telling.
    fullWidth={size === 'md'}
    className={className}
  />
)
