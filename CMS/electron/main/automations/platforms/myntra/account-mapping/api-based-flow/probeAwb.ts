import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/** Asks one Myntra partner account whether it holds a tracking number. */

interface MyntraLogin {
  loginMyntraApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { forceFresh?: boolean }
  ) => Promise<{ jar: Record<string, string> }>
}

interface MyntraProbe {
  probeMyntraAwb: (ctx: unknown, awb: string) => Promise<ProbeAnswer>
}

export const openMyntraProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  const credentials = await claimCredentials('myntra', credential.username)

  const { loginMyntraApi } = loadCore<MyntraLogin>(
    'platforms/myntra/claim-management/api-based-flow/claimApiFlow'
  )
  const { probeMyntraAwb } = loadCore<MyntraProbe>(
    'platforms/myntra/account-mapping/api-based-flow/probeAwb'
  )

  // Myntra's flow takes the jar itself rather than a context object, so the
  // stored jar is the whole session — `claimCredentials` has already proved it
  // live and renewed it if it was not.
  const ctx =
    credentials.context ??
    (await loginMyntraApi({
      username: credential.username,
      password: credentials.password,
      _id: credentials.credentialId
    }))

  return {
    ask: (awb: string) => probeMyntraAwb(ctx, awb),
    // Nothing to release — this platform is asked over HTTP, so the "account"
    // is a token, not a browser.
    close: () => Promise.resolve()
  }
}
