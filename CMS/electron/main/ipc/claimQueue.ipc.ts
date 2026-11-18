import { CLAIM_QUEUE_CHANNELS } from '@shared/constants/channels'
import { ok } from '@shared/types/result'
import { listClaims } from '../services/claimQueue.service'
import { socketState } from '../services/claimSocket.service'
import { claimStatusTabs, processClaims, supportedPlatforms } from '../services/claimProcessor.service'
import { sessionVerdicts } from '../services/claimSessionGuard'
import { registerHandler } from './handler'

export const registerClaimQueueIpc = (): void => {
  registerHandler(CLAIM_QUEUE_CHANNELS.list, async () => ok(await listClaims()))
  registerHandler(CLAIM_QUEUE_CHANNELS.socketState, () => Promise.resolve(ok(socketState())))
  registerHandler(CLAIM_QUEUE_CHANNELS.supported, async () => ok(await supportedPlatforms()))
  registerHandler(CLAIM_QUEUE_CHANNELS.sessionCheck, async payload => {
    const accounts = (payload as { accounts?: unknown })?.accounts
    // Set by everything that is itself a marketplace API call — Check TAT,
    // Refill, account mapping — see `sessionVerdicts`.
    const directApiCall = (payload as { directApiCall?: unknown })?.directApiCall === true

    if (!Array.isArray(accounts)) return ok([])

    return ok(
      await sessionVerdicts(
        accounts.map(entry => {
          const account = (entry ?? {}) as { platform?: unknown; username?: unknown }

          return {
            platform: typeof account.platform === 'string' ? account.platform : '',
            username: typeof account.username === 'string' ? account.username : ''
          }
        }),
        { directApiCall }
      )
    )
  })
  registerHandler(CLAIM_QUEUE_CHANNELS.statusTabs, payload => {
    const platforms = (payload as { platforms?: unknown })?.platforms

    return Promise.resolve(
      claimStatusTabs(Array.isArray(platforms) ? platforms.map(String) : [])
    )
  })
  registerHandler(CLAIM_QUEUE_CHANNELS.process, payload => {
    const input = (payload ?? {}) as { claims?: unknown }

    // A selection, not one id: the loop lives in the main process so the whole
    // batch can hold the automation lock and one browser. The platform and AWB
    // are how a claim the socket never dispatched gets looked up — the app's
    // list shows every claim the company has, not only the queued ones.
    const claims = Array.isArray(input.claims) ? input.claims : []

    return processClaims(
      claims.map(entry => {
        const item = (entry ?? {}) as {
          cmsId?: unknown
          platform?: unknown
          awbNumber?: unknown
          username?: unknown
        }

        return {
          cmsId: typeof item.cmsId === 'string' ? item.cmsId.trim() : '',
          ...(typeof item.platform === 'string' ? { platform: item.platform } : {}),
          ...(typeof item.awbNumber === 'string' ? { awbNumber: item.awbNumber } : {}),
          // Only used to group the batch — the runner resolves the account
          // it actually signs in with from the claim document.
          ...(typeof item.username === 'string' ? { username: item.username } : {})
        }
      }).filter(item => item.cmsId !== '')
    )
  })
}
