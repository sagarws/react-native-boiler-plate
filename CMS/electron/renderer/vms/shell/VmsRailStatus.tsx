import { useState, type ReactNode } from 'react'

import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import MuiSwitch from '@mui/material/Switch'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { useCameraOn } from '../hooks/useCameraOn'
import { useNetworkStatus, type NetworkState } from '../hooks/useNetworkStatus'
import { useQueueCounts } from '../hooks/useQueueCounts'
import { useUsage } from '../hooks/useUsage'
import { FailedUploadsDialog } from '../queue/FailedUploadsDialog'
import { ApiProbeDialog } from '../system/ApiProbeDialog'
import { MirrorStatusChip } from '../partnerVms/MirrorStatusChip'

/**
 * The VMS half of Argos Watch's rail, under the menu: the connection, the
 * upload queue, the credits left and the camera switch — the things a packer
 * glances at between parcels. Settings and Sign out stay the CMS's (the
 * account menu), and the version is the shell's own line.
 *
 * Mounted only in VMS mode, so the network probe and the queue subscription
 * do not run while the operator is in the CMS.
 *
 * The rail's RTSP zoom slider is not here: Argos ships it switched off
 * ("FEATURE DISABLED"), so there is nothing to carry over.
 */
const NETWORK: Record<NetworkState, { icon: string; label: string; hint: string; color: string }> = {
  online: {
    icon: 'tabler-wifi',
    label: 'Online',
    hint: 'Connected to TrackVid — click to see the server’s answer',
    color: 'success.main'
  },
  offline: {
    icon: 'tabler-wifi-off',
    label: 'Offline',
    hint: 'No route to TrackVid — recordings will queue on this machine',
    color: 'error.main'
  },
  probing: { icon: 'tabler-antenna-bars-3', label: 'Checking…', hint: 'Checking the connection…', color: 'warning.main' }
}

const Row = ({ children, onClick, hint }: { children: ReactNode; onClick?: () => void; hint: string }) => (
  <Tooltip title={hint} placement='right'>
    <ButtonBase
      component={onClick ? 'button' : 'div'}
      disabled={!onClick}
      onClick={onClick}
      sx={{
        inlineSize: '100%',
        justifyContent: 'flex-start',
        gap: '9px',
        paddingInline: '9px',
        blockSize: 34,
        borderRadius: '11px',
        color: 'var(--veylix-nav-text)',
        fontSize: '0.8125rem',
        fontWeight: 600,
        '&.Mui-disabled': { color: 'var(--veylix-nav-text)' },
        '&:hover': onClick ? { background: 'var(--veylix-nav-hover)' } : undefined
      }}
    >
      {children}
    </ButtonBase>
  </Tooltip>
)

const Stat = ({
  value,
  label,
  tone,
  onClick,
  hint
}: {
  value: number
  label: string
  tone: 'neutral' | 'danger'
  onClick?: (() => void) | undefined
  hint: string
}) => (
  <Tooltip title={hint} placement='top'>
    <span className='flex flex-1 min-is-0'>
      <ButtonBase
        disabled={!onClick}
        onClick={onClick}
        aria-label={`${value} ${label}`}
        sx={{
          flex: 1,
          flexDirection: 'column',
          gap: '2px',
          paddingBlock: '7px',
          borderRadius: '11px',
          border: '1px solid',
          borderColor: tone === 'danger' ? 'var(--mui-palette-error-lightOpacity)' : 'var(--veylix-glass-border)',
          background: tone === 'danger' ? 'var(--mui-palette-error-lighterOpacity)' : 'var(--veylix-control)',
          '&:hover': onClick ? { borderColor: 'var(--mui-palette-error-main)' } : undefined
        }}
      >
        <Typography
          component='span'
          className='tabular-nums'
          sx={{ fontSize: 15, fontWeight: 750, lineHeight: 1.1, color: tone === 'danger' ? 'error.main' : 'text.primary' }}
        >
          {value}
        </Typography>
        <Typography component='span' sx={{ fontSize: 11, fontWeight: 600, color: tone === 'danger' ? 'error.dark' : 'text.secondary' }}>
          {label}
        </Typography>
      </ButtonBase>
    </span>
  </Tooltip>
)

export const VmsRailStatus = () => {
  const network = useNetworkStatus()
  const queue = useQueueCounts()
  const usage = useUsage(queue.synced)
  const [cameraOn, setCameraOn] = useCameraOn()
  const [probeOpen, setProbeOpen] = useState(false)
  const [failedOpen, setFailedOpen] = useState(false)

  const net = NETWORK[network]
  const pending = queue.unsynced + queue.syncing

  return (
    <>
      <div className='flex flex-col gap-2 whitespace-normal'>
        <Row hint={net.hint} onClick={() => setProbeOpen(true)}>
          <Box
            component='i'
            aria-hidden='true'
            className={`${net.icon} text-xl`}
            sx={{
              color: net.color,
              animation: network === 'probing' ? 'vms-network-pulse 1.4s ease-in-out infinite' : 'none',
              '@keyframes vms-network-pulse': { '0%, 100%': { opacity: 0.5 }, '50%': { opacity: 1 } }
            }}
          />
          <span className='flex-1 text-start'>{net.label}</span>
          <i className='tabler-chevron-right text-sm' aria-hidden='true' />
        </Row>

        {/* The upload queue. Failed opens the list; pending is the driver's
            business and only counts down. */}
        <div className='flex gap-2'>
          <Stat
            value={pending}
            label='Pending'
            tone='neutral'
            hint={queue.syncing > 0 ? `${queue.syncing} uploading now` : 'Waiting to upload'}
          />
          <Stat
            value={queue.failed}
            label='Failed'
            tone={queue.failed > 0 ? 'danger' : 'neutral'}
            onClick={queue.failed > 0 ? () => setFailedOpen(true) : undefined}
            hint={queue.failed > 0 ? 'Open the failed uploads' : 'Nothing has failed'}
          />
        </div>

        {/* Flipkart VMS mirror — only on a feed that has it. The packer
            cannot open the Flipkart page mid-order, so this is how they see
            both systems rolling. */}
        <MirrorStatusChip />

        {usage && (
          <Row hint={`${usage.credit.used.toLocaleString()} used of ${usage.credit.total.toLocaleString()}`}>
            <i className='tabler-coins text-xl' aria-hidden='true' />
            <span className='flex-1 text-start'>Credits</span>
            <span className='tabular-nums' style={{ color: 'var(--mui-palette-text-primary)' }}>
              {usage.credit.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </Row>
        )}

        {/* Argos' Camera On / Off: the recorder keeps its preview closed while
            off. Same storage key and event as the recorder reads. */}
        <Box
          className='flex items-center'
          sx={{ gap: '9px', paddingInlineStart: '9px', blockSize: 34, color: 'var(--veylix-nav-text)', fontSize: '0.8125rem', fontWeight: 600 }}
        >
          <i className={`${cameraOn ? 'tabler-video' : 'tabler-video-off'} text-xl`} aria-hidden='true' />
          <span className='flex-1'>{cameraOn ? 'Camera on' : 'Camera off'}</span>
          <MuiSwitch
            size='small'
            checked={cameraOn}
            onChange={(event) => setCameraOn(event.target.checked)}
            slotProps={{ input: { 'aria-label': 'Camera' } }}
          />
        </Box>
      </div>

      {probeOpen && <ApiProbeDialog open={probeOpen} onClose={() => setProbeOpen(false)} />}
      {failedOpen && <FailedUploadsDialog open={failedOpen} onClose={() => setFailedOpen(false)} />}
    </>
  )
}
