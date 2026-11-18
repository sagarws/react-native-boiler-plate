import Box from '@mui/material/Box'

/**
 * A tinted rounded-square icon tile — the Veylix template's `.icon-tile`
 * (36px, 11px corner) with its `.tile-*` tones, drawn from the theme so the
 * dark scheme and the operator's primary reach it.
 */
export type IconTileTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'

const TONE: Record<IconTileTone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--mui-palette-Avatar-defaultBg)', fg: 'var(--mui-palette-secondary-dark)' },
  success: { bg: 'var(--mui-palette-success-lightOpacity)', fg: 'var(--mui-palette-success-dark)' },
  // `.tile-amber`: the gold gradient, not a flat tint.
  warning: { bg: 'var(--veylix-tile-amber)', fg: 'var(--veylix-tile-amber-text)' },
  danger: { bg: 'var(--mui-palette-error-lightOpacity)', fg: 'var(--mui-palette-error-dark)' },
  info: { bg: 'var(--mui-palette-info-lightOpacity)', fg: 'var(--mui-palette-info-dark)' },
  primary: { bg: 'var(--mui-palette-primary-lightOpacity)', fg: 'var(--veylix-accent-text)' }
}

export const IconTile = ({ icon, tone = 'neutral', size = 36 }: { icon: string; tone?: IconTileTone; size?: number }) => (
  <Box
    component='span'
    aria-hidden='true'
    sx={{
      display: 'inline-flex',
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      inlineSize: size,
      blockSize: size,
      borderRadius: '11px',
      background: TONE[tone].bg,
      color: TONE[tone].fg,
      fontSize: Math.round(size * 0.55)
    }}
  >
    <i className={icon} />
  </Box>
)
