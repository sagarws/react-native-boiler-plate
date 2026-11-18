import { VMS_CHANNELS } from '@shared/constants/channels'
import { fail, ok } from '@shared/types/result'
import { registerHandler } from '../ipc/handler'
import { logger } from '../services/logger'
import { getStreamDiagnostics } from './rtspBridge.service'
import { currentFeedSession, listFeeds, onFeedSessionChange, releaseFeed, selectFeed } from './feedSession.service'
import { getMediaPermissions, openMediaPrivacySettings, requestMediaPermissions } from './mediaPermissions.service'
import { counts, deleteFailed, listFailed, listPending, retryFailed } from './queue.store'
import { startSidecar } from './sidecar.service'
import { startUploadDriver } from './uploadDriver.service'
import {
  checkOrderExists,
  fetchProductDetails,
  fetchUsage,
  getCameraDatePermission,
  getDiskInfo,
  getIstDate,
  probe
} from './vmsApi.service'

/**
 * Every `vms:*` handler. Payload and result shapes are Argos Watch's own (see
 * the mapping in shared/vms/feeds.ts); only the channel names moved.
 *
 * The queue's write verbs (enqueue, markSyncing, …) are deliberately absent,
 * as in Argos: only the local server and the upload driver change rows.
 */

const readUuid = (payload: unknown): string | null => {
  const uuid = (payload as { uuid?: unknown } | null)?.uuid
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null
}

/** Optional `{ feedId }` filter on the queue lists; omitted = every feed (Argos' behaviour). */
const readFeedFilter = (payload: unknown): string | undefined => {
  const feedId = (payload as { feedId?: unknown } | null)?.feedId
  return typeof feedId === 'string' && feedId.length > 0 ? feedId : undefined
}

export const registerVmsIpc = (): void => {
  // The driver starts when a feed is first taken, so a CMS-only run never
  // starts a timer for it.
  onFeedSessionChange((held) => {
    if (held) startUploadDriver()
  })

  registerHandler(VMS_CHANNELS.feeds, () => listFeeds())
  registerHandler(VMS_CHANNELS.selectFeed, (payload) => selectFeed(payload))
  registerHandler(VMS_CHANNELS.feedSession, () => currentFeedSession())
  registerHandler(VMS_CHANNELS.releaseFeed, () => releaseFeed())

  // Argos answered `number | null` — null when the server could not bind.
  registerHandler(VMS_CHANNELS.sidecarPort, async () => {
    try {
      return ok<number | null>(await startSidecar())
    } catch (error) {
      logger.error('[vms] local server failed to start; recording is unavailable', error)
      return ok<number | null>(null)
    }
  })

  registerHandler(VMS_CHANNELS.diskInfo, () => getDiskInfo())
  registerHandler(VMS_CHANNELS.istDate, () => getIstDate())
  registerHandler(VMS_CHANNELS.cameraDatePermission, (payload) => getCameraDatePermission(payload))
  registerHandler(VMS_CHANNELS.mediaPermissions, () => getMediaPermissions())
  // Raises the OS dialog: operator-triggered only.
  registerHandler(VMS_CHANNELS.requestMediaPermissions, (payload) => requestMediaPermissions(payload))
  registerHandler(VMS_CHANNELS.openMediaPrivacySettings, (payload) => openMediaPrivacySettings(payload))
  registerHandler(VMS_CHANNELS.streamDiagnostics, () => Promise.resolve(ok(getStreamDiagnostics())))
  registerHandler(VMS_CHANNELS.probeApi, (payload) => probe(payload))

  registerHandler(VMS_CHANNELS.queueCounts, async () => ok(await counts()))
  registerHandler(VMS_CHANNELS.queueListFailed, async (payload) => ok(await listFailed(readFeedFilter(payload))))
  registerHandler(VMS_CHANNELS.queueListPending, async (payload) => ok(await listPending(readFeedFilter(payload))))
  registerHandler(VMS_CHANNELS.queueRetry, async (payload) => {
    const uuid = readUuid(payload)
    if (!uuid) return fail('VALIDATION_ERROR', 'uuid is required')
    await retryFailed(uuid)
    return ok(null)
  })
  registerHandler(VMS_CHANNELS.queueDeleteFailed, async (payload) => {
    const uuid = readUuid(payload)
    if (!uuid) return fail('VALIDATION_ERROR', 'uuid is required')
    // Scoped to status 'failed': a miss means the row is gone or in flight.
    if (!(await deleteFailed(uuid))) return fail('NOT_FOUND', 'No failed row with that uuid')
    return ok(null)
  })

  registerHandler(VMS_CHANNELS.orderCheckExists, (payload) => checkOrderExists(payload))
  registerHandler(VMS_CHANNELS.orderProductDetails, (payload) => fetchProductDetails(payload))
  registerHandler(VMS_CHANNELS.usage, () => fetchUsage())
}
