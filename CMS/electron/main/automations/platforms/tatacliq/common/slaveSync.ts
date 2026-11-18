import { claimCredentials } from '@main/services/claimSession.service'
import { leasedSession } from '@main/services/browserLease.service'
import {
  openSignedInTataCliqPage,
  type TataCliqSlave
} from '@main/automations/platforms/tatacliq/common/signedInPage'
import { logger } from '@main/services/logger'

/**
 * Sweeps the slaves one Tata CliQ credential can see.
 *
 * Mirrors `sweepAjioPobs`, and the reason the desktop sweeps rather than asking
 * the server is stronger here: this app already opens a signed-in Tata CliQ
 * page to file claims, the lease means a sync pressed during a run costs
 * nothing, and routing it through the server would mean a second sign-in — which
 * on Tata CliQ means a second emailed OTP.
 *
 * NO SEPARATE CALL. `openSignedInTataCliqPage` already has the list: the slave
 * list IS the session probe, so a reused session has it from the probe and a
 * fresh one from the sign-in. Asking the portal again would be a third request
 * for an answer already in hand.
 */
export const sweepTataCliqSlaves = async (
  username: string
): Promise<{ slaves: TataCliqSlave[]; reused: boolean }> => {
  const credentials = await claimCredentials('tatacliq', username)

  const { context, release } = await leasedSession(`tatacliq:${username}`, async () => {
    // `sweep: true` — this IS the sweep. Without it the call returns the list
    // already on the credential, and Sync slaves writes back what it just read.
    const opened = await openSignedInTataCliqPage({
      sweep: true,
      username,
      password: credentials.password
    })

    return {
      browser: opened.browser,
      page: opened.page,
      context: { slaves: opened.slaves, reused: opened.reused }
    }
  })

  try {
    logger.info(
      `[tatacliq-slaves] ${username}: ${context.slaves.length} slave(s)` +
        (context.reused ? ' (from the saved session)' : ' (after signing in)')
    )

    return { slaves: context.slaves, reused: context.reused }
  } finally {
    await release()
  }
}
