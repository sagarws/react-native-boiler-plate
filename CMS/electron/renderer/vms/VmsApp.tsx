import Card from '@mui/material/Card'

import { Button } from '@renderer/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@renderer/components/data/StateBlocks'
import { PageHeading } from '@renderer/layout/PageHeading'

import { MediaPermissionsProvider } from './context/MediaPermissionsContext'
import { FlipkartVmsPage } from './partnerVms/FlipkartVmsPage'
import { useVmsPage } from './partnerVms/pageStore'
import { usePartnerVms } from './partnerVms/usePartnerVms'
import { VmsGuards } from './guards/VmsGuards'
import { PermissionsDialog } from './permissions/PermissionsDialog'
import { RecorderPage } from './recorder/RecorderPage'
import { useVmsSession } from './VmsSessionContext'

/**
 * The VMS half's content area, inside the same shell as the CMS.
 *
 * No feed held → the template's empty state, pointing at the picker in the
 * bar. A feed held → the recorder, behind Argos Watch's guards (idle, storage,
 * date). The camera / microphone ask happens on entering the VMS, as Argos
 * asked at launch, and its state is shared with the recorder through
 * MediaPermissionsProvider (`useMediaPermissions().grantSeq`).
 */
const NoFeed = () => {
  const { feeds, feedsLoading, feedsError, refreshFeeds } = useVmsSession()

  if (feedsLoading) return <LoadingState label='Reading the feeds…' />
  if (feedsError) return <ErrorState message={feedsError} onRetry={() => void refreshFeeds()} />

  const choosable = feeds.filter((feed) => !feed.disabled).length

  return (
    <EmptyState
      icon={<i className='tabler-device-cctv' />}
      title='Choose a feed to start recording'
      message={
        choosable > 0
          ? 'Pick the feed this desk records as from the list in the bar above. Recordings upload under that feed.'
          : 'This company has no feed that can record yet. Add one in TrackVid, then refresh.'
      }
      action={
        choosable === 0 ? (
          <Button variant='secondary' size='sm' icon={<i className='tabler-refresh' />} onClick={() => void refreshFeeds()}>
            Refresh
          </Button>
        ) : undefined
      }
    />
  )
}

export const VmsApp = ({ heading }: { heading: string }) => {
  const { session } = useVmsSession()
  const held = session.authenticated && session.user !== null
  const page = useVmsPage()
  // Owns the Flipkart VMS mirror's lifecycle for the whole VMS (TrackVid-App
  // mounted it in its layout): brings it up, hidden, once a feed with the
  // mirror is held — after the recorder's camera is open, so the app sets the
  // camera format and their page joins it.
  usePartnerVms({ waitForCamera: true })

  return (
    <MediaPermissionsProvider>
      <PermissionsDialog />
      <PageHeading title={heading} />
      {page === 'flipkart' ? (
        // Gated by the page itself (it waits for the session, then sends a
        // feed without the mirror back to the recorder). Not behind the station
        // guards, as in TrackVid-App: the seller may sit here logging in, and
        // an idle pause must not cover their page.
        <FlipkartVmsPage />
      ) : held ? (
        <VmsGuards>
          <RecorderPage />
        </VmsGuards>
      ) : (
        <Card>
          <NoFeed />
        </Card>
      )}
    </MediaPermissionsProvider>
  )
}
