import { useCallback, useEffect, useState } from 'react'

import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { ApiProbeResult } from '@shared/vms/probe'
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { LoadingState } from '@renderer/components/data/StateBlocks'
import { useToast } from '@renderer/hooks/useToast'

import { vmsClient } from '../services/vmsClient'

/**
 * What the backend answered when asked just now. Ported from Argos Watch's
 * ApiProbeDialog, opened from the rail's network row.
 *
 * Shown for success AND failure: a status of 0 (the request never got a
 * response) still opens, with the error in the body pane, so the operator has
 * something concrete to show support. JSON bodies are pretty-printed.
 *
 * Self-contained here — it runs the probe when it opens and on "Run again" —
 * where Argos' rail held the probe state for it.
 */
const statusTone = (status: number): BadgeTone => {
  if (status === 0) return 'danger'
  if (status >= 200 && status < 300) return 'success'
  if (status >= 400 && status < 500) return 'warning'
  if (status >= 500) return 'danger'
  return 'neutral'
}

const formatBody = (body: string, contentType: string): string => {
  if (contentType.toLowerCase().includes('json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      // Malformed JSON: show it as it came.
    }
  }
  return body
}

export const ApiProbeDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ApiProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    const response = await vmsClient.probeApi()
    setLoading(false)
    if (response.success) setResult(response.data)
    else setError(response.error.message)
  }, [])

  useEffect(() => {
    if (!open) return
    // The state changes happen after the await inside `run`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run()
  }, [open, run])

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('Response copied'),
      () => toast.error('Clipboard unavailable')
    )
  }

  return (
    <Modal
      open={open}
      title='Connection check'
      description={result ? result.url : 'Asks the TrackVid server for an answer, from this machine.'}
      onClose={onClose}
      size='lg'
      footer={
        <Button variant='secondary' icon={<i className='tabler-refresh' />} loading={loading} onClick={() => void run()}>
          Run again
        </Button>
      }
    >
      {loading && <LoadingState label='Contacting the server…' />}

      {!loading && error && (
        <Typography role='alert' variant='body2' color='error.main'>
          {error}
        </Typography>
      )}

      {!loading && result && (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <Badge tone={statusTone(result.status)}>
              {result.status === 0
                ? `${result.statusText} (no HTTP response)`
                : `${result.status} ${result.statusText}`}
            </Badge>
            <Badge>{`${result.latencyMs} ms`}</Badge>
            <Badge tone={result.reachable ? 'success' : 'danger'}>
              {result.reachable ? 'Transport OK' : 'Transport failed'}
            </Badge>
            {result.contentType && <Badge>{result.contentType}</Badge>}
            <div className='flex-1' />
            <Tooltip title='Copy the response'>
              <span>
                <IconButton size='small' aria-label='Copy the response' disabled={!result.body} onClick={() => copy(result.body)}>
                  <i className='tabler-copy text-lg' />
                </IconButton>
              </span>
            </Tooltip>
          </div>

          <Box
            component='pre'
            className='veylix-tile'
            sx={{
              m: 0,
              p: 4,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.55,
              maxBlockSize: 420,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'text.primary'
            }}
          >
            {result.body.trim() ? formatBody(result.body, result.contentType) : '(empty body)'}
          </Box>
        </div>
      )}
    </Modal>
  )
}
