import { claimCredentials } from '@main/services/claimSession.service'
import { credentialFor, orderedPobIds } from '@main/services/company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import {
  openSignedInAjioPage,
  type PuppeteerPage
} from '@main/automations/platforms/ajio/common/signedInPage'
import { logger } from '@main/services/logger'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/**
 * Asks one AJIO seller account whether it holds a return AWB — and under which
 * place of business.
 *
 * AJIO is the only platform where the account is half an answer. Every return
 * lives under a POB, both search endpoints are scoped to one, and `raiseClaim`
 * refuses to start without `configEntry.pobid` — so a mapping that stopped at
 * the account would leave the row exactly as unfileable as it found it. Hence
 * two stages, and hence this probe returns a POB alongside its yes.
 *
 * It is also the only one that needs a BROWSER to ask. Akamai wants the real
 * HttpOnly `bff_session` and a genuine TLS fingerprint, so every AJIO API call
 * is a `fetch` from inside a logged-in page. That page is opened once for the
 * account and reused for every AWB in the run; a page per claim would be a
 * sign-in per claim.
 *
 * THE POB LIST COMES FROM SETTINGS, not from AJIO. Monitor's "Sync POBs" writes
 * it to the credential and this app already holds a copy of that document, so
 * re-fetching `work-places` here would be a paged API sweep per account per run
 * to rebuild a list already sat in memory. The stored list is also the one
 * carrying `lastUsed`, which is what makes the search short.
 *
 * The sign-in itself belongs to the shared opener — which reuses the stored
 * session and saves a new one when it has to sign in. This file used to open
 * its own page and skip the saving half, so every run signed in from scratch.
 */

interface AjioProbe {
  probeAjioAwb: (
    page: PuppeteerPage,
    awb: string,
    options: { pobIds: string[]; recentPobs?: unknown; logger?: unknown }
  ) => Promise<ProbeAnswer>
}

interface RecentFirstCtor {
  RecentFirst: new () => unknown
}

export const openAjioProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  // Read BEFORE the browser is launched. An account with no POBs stored cannot
  // be searched at all, and finding that out after a sign-in would spend a
  // browser and a login to learn something already on disk.
  const stored = await credentialFor('ajio', credential.username)
  const pobIds = orderedPobIds(stored?.pobIds ?? [])

  if (pobIds.length === 0) {
    throw new Error(
      `No POBs are stored for ${credential.username} — run Sync POBs for this account in Monitor, ` +
        'then map again'
    )
  }

  const credentials = await claimCredentials('ajio', credential.username)

  const { probeAjioAwb } = loadCore<AjioProbe>(
    'platforms/ajio/account-mapping/api-based-flow/probeAwb'
  )
  const { RecentFirst } = loadCore<RecentFirstCtor>('common/accountMapping')

  const { browser, page } = await openSignedInAjioPage({
    username: credential.username,
    password: credentials.password
  })

  logger.info(
    `[account-map/ajio] ${credential.username}: searching ${pobIds.length} place(s) of business, ` +
      `most recently used first (${pobIds[0]})`
  )

  // Layered on top of the stored `lastUsed` order: that gets the first claim of
  // a run to the right POB quickly, and this keeps every later claim there even
  // before the stamp has made the round trip to the backend and back.
  const recentPobs = new RecentFirst()

  return {
    ask: (awb: string) => probeAjioAwb(page, awb, { pobIds, recentPobs, logger }),
    close: async () => {
      await browser.close().catch(() => undefined)
    }
  }
}
