import { useCallback, useState } from 'react'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import { IMPORT_SCHEDULE_CHANNELS } from '@shared/constants/channels'
import { useToast } from '@renderer/hooks/useToast'
import { invoke } from '@renderer/services/ipcClient'
import { refreshCurrentPage } from '@renderer/services/refreshRegistry'
import { notifySessionsChanged } from '@renderer/services/sessionEvents'
import { classNames } from '@renderer/utils/format'

/**
 * Sync — re-reads everything the app keeps a local copy of, plus this page.
 *
 * An icon rather than a labelled button: it sits in the header on every screen,
 * where a word would compete with the page's own actions for attention.
 */

interface SyncAllResult {
  refreshed: number
  failed: number
}

export const SyncButton = (): React.JSX.Element => {
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)

  const sync = useCallback(async () => {
    setSyncing(true)

    // Global first: the page's own read may depend on it — the Sessions page
    // reads routing to decide what each card shows.
    const response = await invoke<SyncAllResult>(IMPORT_SCHEDULE_CHANNELS.syncAll)

    await refreshCurrentPage()
    notifySessionsChanged()
    setSyncing(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    if (response.data.failed > 0) {
      toast.error(`Synced, but ${response.data.failed} could not be refreshed — check your connection`)
    } else {
      toast.success('Synced')
    }
  }, [toast])

  const label = syncing ? 'Syncing' : 'Sync data from the server'

  return (
    <Tooltip title={label}>
      {/* The span keeps the tooltip alive while the button is disabled. */}
      <span>
        <IconButton size='small' onClick={() => void sync()} disabled={syncing} aria-label={label}>
          <i className={classNames('tabler-refresh text-xl', syncing && 'animate-spin')} />
        </IconButton>
      </span>
    </Tooltip>
  )
}
