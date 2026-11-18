// React Imports
import type { ReactNode } from 'react'

// MUI Imports
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

// Shared Imports
import type { UpdateState } from '@shared/types/update'

// Component Imports
import CustomAvatar from '@core/components/mui/Avatar'
import { Button } from '@renderer/components/ui/Button'

// Hook Imports
import { useAuth } from '@renderer/hooks/useAuth'

/**
 * Read-only profile of the signed-in user, plus the build/version card that
 * shows how this installation compares to `trackVidCmsVersion` on the server.
 *
 * Editing lives in the TrackVid web admin, so this page deliberately offers no
 * form — it would be a second source of truth for the same record.
 *
 * MIGRATED to the ported design system, following TrackVid-Monitor's own user
 * view: an avatar over the name, then a "Details" list of label/value pairs.
 * Internal identifiers (role, company and user ids, sign-in time) are left out:
 * they mean nothing to an operator and are one screenshot away from a ticket.
 */

/**
 * One label/value pair, in Monitor's shape.
 *
 * A pair rather than a two-column grid, which is what this was. The grid held a
 * 10rem label column, so every value on the page started at the same place —
 * tidy, and the reference does not do it: its rows are as wide as their own
 * content, which reads as prose and wraps properly when a value is long.
 */
const Detail = ({
  label,
  value,
  mono = false
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) => (
  <div className='flex items-center flex-wrap gap-x-1.5'>
    <Typography className='font-medium' color='text.primary'>
      {label}:
    </Typography>
    {/* A Mongo id, a version string and a phone number are all read a character
        at a time. A proportional face is the wrong tool. */}
    <Typography className={mono ? 'font-mono break-all' : 'break-words'}>{value}</Typography>
  </div>
)

/** One line describing whatever the updater is currently doing. */
const UpdateStatusValue = ({ update }: { update: UpdateState }) => {
  switch (update.phase) {
    case 'checking':
      return <Typography color='text.secondary'>Checking…</Typography>
    case 'available':
      return (
        <Typography color='warning.main'>
          Version {update.latest} found — starting download
        </Typography>
      )
    case 'downloading':
      return (
        <Typography color='warning.main'>
          Downloading version {update.latest} — {update.percent}%
        </Typography>
      )
    case 'downloaded':
      return (
        <Typography color='success.main' className='font-medium'>
          Version {update.latest} downloaded — restarting to install…
        </Typography>
      )
    case 'error':
    case 'unsupported':
      return <Typography color='text.secondary'>{update.message ?? 'Unavailable'}</Typography>
    default:
      return <Typography color='success.main'>Up to date</Typography>
  }
}

export interface UserDetailPageProps {
  /** Live updater state for the "About this installation" card. */
  update: UpdateState
  onCheckForUpdate: () => void
  checkingUpdate: boolean
}

export const UserDetailPage = ({
  update,
  onCheckForUpdate,
  checkingUpdate
}: UserDetailPageProps) => {
  const auth = useAuth()
  const { user } = auth

  if (!user) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center gap-2 text-center plb-12'>
          <Box
            component='i'
            className='tabler-user-off'
            sx={{ fontSize: 40, color: 'text.disabled' }}
          />
          <Typography variant='h5'>No user loaded</Typography>
          <Typography color='text.secondary'>
            Sign in again to see your profile details.
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const dash = (value: string): ReactNode =>
    value ? (
      value
    ) : (
      <Typography component='span' color='text.disabled'>
        —
      </Typography>
    )

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <Typography color='text.secondary'>
          Your TrackVid account as it is stored on the server.
        </Typography>
        <Button variant='secondary' size='sm' onClick={() => void auth.signOut()}>
          Sign out
        </Button>
      </div>

      <Card>
        <CardContent className='flex flex-col gap-6'>
          <div className='flex items-center gap-4'>
            <CustomAvatar color='primary' skin='light' variant='circular' size={56}>
              <Typography variant='h5' color='inherit'>
                {(user.firstName.charAt(0) || user.email.charAt(0) || '?').toUpperCase()}
              </Typography>
            </CustomAvatar>
            <div className='min-is-0'>
              <Typography variant='h5' className='truncate'>
                {user.fullName || user.email}
              </Typography>
              <Typography color='text.secondary' className='truncate'>
                {user.email}
              </Typography>
            </div>
          </div>

          <div>
            <Typography variant='h5'>Details</Typography>
            <Divider className='mlb-4' />
            <div className='flex flex-col gap-2'>
              <Detail label='First name' value={dash(user.firstName)} />
              <Detail label='Last name' value={dash(user.lastName)} />
              <Detail label='Email' value={dash(user.email)} />
              <Detail label='Phone' value={dash(user.phone)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title='About this installation'
          subheader='What this machine is running, and whether anything newer exists.'
          action={
            <Button
              variant='secondary'
              size='sm'
              loading={checkingUpdate}
              onClick={onCheckForUpdate}
            >
              Check for updates
            </Button>
          }
        />
        <CardContent className='flex flex-col gap-2'>
          <Detail label='Installed version' value={dash(update.current)} mono />
          <Detail label='Update status' value={<UpdateStatusValue update={update} />} />
          {update.latest && update.phase !== 'idle' && (
            <Detail label='Available version' value={update.latest} />
          )}
          {update.releaseNotes && (
            <Detail
              label='Release notes'
              value={
                <Typography component='span' sx={{ whiteSpace: 'pre-line' }}>
                  {update.releaseNotes}
                </Typography>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
