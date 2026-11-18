import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/** Asks one Flipkart seller account whether it holds a tracking id. */

interface FlipkartLogin {
  loginFlipkartApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { forceFresh?: boolean }
  ) => Promise<unknown>
}

interface FlipkartProbe {
  probeFlipkartAwb: (ctx: unknown, awb: string) => Promise<ProbeAnswer>
}

export const openFlipkartProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  const credentials = await claimCredentials('flipkart', credential.username)

  const { loginFlipkartApi } = loadCore<FlipkartLogin>(
    'platforms/flipkart/claim-management/api-based-flow/claimApiFlow'
  )
  const { probeFlipkartAwb } = loadCore<FlipkartProbe>(
    'platforms/flipkart/account-mapping/api-based-flow/probeAwb'
  )

  // Flipkart's login drives a browser for the OTP, so a stored context is worth
  // considerably more here than elsewhere — signing in per account per run
  // would mean an OTP per account.
  const ctx =
    credentials.context ??
    (await loginFlipkartApi({
      username: credential.username,
      password: credentials.password,
      _id: credentials.credentialId
    }))

  return {
    ask: (awb: string) => probeFlipkartAwb(ctx, awb),
    // Nothing to release — this platform is asked over HTTP, so the "account"
    // is a token, not a browser.
    close: () => Promise.resolve()
  }
}
