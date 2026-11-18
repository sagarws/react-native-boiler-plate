import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/** Asks one Snapdeal seller account whether it holds a return AWB. */

interface SnapdealLogin {
  loginSnapdealApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface SnapdealProbe {
  probeSnapdealAwb: (ctx: unknown, awb: string) => Promise<ProbeAnswer>
}

export const openSnapdealProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  const credentials = await claimCredentials('snapdeal', credential.username)

  const { loginSnapdealApi } = loadCore<SnapdealLogin>(
    'platforms/snapdeal/claim-management/api-based-flow/claimApiFlow'
  )
  const { probeSnapdealAwb } = loadCore<SnapdealProbe>(
    'platforms/snapdeal/account-mapping/api-based-flow/probeAwb'
  )

  const ctx =
    credentials.context ??
    (await loginSnapdealApi(
      { username: credential.username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    ))

  return {
    ask: (awb: string) => probeSnapdealAwb(ctx, awb),
    // Nothing to release — this platform is asked over HTTP, so the "account"
    // is a token, not a browser.
    close: () => Promise.resolve()
  }
}
