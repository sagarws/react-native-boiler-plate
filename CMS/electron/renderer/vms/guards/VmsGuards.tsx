import type { ReactNode } from 'react'

import { Button } from '@renderer/components/ui/Button'
import { useToast } from '@renderer/hooks/useToast'

import { useIdle } from '../hooks/useIdle'
import { useVmsSession } from '../VmsSessionContext'
import { GuardPanel } from './GuardPanel'
import { STORAGE_CRITICAL_GB, STORAGE_WARN_GB, useStorageCheck } from './useStorageCheck'
import { useDateCheck } from './useDateCheck'

/**
 * The conditions that stop a recording, ported from Argos Watch with the same
 * triggers. Each one REPLACES the recorder while it holds (Argos routed to a
 * full-window page; here the shell stays so the CMS is still a click away):
 *
 *   idle           15 minutes of no mouse or key (Argos' SESSION_TIMEOUT)
 *   out of storage ≤ 5 GB blocks, ≤ 10 GB warns once (vms:disk-info, hourly)
 *   date mismatch  this machine's date is not the server's IST date
 *
 * Mounted only while a feed is held, which is when Argos ran them too.
 */
export const SESSION_TIMEOUT_MINUTES = 15

export const VmsGuards = ({ children }: { children: ReactNode }) => {
  const toast = useToast()
  const { session, release } = useVmsSession()
  const feedId = session.authenticated ? (session.user?.feedId ?? null) : null

  const idle = useIdle(SESSION_TIMEOUT_MINUTES * 60 * 1000, feedId !== null)
  const storage = useStorageCheck()
  const date = useDateCheck(feedId)

  if (idle.idle) {
    return (
      <GuardPanel
        icon='tabler-zzz'
        tone='primary'
        title='Session paused'
        message='This packing station has been idle for a while. Resume where you left off, or give the feed back so another desk can take it.'
        actions={
          <>
            <Button variant='secondary' onClick={() => void release()}>
              Release feed
            </Button>
            <Button onClick={idle.reset}>Resume</Button>
          </>
        }
      />
    )
  }

  if (storage.open) {
    return (
      <GuardPanel
        icon='tabler-database-exclamation'
        tone={storage.critical ? 'danger' : 'warning'}
        title={storage.critical ? 'Storage almost full' : 'Low storage space'}
        message={
          storage.critical
            ? `Less than ${STORAGE_CRITICAL_GB} GB is free. Recording stops here to protect the machine — delete unnecessary files or free up space, then press Ok.`
            : `Less than ${STORAGE_WARN_GB} GB is free. To keep recording smoothly, delete unnecessary files or free up space soon.`
        }
        actions={
          <Button loading={storage.busy} onClick={() => void storage.acknowledge()}>
            Ok
          </Button>
        }
      />
    )
  }

  if (date.mismatch) {
    return (
      <GuardPanel
        icon='tabler-calendar-exclamation'
        tone='danger'
        title='Date mismatch'
        message="This machine's date does not match today's date. Correct the date in the system (or the camera), then refresh to check again."
        actions={
          <Button
            icon={<i className='tabler-refresh' />}
            loading={date.busy}
            onClick={() => {
              void date.recheck().then((outcome) => {
                if (outcome === 'mismatch') toast.error('The date still does not match.')
                if (outcome === 'unreachable') toast.error('Cannot reach the TrackVid server to verify the date.')
              })
            }}
          >
            Refresh
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}
