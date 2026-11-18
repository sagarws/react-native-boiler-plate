import { useMemo, type ReactNode } from 'react'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'
import { Button } from '@renderer/components/ui/Button'
import { useCameraOn } from '@renderer/vms/hooks/useCameraOn'
import type { SessionState } from '@shared/vms/auth'
import { OrderCapture } from './OrderCapture'
import { RecorderSessionContext, type RecorderSession } from './RecorderContext'
import { RtspStream } from './RtspStream'

/**
 * The recorder, given a session. Argos Watch's ManualPage: waiting for the
 * feed user → camera off (the rail's switch) → webcam or RTSP by
 * `feed.cameraType`.
 *
 * Kept apart from RecorderPage so the page is only "read useVmsSession() and
 * hand it here", and a preview can hand it a fake. The station guards (idle,
 * storage, date mismatch / camera-date permission) and the media-permission
 * provider + dialog are the VMS shell's, mounted above this.
 */
export interface RecorderViewProps {
  session: SessionState
  sidecarPort: number | null
}

const Card = ({ children }: { children: ReactNode }) => <section className='veylix-glass'>{children}</section>

export const RecorderView = ({ session, sidecarPort }: RecorderViewProps) => {
  const user = session.user
  const [cameraOn, setCameraOn] = useCameraOn()
  const value = useMemo<RecorderSession>(() => ({ user, sidecarPort }), [user, sidecarPort])

  if (!user) {
    return (
      <Card>
        <LoadingState label='Waiting for the feed session…' />
      </Card>
    )
  }

  if (!cameraOn) {
    return (
      <Card>
        <EmptyState
          icon={<i className='tabler-video-off' />}
          title='Camera is off'
          message="Turn it on when you're ready to record. Keeping it off keeps the app light."
          action={
            <Button icon={<i className='tabler-video' />} onClick={() => setCameraOn(true)}>
              Turn on camera
            </Button>
          }
        />
      </Card>
    )
  }

  const usingRtsp = (user.feed?.cameraType ?? 'webcam') === 'rtsp'

  return (
    <RecorderSessionContext.Provider value={value}>
      {usingRtsp ? <RtspStream /> : <OrderCapture />}
    </RecorderSessionContext.Provider>
  )
}
