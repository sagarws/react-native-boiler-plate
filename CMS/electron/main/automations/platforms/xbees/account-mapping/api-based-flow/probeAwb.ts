import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/**
 * Asks one Xbees client account whether it holds an AWB.
 *
 * `disputeDashboardCount` is scoped to the bearer token's own client, so a
 * non-zero total IS the answer. The sequence itself is the core's — this file
 * only resolves the session and hands it over.
 */

interface XbeesLogin {
  loginXbeesApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface XbeesProbe {
  probeXbeesAwb: (ctx: unknown, awb: string) => Promise<ProbeAnswer>
}

export const openXbeesProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  const credentials = await claimCredentials('xbees', credential.username)

  const { loginXbeesApi } = loadCore<XbeesLogin>(
    'platforms/xbees/claim-management/api-based-flow/claimApiFlow'
  )
  const { probeXbeesAwb } = loadCore<XbeesProbe>(
    'platforms/xbees/account-mapping/api-based-flow/probeAwb'
  )

  // The stored session already carries everything the login would return, so a
  // sign-in only happens when it does not — the same rule every claim runner
  // follows.
  const ctx =
    credentials.context ??
    (await loginXbeesApi(
      { username: credential.username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    ))

  return {
    ask: (awb: string) => probeXbeesAwb(ctx, awb),
    // Nothing to release — this platform is asked over HTTP, so the "account"
    // is a token, not a browser.
    close: () => Promise.resolve()
  }
}
