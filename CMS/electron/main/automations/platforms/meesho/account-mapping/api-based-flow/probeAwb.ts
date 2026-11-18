import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/**
 * Asks one Meesho supplier account whether it holds an AWB — over HTTP.
 *
 * The counterpart to the browser probe beside it; which one a run uses is
 * `MEESHO_API_BASE_ACCOUNT_MAPPING` in the core's constants. This one opens no
 * Chrome and signs in only when the stored session cannot stand in, so a sweep
 * over three hundred claims is three hundred requests rather than a browser
 * session per account and a page load per claim.
 *
 * It needs more of the session than the browser path does: `fetchReturnClaims`
 * addresses the supplier explicitly, so the stored record must carry BOTH the
 * supplier id and its identifier. A session missing either is reported as
 * unreachable rather than as a miss — see the core probe.
 */

interface MeeshoLogin {
  loginMeeshoApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { forceFresh?: boolean }
  ) => Promise<unknown>
}

interface MeeshoProbe {
  probeMeeshoApiAwb: (
    ctx: unknown,
    awb: string,
    alternates?: string[]
  ) => Promise<ProbeAnswer>
}

export const openMeeshoApiProbe = async (
  credential: MappingCredential
): Promise<AccountProbe> => {
  const credentials = await claimCredentials('meesho', credential.username)

  const { loginMeeshoApi } = loadCore<MeeshoLogin>(
    'platforms/meesho/claim-management/api-based-flow/claimApiFlow'
  )
  const { probeMeeshoApiAwb } = loadCore<MeeshoProbe>(
    'platforms/meesho/account-mapping/api-based-flow/probeAwb'
  )

  // The stored record already carries the jar, the supplier id and the
  // identifier — everything the login would return — so a sign-in only happens
  // when it does not.
  const ctx =
    credentials.context ??
    (await loginMeeshoApi({
      username: credential.username,
      password: credentials.password,
      _id: credentials.credentialId
    }))

  return {
    // The sub-order number is passed straight through: Meesho's search is free
    // text, so it answers to either, and the core decides which to try second.
    ask: (awb: string, alternates?: string[]) => probeMeeshoApiAwb(ctx, awb, alternates),
    // Nothing to release — this account is a session, not a browser.
    close: () => Promise.resolve()
  }
}
