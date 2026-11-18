// React Imports
import type { ButtonHTMLAttributes, ReactNode } from 'react'

// MUI Imports
import MuiButton from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import type { ButtonProps as MuiButtonProps } from '@mui/material/Button'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse'
type Size = 'sm' | 'md'

/**
 * The app's button, rebuilt on Monitor's.
 *
 * REBUILT RATHER THAN MIGRATED SCREEN BY SCREEN. Thirty-three files render this
 * one component, and while they waited their turn every one of them drew a
 * teal, square-cornered button inside a Vuexy shell — the single most visible
 * "two products in one window" symptom. The props are unchanged, so no caller
 * moved; what changed is what comes out.
 *
 * The old five variants map onto Monitor's, and the mapping is the interesting
 * part:
 *
 *   primary    a contained button in the brand colour — the page's one action
 *   secondary  TONAL, not outlined. Vuexy's secondary surface is a tinted fill,
 *              and an outlined button beside a tonal one reads as a different
 *              family
 *   ghost      text only, for something that must be available and not loud
 *   danger     contained error, which is what "this deletes something" looks
 *              like in the reference
 *   inverse    for a button sitting ON a coloured bar, where the surrounding
 *              text colour is already correct — so it inherits rather than
 *              choosing, which is what made it readable on a red alert
 */
const VARIANTS: Record<Variant, Pick<MuiButtonProps, 'variant' | 'color'>> = {
  primary: { variant: 'contained', color: 'primary' },
  secondary: { variant: 'tonal', color: 'secondary' },
  ghost: { variant: 'text', color: 'secondary' },
  danger: { variant: 'contained', color: 'error' },
  inverse: { variant: 'outlined', color: 'inherit' }
}

const SIZES: Record<Size, MuiButtonProps['size']> = {
  sm: 'small',
  md: 'medium'
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'size'> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  ...rest
}: ButtonProps) => (
  <MuiButton
    {...VARIANTS[variant]}
    size={SIZES[size]}
    // A button that is working is not a button you may press again. The old
    // component made the same promise through its own `loading` prop.
    disabled={disabled ?? loading}
    aria-busy={loading}
    startIcon={loading ? <CircularProgress size={16} color='inherit' /> : icon}
    {...rest}
  >
    {children}
  </MuiButton>
)
