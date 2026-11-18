import type { ReactNode } from 'react'

import Card from '@mui/material/Card'
import Typography from '@mui/material/Typography'

import { IconTile, type IconTileTone } from '@renderer/components/ui/IconTile'

/**
 * The shape every VMS guard takes: one glass card, centred in the content,
 * with a tinted icon, a heavy title, the explanation and the way out.
 *
 * Argos Watch drew these as full-window pages with their own hex colours. Here
 * they replace the recorder inside the shell — the rail stays, so the operator
 * can still reach the CMS, but there is no recording until the condition is
 * dealt with.
 */
export const GuardPanel = ({
  icon,
  tone,
  title,
  message,
  actions
}: {
  icon: string
  tone: IconTileTone
  title: string
  message: string
  actions: ReactNode
}) => (
  <div className='flex flex-1 items-start justify-center pbs-6'>
    <Card
      className='flex flex-col items-center gap-3 text-center'
      sx={{ inlineSize: 'min(560px, 100%)', paddingInline: '40px', paddingBlock: '40px 36px' }}
    >
      <IconTile icon={icon} tone={tone} size={56} />
      <Typography variant='h4' component='h2' className='mbs-2' sx={{ fontWeight: 750, letterSpacing: '-0.02em' }}>
        {title}
      </Typography>
      <Typography variant='body1' color='text.secondary' sx={{ maxInlineSize: 440, lineHeight: 1.7 }}>
        {message}
      </Typography>
      <div className='flex items-center gap-2 mbs-4'>{actions}</div>
    </Card>
  </div>
)
