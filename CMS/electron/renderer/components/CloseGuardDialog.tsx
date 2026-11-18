// React Imports
import { useEffect, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'

// Component Imports
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

// Service Imports
import { closeGuardClient } from '../services/closeGuard.service'

export interface CloseGuardDialogProps {
  /** Opens the Background Process page, where the run can be watched. */
  onOpenJobs: () => void
}

/**
 * "An automation is still running" — asked when the window is closed mid-run.
 *
 * The app's own dialog rather than the operating system's: it looks like the
 * rest of the app, names what is running, and offers the one useful next step
 * (watch it) beside the two answers. Main falls back to the system box only
 * when this does not acknowledge the request — see windows/closeGuard.ts.
 */
export const CloseGuardDialog = ({ onOpenJobs }: CloseGuardDialogProps) => {
  const [holder, setHolder] = useState<string | null>(null)
  const [quitting, setQuitting] = useState(false)

  useEffect(
    () =>
      closeGuardClient.onRequested(request => {
        setHolder(request.holder)
        setQuitting(false)
        void closeGuardClient.ack()
      }),
    []
  )

  const wait = () => setHolder(null)

  const watch = () => {
    setHolder(null)
    onOpenJobs()
  }

  const quit = () => {
    if (!holder) return

    setQuitting(true)
    void closeGuardClient.quit({ holder }).then(result => {
      // Closing ends this page; still here means main refused, so let the
      // operator try again rather than leave a spinner up.
      if (!result.success) setQuitting(false)
    })
  }

  return (
    <Modal
      open={holder !== null}
      title='Close TrackVid CMS?'
      description={holder ? `${holder} is still running.` : undefined}
      onClose={wait}
      busy={quitting}
      footer={
        <>
          <Button
            variant='ghost'
            icon={<i className='tabler-history' />}
            onClick={watch}
            disabled={quitting}
            className='mie-auto'
          >
            View Background Process
          </Button>
          <Button variant='secondary' onClick={quit} loading={quitting}>
            Quit anyway
          </Button>
          <Button variant='primary' onClick={wait} disabled={quitting} autoFocus>
            Keep running
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <Alert severity='warning' icon={<i className='tabler-alert-triangle' />}>
          Closing now can stop it part-way through.
        </Alert>
        <Typography variant='body2' color='text.secondary' className='max-w-prose'>
          A claim that was being filed may already exist on the marketplace without this app
          recording it, and the next run would file it again. Keep the app open until the run
          finishes.
        </Typography>
        <Typography variant='body2' color='text.secondary' className='max-w-prose'>
          If you quit anyway, the step in progress finishes and nothing new is started.
        </Typography>
      </div>
    </Modal>
  )
}
