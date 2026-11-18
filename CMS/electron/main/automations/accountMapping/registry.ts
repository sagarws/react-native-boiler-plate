import type { ProbeOpener } from './types'
import { openAjioProbe } from '../platforms/ajio/account-mapping/api-based-flow/probeAwb'
import { openDelhiveryProbe } from '../platforms/delhivery/account-mapping/api-based-flow/probeAwb'
import { openFlipkartProbe } from '../platforms/flipkart/account-mapping/api-based-flow/probeAwb'
import { openMeeshoApiProbe } from '../platforms/meesho/account-mapping/api-based-flow/probeAwb'
import { openMeeshoProbe } from '../platforms/meesho/account-mapping/script-based-flow/probeAwb'
import { loadCore } from '../common/coreLoader'
import { openMyntraProbe } from '../platforms/myntra/account-mapping/api-based-flow/probeAwb'
import { openSnapdealProbe } from '../platforms/snapdeal/account-mapping/api-based-flow/probeAwb'
import { openTataCliqProbe } from '../platforms/tatacliq/account-mapping/api-based-flow/probeAwb'
import { openXbeesProbe } from '../platforms/xbees/account-mapping/api-based-flow/probeAwb'
import { platformKey } from '@shared/utils/platformKey'

/**
 * Platform → the thing that can ask one of its accounts about an AWB.
 *
 * The only place a platform name is mapped to mapping code. Adding a platform
 * is one import and one entry; the probe itself goes under
 * `platforms/<platform>/account-mapping/<flow>/`, mirroring
 * @trackvid/automation-core so the two trees line up file for file.
 *
 * ONE PLATFORM IS DELIBERATELY ABSENT, for a reason rather than an omission:
 *
 *   nykaa     — has no per-row account at all. The company's single Nykaa login
 *               files every claim, so there is nothing to map: a run would ask
 *               one account about rows that are already going to it.
 *
 * Tata CliQ was the second, on the grounds that it had no automation at all. It
 * has one now, and its probe is shaped like AJIO's: the account is half an
 * answer, because a return is visible only to the SLAVE that owns it.
 *
 * The core's own ACCOUNT_MAPPING registry says the same thing; this map is the
 * subset this build ships runners for, exactly as CLAIM_RUNNERS is.
 */
/**
 * Meesho is the one platform with two ways to be asked.
 *
 * `fetchReturnClaims` takes a free-text query where every other Meesho endpoint
 * wants a sub-order number, so it can answer for a row that has none — which is
 * the blank a mapping run exists to fill. It is also one undocumented endpoint
 * away from changing shape, while the Returns screen always works.
 *
 * Read at CALL time, not at import: the flag lives in the core's constants and
 * a build that captured it once would need a rebuild to change its mind.
 */
const meeshoProbe: ProbeOpener = credential => {
  const { MEESHO_API_BASE_ACCOUNT_MAPPING } = loadCore<{
    MEESHO_API_BASE_ACCOUNT_MAPPING: boolean
  }>('common/constants')

  return MEESHO_API_BASE_ACCOUNT_MAPPING
    ? openMeeshoApiProbe(credential)
    : openMeeshoProbe(credential)
}

export const ACCOUNT_PROBES: Record<string, ProbeOpener> = {
  ajio: openAjioProbe,
  delhivery: openDelhiveryProbe,
  flipkart: openFlipkartProbe,
  meesho: meeshoProbe,
  myntra: openMyntraProbe,
  snapdeal: openSnapdealProbe,
  // Sweeps the login's slaves: a Tata CliQ return is visible only to the
  // warehouse that owns it, so the account alone does not locate one.
  tatacliq: openTataCliqProbe,
  xbees: openXbeesProbe
}

/** The opener for one platform, or null when this build cannot map it. */
export const probeOpener = (platform: string): ProbeOpener | null =>
  ACCOUNT_PROBES[platformKey(platform)] ?? null

/** Platforms this build can account-map, lowercase. */
export const mappablePlatforms = (): string[] => Object.keys(ACCOUNT_PROBES)
