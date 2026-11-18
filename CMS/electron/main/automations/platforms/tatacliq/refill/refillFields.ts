import { claimCredentials } from '@main/services/claimSession.service'
import { credentialFor } from '@main/services/company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import {
  openSignedInTataCliqPage,
  type PuppeteerPage,
  type TataCliqSlave
} from '@main/automations/platforms/tatacliq/common/signedInPage'
import { logger } from '@main/services/logger'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * Tata CliQ — the forward AWB, from the search that already found the return.
 *
 * ONE FIELD, AND IT COSTS NOTHING EXTRA. The portal's eligibility response
 * carries the forward AWB, the transaction id, the invoice and whether a CRM
 * ticket exists — all from the one call that establishes the return is on this
 * account. So Refill's second field is free, the way Myntra's is.
 *
 * NO STATUS FIELD. The row shows a CRM ticket NUMBER when one exists, which
 * answers "already claimed", but nothing captured from the portal reports where
 * that ticket now stands — so `statusChange` is declared unavailable in the
 * core's refillConfig rather than filled with a guess.
 *
 * The session is shared with the rest of the run through `contexts`: opening a
 * Tata CliQ page can cost an emailed OTP, so a second one per claim is not a
 * slow path, it is a blocked one.
 */

interface TataCliqProbeCore {
  probeTataCliqAwb: (
    page: PuppeteerPage,
    input: { reverseAwb: string; slaves: TataCliqSlave[] },
    options?: { logger?: unknown }
  ) => Promise<{ found: boolean; forwardAwb: string | null }>
}

/** What this resolver keeps in the run's context map. */
interface TataCliqContext {
  page: PuppeteerPage
  slaves: TataCliqSlave[]
  close: () => Promise<void>
}

export const tataCliqRefill = async ({
  awb,
  username,
  fields,
  contexts
}: RefillInput): Promise<RefillValues> => {
  if (!fields.includes('forwardAwbNumber')) return {}

  const { probeTataCliqAwb } = loadCore<TataCliqProbeCore>(
    'platforms/tatacliq/account-mapping/api-based-flow/probeAwb'
  )

  let ctx = contexts.get(username) as TataCliqContext | undefined

  if (!ctx) {
    const stored = await credentialFor('tatacliq', username)
    const slaves = (stored?.slaves ?? []) as TataCliqSlave[]

    if (slaves.length === 0) {
      // Reported rather than thrown: the run should carry on to the next claim,
      // and the operator needs to be told to sync — not shown a stack trace.
      logger.warn(
        `[refill/tatacliq] ${username}: no slaves stored — run Sync slaves for this account`
      )

      return {}
    }

    const credentials = await claimCredentials('tatacliq', username)
    const opened = await openSignedInTataCliqPage({
    username,
    password: credentials.password,
    // Never mid-run: a Tata CliQ sign-in costs an emailed code, and this is
    // unattended. A session that will not serve fails the row instead.
    allowSignIn: false
  })

    ctx = {
      page: opened.page,
      slaves,
      close: async () => {
        await opened.browser.close().catch(() => undefined)
      }
    }
    contexts.set(username, ctx)
  }

  const answer = await probeTataCliqAwb(ctx.page, { reverseAwb: awb, slaves: ctx.slaves }, { logger })

  if (!answer.found) return {}

  return { forwardAWB: answer.forwardAwb ?? null }
}
