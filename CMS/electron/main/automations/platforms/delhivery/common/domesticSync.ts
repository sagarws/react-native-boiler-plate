import { loadCore } from '@main/automations/common/coreLoader'
import { credentialFor } from '@main/services/company.service'

/**
 * Reads the "Domestic" accounts one Delhivery credential can act on.
 *
 * Delhivery's answer to AJIO's POBs and Tata CliQ's slaves, and simpler than
 * either: the session is a Keycloak token, so the list is one HTTP call with it
 * — no browser, no lease, no sign-in. It runs straight after a session update,
 * when the stored token is minutes old.
 *
 * Uses the session ALREADY STORED for the credential and never signs in: a
 * credential with no usable token is skipped by the caller, and the next
 * session update fills it in.
 */

interface DelhiveryDomestic {
  id: string
  name: string
  serviceType: string | null
}

interface DomesticsCore {
  listDelhiveryDomestics: (ctx: unknown) => Promise<{ domestics: DelhiveryDomestic[]; refreshed: unknown }>
}

interface ClaimContextCore {
  claimContextFromSession: (platform: string, record: unknown) => unknown
}

export const sweepDelhiveryDomestics = async (username: string): Promise<DelhiveryDomestic[]> => {
  const credential = await credentialFor('delhivery', username)
  const { claimContextFromSession } = loadCore<ClaimContextCore>('common/claimContext')
  const ctx = credential?.session ? claimContextFromSession('delhivery', credential.session) : null

  if (!ctx) {
    throw new Error(`No usable Delhivery session is stored for ${username} — update its login first`)
  }

  const { listDelhiveryDomestics } = loadCore<DomesticsCore>('platforms/delhivery/common/domestics')
  const { domestics } = await listDelhiveryDomestics(ctx)

  return domestics
}
