import type { RefillPlatform, RefillResolver } from './types'
import { ajioRefill, forgetPobOwners } from '../platforms/ajio/refill/refillFields'
import { ajioLocalRefill } from '../platforms/ajio/refill/localRefill'
import { flipkartLocalRefill } from '../platforms/flipkart/refill/localRefill'
import { snapdealLocalRefill } from '../platforms/snapdeal/refill/localRefill'
import { delhiveryRefill } from '../platforms/delhivery/refill/refillFields'
import { flipkartRefill } from '../platforms/flipkart/refill/refillFields'
import { meeshoRefill } from '../platforms/meesho/refill/refillFields'
import { myntraRefill } from '../platforms/myntra/refill/refillFields'
import { nykaaRefill } from '../platforms/nykaa/refill/refillFields'
import { snapdealRefill } from '../platforms/snapdeal/refill/refillFields'
import { tataCliqRefill } from '../platforms/tatacliq/refill/refillFields'
import { platformKey } from '@shared/utils/platformKey'

/**
 * Platform → the thing that answers Refill's non-account fields.
 *
 * The only place a platform name is mapped to refill code. Adding a platform is
 * one import and one entry; the resolver goes under
 * `platforms/<platform>/refill/`, mirroring the rest of the tree.
 *
 * XBEES IS ABSENT ON PURPOSE. Its only refillable field is the account, which
 * the run resolves itself through the mapping probes — there is nothing left
 * for a resolver to answer, and an empty one would only be a file to maintain.
 * Which fields each platform offers is `shared/constants/refill.ts`, mirroring
 * the core's `common/refillConfig.js`.
 *
 * `local` is the report backup on this machine, for Normal Bulk Claim's rows
 * that are not claims yet — AJIO, Snapdeal and Flipkart keep one; the rest
 * are asked of the marketplace only.
 *
 * AJIO IS THE ODD ONE, and says so here rather than anywhere else: its answers
 * come from this machine's backup of the seller portal's reports, so it asks
 * nothing, needs no browser, and names its own account from the POB.
 */
export const REFILL_PLATFORMS: Record<string, RefillPlatform> = {
  ajio: {
    resolve: ajioRefill,
    local: ajioLocalRefill,
    answersAccount: true,
    offline: true,
    reset: forgetPobOwners
  },
  delhivery: { resolve: delhiveryRefill },
  flipkart: { resolve: flipkartRefill, local: flipkartLocalRefill },
  meesho: { resolve: meeshoRefill },
  myntra: { resolve: myntraRefill },
  nykaa: { resolve: nykaaRefill },
  snapdeal: { resolve: snapdealRefill, local: snapdealLocalRefill },
  // Answers only the forward AWB, and gets it from the search that already
  // established the account — so the second field costs nothing extra.
  tatacliq: { resolve: tataCliqRefill }
}

export const refillPlatform = (platform: string): RefillPlatform | null =>
  REFILL_PLATFORMS[platformKey(platform)] ?? null

export const refillResolver = (platform: string): RefillResolver | null =>
  refillPlatform(platform)?.resolve ?? null
