import { claimCredentials } from '@main/services/claimSession.service'
import { credentialFor } from '@main/services/company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { leasedSession } from '@main/services/browserLease.service'
import {
  openSignedInAjioPage,
  type PuppeteerPage
} from '@main/automations/platforms/ajio/common/signedInPage'
import { logger } from '@main/services/logger'

/**
 * Sweeps the POB ids one AJIO credential can see.
 *
 * The sequence is the core's `syncPobIds` — the same one the automation server
 * runs behind Monitor's "POBs (5)" button, moved into the core when this app
 * needed it too. Which of AJIO's two endpoints answers depends on the
 * credential's `IsEnterPriceLevel` flag, and that decision lives there.
 *
 * WHY THE DESKTOP SWEEPS ITSELF rather than asking the server to: this app
 * already opens a signed-in AJIO page to file claims, and the lease means a
 * sync pressed during a run costs nothing at all. Routing it through the server
 * would open a second browser, for the same account, from a session that
 * machine may not hold.
 */

interface AjioPobSync {
  syncPobIds: (
    page: PuppeteerPage,
    userId: string,
    options: { enterpriseLevel?: boolean; logger?: unknown }
  ) => Promise<{
    pobIds: string[]
    parentIds: string[]
    stores: { id: string; storeName?: string }[]
    totalElements: number | null
    source: string
  }>
}

/** How long the portal is given to finish routing itself before a retried sweep. */
const SPA_SETTLE_MS = 4000

export const sweepAjioPobs = async (
  username: string
): Promise<{ pobIds: string[]; storeCount: number; source: string; enterpriseLevel: boolean }> => {
  const credential = await credentialFor('ajio', username)
  const credentials = await claimCredentials('ajio', username)

  const { syncPobIds } = loadCore<AjioPobSync>('platforms/ajio/common/pobSync')

  const { page, context, release } = await leasedSession(`ajio:${username}`, async () => {
    const opened = await openSignedInAjioPage({ username, password: credentials.password })

    return { browser: opened.browser, page: opened.page, context: { sellerId: opened.sellerId } }
  })

  try {
    // Read off the stored credential, as the server's route does: nothing in
    // AJIO's login response says which kind of account this is, and the flag is
    // set by an operator in Monitor.
    const enterpriseLevel = credential?.isEnterpriseLevel === true

    logger.info(
      `[ajio-pobs] ${username}: sweeping via ` +
        `${enterpriseLevel ? 'pobsFromUserId' : 'work-places'}`
    )

    const sweep = () =>
      syncPobIds(page as PuppeteerPage, context.sellerId, { enterpriseLevel, logger })

    let swept: Awaited<ReturnType<typeof sweep>>

    try {
      swept = await sweep()
    } catch (error) {
      // status=-1 is the in-page fetch itself failing, not AJIO answering. A
      // reused session lands on the dashboard at domcontentloaded and the SPA
      // then routes itself, aborting whatever fetch is in flight. Once it has
      // settled the same request answers, so it is asked once more.
      if (!(error instanceof Error) || !error.message.includes('status=-1')) throw error

      logger.warn(`[ajio-pobs] ${username}: the sweep was interrupted (${error.message}) — retrying`)
      await new Promise((resolve) => setTimeout(resolve, SPA_SETTLE_MS))
      swept = await sweep()
    }

    return {
      pobIds: swept.pobIds,
      storeCount: swept.stores.length,
      source: swept.source,
      enterpriseLevel
    }
  } finally {
    await release()
  }
}
