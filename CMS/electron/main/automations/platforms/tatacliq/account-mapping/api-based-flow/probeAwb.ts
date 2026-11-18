import { claimCredentials } from '@main/services/claimSession.service'
import { credentialFor } from '@main/services/company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import {
  openSignedInTataCliqPage,
  type PuppeteerPage,
  type TataCliqSlave
} from '@main/automations/platforms/tatacliq/common/signedInPage'
import { logger } from '@main/services/logger'
import type {
  AccountProbe,
  MappingCredential,
  ProbeAnswer
} from '@main/automations/accountMapping/types'

/**
 * Asks one Tata CliQ seller account whether it holds a return AWB — and under
 * which slave.
 *
 * SHAPED LIKE AJIO'S, because the question is AJIO's: the account alone does not
 * locate a return. It is visible only to the slave that owns it, the portal
 * searches one warehouse at a time, and its pick is server-side session state —
 * so "does this login hold this AWB" is really "does any of its slaves", and
 * the probe sweeps them. The slave it lands on is reported in `details`; see
 * the `ask` below for why it is not stored.
 *
 * It also needs a BROWSER to ask. sellerzone.tatacliq.com is behind Cloudflare,
 * so every call is a `fetch` from inside a logged-in page. That page is opened
 * once per account and reused for every AWB in the run — and here that matters
 * more than anywhere else, because opening it can cost an emailed OTP.
 *
 * THE SLAVE LIST COMES FROM SETTINGS, not from the portal. "Sync slaves" writes
 * it to the credential and this app holds a copy, so re-reading it per run would
 * be a call for a list already in memory. The stored list is also the one
 * carrying `lastUsed`, which is what makes the sweep short: `slavesOf` hands
 * them back most-recently-useful first, and claims arrive in batches from one
 * warehouse.
 */

interface TataCliqProbeCore {
  probeTataCliqAwb: (
    page: PuppeteerPage,
    input: { reverseAwb: string; slaves: TataCliqSlave[] },
    options?: { logger?: unknown }
  ) => Promise<{
    found: boolean
    slave: TataCliqSlave | null
    forwardAwb: string | null
    transId: string | null
    crmTicket: string | null
    claimable: boolean
    searched: string[]
  }>
}

export const openTataCliqProbe = async (
  credential: MappingCredential
): Promise<AccountProbe> => {
  // Read BEFORE the browser is launched. An account with no slaves cannot be
  // searched at all, and finding that out after a sign-in would spend a browser
  // AND an OTP to learn something already on disk.
  const stored = await credentialFor('tatacliq', credential.username)
  const slaves = (stored?.slaves ?? []) as TataCliqSlave[]

  if (slaves.length === 0) {
    throw new Error(
      `No slaves are stored for ${credential.username} — run Sync slaves for this account on the ` +
        'Login page, then map again'
    )
  }

  const credentials = await claimCredentials('tatacliq', credential.username)

  const { probeTataCliqAwb } = loadCore<TataCliqProbeCore>(
    'platforms/tatacliq/account-mapping/api-based-flow/probeAwb'
  )

  const { browser, page } = await openSignedInTataCliqPage({
    username: credential.username,
    password: credentials.password,
    // Account mapping runs inside a claim and inside the nightly sweep, so it
    // is as unattended as either. A Tata CliQ sign-in costs an emailed code.
    allowSignIn: false
  })

  logger.info(
    `[account-map/tatacliq] ${credential.username}: searching ${slaves.length} slave(s), ` +
      `most recently used first (${slaves[0]?.name})`
  )

  return {
    ask: async (awb: string): Promise<ProbeAnswer> => {
      const answer = await probeTataCliqAwb(page, { reverseAwb: awb, slaves }, { logger })

      if (!answer.found) return { found: false }

      return {
        found: true,
        // NOT in `scope`, though the slave is Tata CliQ's answer to AJIO's POB.
        // `scope` exists so a second identifier can be STORED on the row, and
        // there is nowhere to store a slave: `/cms/map-apply` does not take one
        // and the claim document has no field for it.
        //
        // Nor does it need one. The claim runner sweeps the credential's slaves
        // in `lastUsed` order and the sweep stamps that order, so the next
        // claim from the same warehouse finds it first — the same shortening a
        // stored slave would buy, without a field to keep in step.
        //
        // So it goes in `details`, which is where a probe puts what the
        // marketplace happened to say: it reaches the run's log and report, and
        // nothing pretends it was persisted.
        details: {
          ...(answer.slave ? { slaveName: answer.slave.name } : {}),
          ...(answer.forwardAwb ? { forwardAWB: answer.forwardAwb } : {}),
          ...(answer.transId ? { transId: answer.transId } : {}),
          ...(answer.crmTicket ? { crmTicket: answer.crmTicket } : {}),
          claimable: answer.claimable
        }
      }
    },
    close: async () => {
      await browser.close().catch(() => undefined)
    }
  }
}
