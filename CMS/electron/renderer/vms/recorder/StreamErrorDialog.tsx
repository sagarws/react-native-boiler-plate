import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { APP_NAME } from '@shared/constants/app'
import type { StreamDiagnostics } from '@shared/vms/stream'

/**
 * What the operator sees when the camera preview fails. Ported from Argos
 * Watch's StreamErrorDialog onto the CMS Modal.
 *
 * Built to be screenshotted and sent to support: the summary on top for the
 * operator, ffmpeg's own output underneath for whoever they forward it to, and
 * one button that copies the lot.
 */
const formatForSupport = (diagnostics: StreamDiagnostics | null, fallback: string): string => {
  if (!diagnostics) return `${APP_NAME} stream error\n${fallback}`

  return [
    `${APP_NAME} stream error`,
    `When:        ${diagnostics.at}`,
    `Camera:      ${diagnostics.rtspUrl ?? 'unknown'}`,
    `Reason:      ${diagnostics.reason}`,
    `Exit code:   ${diagnostics.exitCode ?? '—'}${diagnostics.signal ? ` (signal ${diagnostics.signal})` : ''}`,
    `Bytes:       ${diagnostics.bytesReceived}`,
    `ffmpeg:      ${diagnostics.ffmpegPath}`,
    `ffmpeg from: ${diagnostics.ffmpegSource}${diagnostics.ffmpegUsable ? '' : ' (UNUSABLE)'}`,
    '',
    'ffmpeg output:',
    diagnostics.detail ?? '(none)'
  ].join('\n')
}

export const StreamErrorDialog = ({
  open,
  onClose,
  onRetry,
  diagnostics,
  fallbackMessage
}: {
  open: boolean
  onClose: () => void
  onRetry: () => void
  /** null when the main process has nothing recorded - the UI still renders. */
  diagnostics: StreamDiagnostics | null
  /** Renderer-side message, used when the main process has no record. */
  fallbackMessage: string
}) => {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard
      .writeText(formatForSupport(diagnostics, fallbackMessage))
      .then(() => setCopied(true))
      // Refused clipboard access: the text is on screen either way.
      .catch(() => setCopied(false))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title='Camera stream failed'
      footer={
        <>
          <Button variant='ghost' size='sm' icon={<i className='tabler-copy' />} onClick={copy}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
          <div className='flex-1' />
          <Button variant='secondary' size='sm' onClick={onClose}>
            Close
          </Button>
          <Button
            size='sm'
            icon={<i className='tabler-refresh' />}
            onClick={() => {
              onClose()
              onRetry()
            }}
          >
            Try again
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <Alert severity='error'>
          <Typography variant='body2' sx={{ fontWeight: 600, color: 'inherit' }}>
            {diagnostics?.reason ?? fallbackMessage}
          </Typography>
        </Alert>

        {/* An unusable ffmpeg is not a camera problem, so it gets its own callout. */}
        {diagnostics && !diagnostics.ffmpegUsable && (
          <Alert severity='warning'>
            <Typography variant='body2' sx={{ color: 'inherit' }}>
              The video engine bundled with this installation cannot run on this computer. The camera is not the
              problem — this build needs to be reinstalled from a correct installer.
            </Typography>
          </Alert>
        )}

        {diagnostics && (
          <div>
            <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600 }}>
              Technical detail
            </Typography>
            <Box
              component='pre'
              className='veylix-note font-mono select-text'
              sx={{
                m: 0,
                mt: 0.5,
                p: 1.5,
                maxBlockSize: 220,
                overflow: 'auto',
                fontSize: '0.6875rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {formatForSupport(diagnostics, fallbackMessage)}
            </Box>
          </div>
        )}
      </div>
    </Modal>
  )
}
