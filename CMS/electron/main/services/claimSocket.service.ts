import { app } from 'electron'
import { io, type Socket } from 'socket.io-client'
import { CLAIM_QUEUE_EVENTS, CMS_LIST_EVENTS } from '@shared/constants/channels'
import type { ClaimDispatch, ClaimSocketState } from '@shared/types/claimQueue'
import type { CmsDriveStatusEvent } from '@shared/types/cmsList'
import { env } from '../config/env'
import { getAccessToken, getSession } from './session.store'
import { recordDispatch } from './claimQueue.service'
import { logger } from './logger'
import { startDraining } from './claimAutoRunner.service'
import { broadcast } from '../ipc/broadcast'

/**
 * The live link to the backend.
 *
 * The server pushes a claim here when the company has
 * `settings.desktopExecution.<platform>.claim` on. The handshake carries the
 * access token as well as the userId: the token is what earns a place in the
 * company room, and that room is the one carrying other people's claims.
 *
 * Connected only while signed in. A socket outliving a sign-out would keep
 * receiving a company's claims after the operator left, and reconnect with a
 * token that is no longer theirs.
 */

let socket: Socket | null = null
let state: ClaimSocketState = { connected: false }

const publish = (next: ClaimSocketState): void => {
  state = next
  broadcast(CLAIM_QUEUE_EVENTS.socketState, state)
}

export const socketState = (): ClaimSocketState => state

/** The socket namespace the backend serves; `/api` is not part of it. */
const socketUrl = (): string => env.apiUrl.replace(/\/api\/?$/, '')

export const connectClaimSocket = (): void => {
  if (socket) return

  const token = getAccessToken()
  const userId = getSession()?.user.id

  if (!token || !userId) {
    logger.info('Not connecting the claim socket: no session')

    return
  }

  const url = socketUrl()

  logger.info(`Connecting claim socket to ${url}`)

  socket = io(url, {
    // websocket first, but polling stays as a fallback: some corporate proxies
    // pass HTTP and silently drop upgrades, and a desktop app that only works
    // on a permissive network is not much use.
    transports: ['websocket', 'polling'],
    // `client` tells the backend this socket is the desktop app and not a
    // browser tab of the web app — the same token joins the same company room
    // either way, and the system admin's "CMS App On/Off" badge counts only
    // these. The backend ignores fields it does not know.
    auth: { userId, token, client: 'cms', appVersion: app.getVersion() },
    reconnection: true,
    reconnectionDelay: 1_000,
    // Capped so a long outage does not leave the app waiting minutes to notice
    // the server is back.
    reconnectionDelayMax: 15_000,
    timeout: 10_000
  })

  socket.on('connect', () => {
    logger.info('Claim socket connected')
    publish({ connected: true, connectedAt: new Date().toISOString() })
  })

  socket.on('disconnect', reason => {
    logger.warn(`Claim socket disconnected: ${reason}`)
    publish({ ...state, connected: false, lastError: reason })
  })

  socket.on('connect_error', error => {
    // Reported, not thrown: socket.io keeps retrying, and the UI showing
    // "disconnected" with a reason beats a dialog for something that usually
    // fixes itself.
    logger.warn(`Claim socket connect error: ${error.message}`)
    publish({ ...state, connected: false, lastError: error.message })
  })

  // Narrowed to the two fields the list uses — the server also sends the
  // rewritten email body, which the renderer has no business holding.
  socket.on('cms:drive:status', (payload: unknown) => {
    const { cmsId, driveStatus } = (payload ?? {}) as Partial<CmsDriveStatusEvent>

    if (typeof cmsId !== 'string' || !cmsId) return
    if (driveStatus !== 'pending' && driveStatus !== 'uploaded' && driveStatus !== 'failed') return

    broadcast(CMS_LIST_EVENTS.driveStatus, { cmsId, driveStatus } satisfies CmsDriveStatusEvent)
  })

  socket.on('cms:claim:dispatch', (payload: ClaimDispatch) => {
    void (async () => {
      try {
        const stored = await recordDispatch(payload)

        // Only announce a claim this call actually stored. A re-dispatch of
        // something already running must not push it back to the top as new.
        if (stored) {
          broadcast(CLAIM_QUEUE_EVENTS.claimReceived, payload)

          // And start it. Not awaited: a claim takes minutes and this is a
          // socket handler — holding it open would stall every later dispatch
          // behind the first one. The runner is serial internally, so the
          // claims still file one at a time.
          startDraining()
        }
      } catch (error) {
        logger.error('Failed to store a dispatched claim', error)
      }
    })()
  })
}

export const disconnectClaimSocket = (): void => {
  if (!socket) return

  logger.info('Disconnecting claim socket')
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  publish({ connected: false })
}
