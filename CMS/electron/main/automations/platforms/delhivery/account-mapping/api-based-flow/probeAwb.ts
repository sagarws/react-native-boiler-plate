import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/** Asks one Delhivery client account whether a waybill is on it. */

interface DelhiveryLogin {
  loginDelhiveryApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
}

interface DelhiveryProbe {
  probeDelhiveryAwb: (ctx: unknown, awb: string) => Promise<ProbeAnswer>
}

export const openDelhiveryProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  const credentials = await claimCredentials('delhivery', credential.username)

  const { loginDelhiveryApi } = loadCore<DelhiveryLogin>(
    'platforms/delhivery/claim-management/api-based-flow/claimApiFlow'
  )
  const { probeDelhiveryAwb } = loadCore<DelhiveryProbe>(
    'platforms/delhivery/account-mapping/api-based-flow/probeAwb'
  )

  const ctx =
    credentials.context ??
    (await loginDelhiveryApi({
      username: credential.username,
      password: credentials.password,
      _id: credentials.credentialId
    }))

  return {
    ask: (awb: string) => probeDelhiveryAwb(ctx, awb),
    // Nothing to release — this platform is asked over HTTP, so the "account"
    // is a token, not a browser.
    close: () => Promise.resolve()
  }
}
