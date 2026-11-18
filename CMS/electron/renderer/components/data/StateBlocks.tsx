import type { ReactNode } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { Button } from '@renderer/components/ui/Button'

/*
 * LOADING / EMPTY / ERROR, in the Veylix template's `.c-empty` shape: centred,
 * a gold-tinted glyph, a 19px heavy title, a secondary paragraph capped at
 * 420px, the action below. Props are exactly what they were.
 */
const Frame = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-5 py-14 text-center">
    {children}
  </div>
)

const TITLE_SX = { fontSize: '1.1875rem', fontWeight: 750, color: 'var(--veylix-empty-title)' } as const
const BODY_SX = { maxInlineSize: 420, lineHeight: 1.7 } as const

export const LoadingState = ({ label = 'Loading…' }: { label?: string }) => (
  <Frame>
    <CircularProgress aria-hidden="true" size={26} thickness={4.5} sx={{ color: 'primary.main' }} />
    <Typography role="status" variant="body2" color="text.secondary" className="mbs-2">
      {label}
    </Typography>
  </Frame>
)

export const EmptyState = ({
  title,
  message,
  action,
  icon
}: {
  title: string
  message: string
  action?: ReactNode
  /** One glyph above the words. Optional — a state with nothing to draw
      should not draw a placeholder box instead. */
  icon?: ReactNode
}) => (
  <Frame>
    {icon && (
      <span aria-hidden="true" className="mbe-1 flex text-4xl" style={{ color: 'var(--veylix-empty-icon)' }}>
        {icon}
      </span>
    )}
    <Typography variant="h5" component="h3" sx={TITLE_SX}>
      {title}
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={BODY_SX}>
      {message}
    </Typography>
    {action && <div className="mbs-3">{action}</div>}
  </Frame>
)

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <Frame>
    <span aria-hidden="true" className="mbe-1 flex text-4xl" style={{ color: 'var(--mui-palette-error-main)' }}>
      <i className="tabler-alert-circle" />
    </span>
    <Typography variant="h5" component="h3" sx={{ ...TITLE_SX, color: 'error.dark' }}>
      Something went wrong
    </Typography>
    <Typography role="alert" variant="body2" color="text.secondary" sx={BODY_SX}>
      {message}
    </Typography>
    {onRetry && (
      <div className="mbs-3">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )}
  </Frame>
)
