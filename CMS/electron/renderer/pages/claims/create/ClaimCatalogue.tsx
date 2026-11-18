import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ClaimFormCatalogue, ECommercePlatformRecord } from '@shared/types/cmsCreate'
import { claimFormCatalogue } from '@renderer/services/claimCreate.service'
import { platformKey } from '@shared/utils/platformKey'

/**
 * What the form needs to know about the company: its platforms, their claim
 * types, and the seller accounts held for each.
 *
 * REPLACES TrackVid-FE's `useSelector(state => state.profile).userProfile`.
 * The web app keeps the whole signed-in profile in Redux and the form reaches
 * into `company.settings` for three things. This app has no Redux and, more to
 * the point, no company document in the renderer — it lives encrypted in the
 * main process, because it holds marketplace passwords and session jars. So the
 * main process answers the three questions and nothing else crosses.
 *
 * READ ONCE, at the top of the page. Every platform form below asks the same
 * questions, and a context is what stops eleven components each fetching the
 * same catalogue.
 */

export interface ClaimCatalogueApi {
  platforms: ECommercePlatformRecord[]
  /** Platform → the seller accounts held for it, keyed canonically. */
  accounts: Record<string, string[]>
  /** Delhivery login (lowercased) → its synced Domestic names. */
  delhiveryDomestics: Record<string, string[]>
  increffBulkClaim: boolean
  hasIncreffAllocation: boolean
  /**
   * True until the first answer arrives.
   *
   * The form reads this the way the web page reads "is userProfile still null"
   * — to keep the claim-type dropdown in its loading state rather than showing
   * an empty list, which looks identical to a company with no claim types.
   */
  loading: boolean
}

const EMPTY: ClaimCatalogueApi = {
  platforms: [],
  accounts: {},
  delhiveryDomestics: {},
  increffBulkClaim: false,
  hasIncreffAllocation: false,
  loading: true
}

const ClaimCatalogueContext = createContext<ClaimCatalogueApi>(EMPTY)

export const ClaimCatalogueProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<ClaimFormCatalogue | null>(null)

  useEffect(() => {
    let cancelled = false

    void claimFormCatalogue().then((response) => {
      if (cancelled) return

      // A failure leaves the form in its loading state rather than claiming the
      // company has no platforms — see EMPTY above for why those differ.
      if (response.success) setState(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<ClaimCatalogueApi>(
    () => (state === null ? EMPTY : { ...state, loading: false }),
    [state]
  )

  return <ClaimCatalogueContext.Provider value={value}>{children}</ClaimCatalogueContext.Provider>
}

export const useClaimCatalogue = (): ClaimCatalogueApi => useContext(ClaimCatalogueContext)

/**
 * The seller accounts this company has on one platform.
 *
 * MATCHED ON THE CANONICAL KEY, not the literal string. The caller names a
 * platform in code ("tataCliq"); the company's Integrations list holds whatever
 * an operator typed ("Tata CLiQ"). Neither is wrong, and comparing them
 * literally is what left a Tata CliQ claim with no seller account on it — the
 * dropdown had nothing to offer, the operator's pick was never committed, and
 * an empty dropdown looks exactly like a company with no credentials.
 */
export const accountsFor = (catalogue: ClaimCatalogueApi, platform: string): string[] =>
  catalogue.accounts[platformKey(platform)] ?? []
