import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { MirrorState } from '@shared/vms/partnerVms'

import { mirrorExplanation, mirrorPresentation, type MirrorTone } from '@shared/vms/partnerVmsPresentation'
import { usePartnerVmsStatus } from './usePartnerVms'

/**
 * Live Flipkart mirror state — TrackVid-App's MirrorStatusChip, in the Veylix
 * rail / toolbar style.
 *
 * The packer cannot open the Flipkart page while a recording is in flight, so
 * without this they cannot tell whether the mirror is running: a dot that goes
 * red and pulses the moment their page starts recording, and the instruction
 * to fix it when something needs attention (in the tooltip, which covers the
 * whole chip and opens at once). It never blocks anything.
 *
 * Renders nothing unless the held feed has the mirror.
 */
const TONE_VAR: Record<MirrorTone, string> = {
  success: 'var(--mui-palette-success-main)',
  error: 'var(--mui-palette-error-main)',
  warning: 'var(--mui-palette-warning-main)',
  neutral: 'var(--mui-palette-text-disabled)'
}

const Dot = ({ tone, pulsing }: { tone: MirrorTone; pulsing: boolean }) => (
  <Box
    component='span'
    aria-hidden='true'
    sx={{
      inlineSize: 9,
      blockSize: 9,
      borderRadius: '50%',
      flex: 'none',
      backgroundColor: TONE_VAR[tone],
      boxShadow: pulsing ? `0 0 0 0 ${TONE_VAR[tone]}` : 'none',
      animation: pulsing ? 'partner-vms-rec 1.4s ease-in-out infinite' : 'none',
      '@keyframes partner-vms-rec': {
        '0%, 100%': { opacity: 1, boxShadow: `0 0 0 0 color-mix(in srgb, ${TONE_VAR[tone]} 55%, transparent)` },
        '50%': { opacity: 0.55, boxShadow: `0 0 0 4px color-mix(in srgb, ${TONE_VAR[tone]} 0%, transparent)` }
      }
    }}
  />
)

export const MirrorStatusPill = ({
  state,
  variant = 'rail'
}: {
  state: MirrorState
  /** 'rail': a full-width row under the VMS menu. 'inline': a pill in the recorder toolbar. */
  variant?: 'rail' | 'inline'
}) => {
  const { tone, label, nudge } = mirrorPresentation(state)
  const recording = state === 'MIRRORING'
  const attention = Boolean(nudge) || recording
  const toneVar = TONE_VAR[tone]

  return (
    <Tooltip title={mirrorExplanation(state)} placement={variant === 'rail' ? 'right' : 'top'} enterDelay={100} arrow>
      <Box
        role='status'
        aria-label={`Flipkart mirror: ${label}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'help',
          whiteSpace: 'nowrap',
          border: '1px solid',
          borderColor: attention ? `color-mix(in srgb, ${toneVar} 45%, transparent)` : 'var(--veylix-glass-border)',
          backgroundColor: attention ? `color-mix(in srgb, ${toneVar} 10%, transparent)` : 'var(--veylix-control)',
          ...(variant === 'rail'
            ? { inlineSize: '100%', paddingInline: '10px', blockSize: 34, borderRadius: '11px' }
            : { paddingInline: '10px', blockSize: 30, borderRadius: 999 })
        }}
      >
        {variant === 'rail' && (
          <i
            className='tabler-camera-share text-lg'
            aria-hidden='true'
            style={{ color: recording ? toneVar : 'var(--veylix-nav-text)' }}
          />
        )}
        <Typography
          component='span'
          sx={{
            flex: 'none',
            fontSize: variant === 'rail' ? '0.8125rem' : 12,
            fontWeight: 600,
            color: variant === 'rail' ? 'var(--veylix-nav-text)' : 'text.secondary'
          }}
        >
          Flipkart
        </Typography>
        {variant === 'rail' && <span className='flex-1' />}
        <Dot tone={tone} pulsing={recording} />
        <Typography
          component='span'
          sx={{
            fontSize: variant === 'rail' ? '0.8125rem' : 12,
            fontWeight: recording ? 750 : 600,
            // Long states ("Feed not connected") ellipsize in the rail; the
            // tooltip carries the whole instruction.
            minInlineSize: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            // Mixed toward the text colour so amber stays readable in light mode.
            color:
              tone === 'neutral'
                ? 'text.secondary'
                : `color-mix(in srgb, ${toneVar} 78%, var(--mui-palette-text-primary))`
          }}
        >
          {recording && variant === 'rail' ? 'REC' : label}
        </Typography>
      </Box>
    </Tooltip>
  )
}

/** The chip bound to the live status. Null on desks without the mirror. */
export const MirrorStatusChip = ({ variant = 'rail' }: { variant?: 'rail' | 'inline' }) => {
  const { enabled, status } = usePartnerVmsStatus()
  if (!enabled) return null
  return <MirrorStatusPill state={status.state} variant={variant} />
}
