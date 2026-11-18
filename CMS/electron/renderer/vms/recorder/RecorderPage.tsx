import { useVmsSession } from '@renderer/vms/VmsSessionContext'
import { RecorderView } from './RecorderView'

/**
 * The VMS recorder page — Argos Watch's ManualPage / CaptureShell, in the CMS.
 *
 * The feed session and the local server's port come from the VMS shell
 * (`useVmsSession`); everything below reads them through RecorderView. The
 * page title is the shell's, so none is drawn here.
 */
export const RecorderPage = () => {
  const { session, sidecarPort } = useVmsSession()

  return <RecorderView session={session} sidecarPort={sidecarPort} />
}
