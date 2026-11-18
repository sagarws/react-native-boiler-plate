// React Imports
import type { ReactNode } from 'react'

// Component Imports
import CustomChip from '@core/components/mui/Chip'

// Type Imports
import type { ThemeColor } from '@core/types'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/**
 * A status word, in Monitor's chip.
 *
 * REBUILT ON MUI RATHER THAN MIGRATED SCREEN BY SCREEN. Five screens render
 * this and only one of them has been migrated so far, which meant the same
 * status — "Expired", "Saved", "Rejected" — was a rounded rectangle on one
 * screen and a tonal chip on the next. Rebuilding the shared component fixes
 * every caller at once and leaves their markup untouched: the props are
 * exactly what they were.
 *
 * `tone` is the old system's vocabulary and stays, because thirty call sites
 * speak it. It is translated to the theme's colours here, in one place, the
 * same way the dashboard translates session health.
 *
 * `info` IS THE FIFTH WORD, added rather than repurposed. The vocabulary had
 * four, none of which meant "in flight but not a warning", so "In Review" was
 * filed under `warning` — which put it in amber on the claims table while the
 * dashboard, which uses the theme colours directly and therefore HAS an info,
 * drew the same status in blue. Two screens, one status, two colours, and no
 * way to fix it without a word for it.
 */
const TONE_COLOR: Record<BadgeTone, ThemeColor> = {
  neutral: 'secondary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error'
}

export const Badge = ({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) => (
  <CustomChip size='small' variant='tonal' color={TONE_COLOR[tone]} label={children} />
)
