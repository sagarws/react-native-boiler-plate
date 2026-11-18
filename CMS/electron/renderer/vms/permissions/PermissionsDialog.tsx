import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'

import {
  MEDIA_PERMISSION_KINDS,
  MEDIA_PERMISSION_LABELS,
  hasAllMediaPermissions,
  isMediaPermissionGranted,
  mediaPermissionAction,
  missingMediaPermissions
} from '@shared/vms/mediaPermissions'
import type { MediaPermissionKind, MediaPermissionSnapshot } from '@shared/vms/permissions'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { IconTile } from '@renderer/components/ui/IconTile'
import { Modal } from '@renderer/components/ui/Modal'

import { useMediaPermissions } from '../hooks/useMediaPermissions'

/**
 * The ask for camera and microphone access. Ported from Argos Watch onto the
 * CMS dialog.
 *
 * Consent is an OS decision, so the app asks up front and offers the two routes
 * that work: the system prompt while the OS will still show one, the privacy
 * page once it will not. "Not now" is for an operator who only wants to look
 * around; the recorder can reopen it.
 *
 * The summary line is written here rather than taken from
 * shared/vms/mediaPermissions, whose wording names the old product.
 */
const KIND_ICON: Record<MediaPermissionKind, string> = {
  camera: 'tabler-video',
  microphone: 'tabler-microphone'
}

const summary = (snapshot: MediaPermissionSnapshot): string => {
  const missing = missingMediaPermissions(snapshot)
  if (missing.length === 0) return 'Camera and microphone access are granted.'
  const names = missing.map((kind) => MEDIA_PERMISSION_LABELS[kind].toLowerCase()).join(' and ')
  return mediaPermissionAction(snapshot) === 'prompt'
    ? `TrackVid needs ${names} access to record packing evidence.`
    : `${names.charAt(0).toUpperCase()}${names.slice(1)} access is blocked in your system settings. Turn it on for TrackVid, then re-check.`
}

export const PermissionsDialog = () => {
  const { snapshot, busy, dialogOpen, closeDialog, refresh, request, openSettings } = useMediaPermissions()

  const allGranted = hasAllMediaPermissions(snapshot)
  const action = mediaPermissionAction(snapshot)

  return (
    <Modal
      open={dialogOpen}
      title='Allow TrackVid to record'
      description={summary(snapshot)}
      onClose={closeDialog}
      busy={busy}
      footer={
        <>
          <Button variant='ghost' onClick={closeDialog}>
            {allGranted ? 'Close' : 'Not now'}
          </Button>
          {!allGranted && (
            <>
              <Button
                variant='secondary'
                icon={<i className='tabler-refresh' />}
                disabled={busy}
                onClick={() => void refresh()}
              >
                Re-check
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (action === 'prompt') void request()
                  else void openSettings('camera')
                }}
              >
                {action === 'prompt' ? 'Grant access' : 'Open settings'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        {MEDIA_PERMISSION_KINDS.map((kind) => {
          const granted = isMediaPermissionGranted(snapshot[kind])
          return (
            <div key={kind} className='veylix-tile flex items-center gap-3 pli-3 plb-2.5'>
              <IconTile icon={KIND_ICON[kind]} tone={granted ? 'success' : 'warning'} size={32} />
              <Typography variant='body2' className='flex-1 font-semibold'>
                {MEDIA_PERMISSION_LABELS[kind]}
              </Typography>
              {granted ? (
                <Badge tone='success'>Granted</Badge>
              ) : (
                <Badge tone='warning'>{snapshot[kind] === 'not-determined' ? 'Not asked yet' : 'Blocked'}</Badge>
              )}
              {/* The exact privacy page per row, so a half-granted state does
                  not send the operator to the wrong one. */}
              {!granted && action === 'settings' && snapshot.canOpenSettings && (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy}
                  icon={<i className='tabler-external-link' />}
                  onClick={() => void openSettings(kind)}
                >
                  Open
                </Button>
              )}
            </div>
          )
        })}

        {allGranted && <Alert severity='success'>Access granted. The camera preview will start.</Alert>}

        {!allGranted && action === 'settings' && (
          <Alert severity='info'>
            Turn TrackVid on in the list your system opens, then come back — the check runs again when this
            window regains focus.
          </Alert>
        )}
      </div>
    </Modal>
  )
}
