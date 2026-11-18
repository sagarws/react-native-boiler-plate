import type { ClaimRunner } from './common/types'
import type { TatChecker } from './common/tatCheck'
import { genericClaimResources, type ClaimResourceBuilder } from './common/claimResources'
import { ajioClaimResources } from './platforms/ajio/claim-management/common/claimResources'
import { delhiveryClaimResources } from './platforms/delhivery/claim-management/common/claimResources'
import { flipkartClaimResources } from './platforms/flipkart/claim-management/common/claimResources'
import { meeshoClaimResources } from './platforms/meesho/claim-management/common/claimResources'
import { meeshoTatCheck } from './platforms/meesho/claim-management/common/tatCheck'
import type { TicketLookup } from './common/ticketLookup'
import type { TicketThreadProvider } from './common/ticketThread'
import { ajioTicketThread } from './platforms/ajio/claim-management/api-based-flow/ticketThread'
import { meeshoTicketThread } from './platforms/meesho/claim-management/api-based-flow/ticketThread'
import { nykaaTicketThread } from './platforms/nykaa/claim-management/api-based-flow/ticketThread'
import { snapdealTicketThread } from './platforms/snapdeal/claim-management/api-based-flow/ticketThread'
import type { ReturnAwbLookup } from './common/returnAwbLookup'
import { myntraReturnAwbLookup } from './platforms/myntra/claim-management/api-based-flow/returnAwbLookup'
import { meeshoReturnAwbLookup } from './platforms/meesho/claim-management/api-based-flow/returnAwbLookup'
import { flipkartReturnAwbLookup } from './platforms/flipkart/claim-management/api-based-flow/returnAwbLookup'
import { meeshoTicketLookup } from './platforms/meesho/claim-management/api-based-flow/ticketLookup'
import { snapdealTicketLookup } from './platforms/snapdeal/claim-management/api-based-flow/ticketLookup'
import { myntraClaimResources } from './platforms/myntra/claim-management/common/claimResources'
import { nykaaClaimResources } from './platforms/nykaa/claim-management/common/claimResources'
import { snapdealClaimResources } from './platforms/snapdeal/claim-management/common/claimResources'
import { xbeesClaimResources } from './platforms/xbees/claim-management/common/claimResources'
import { runAjioClaim } from './platforms/ajio/claim-management/api-based-flow/runClaim'
import { runDelhiveryClaim } from './platforms/delhivery/claim-management/api-based-flow/runClaim'
import { runDelhiveryScriptClaim } from './platforms/delhivery/claim-management/script-based-flow/runClaim'
import { runFlipkartClaim } from './platforms/flipkart/claim-management/api-based-flow/runClaim'
import { runFlipkartScriptClaim } from './platforms/flipkart/claim-management/script-based-flow/runClaim'
import { runMeeshoClaim } from './platforms/meesho/claim-management/api-based-flow/runClaim'
import { runMeeshoScriptClaim } from './platforms/meesho/claim-management/script-based-flow/runClaim'
import { runMyntraClaim } from './platforms/myntra/claim-management/api-based-flow/runClaim'
import { runNykaaClaim } from './platforms/nykaa/claim-management/api-based-flow/runClaim'
import { runNykaaScriptClaim } from './platforms/nykaa/claim-management/script-based-flow/runClaim'
import { runSnapdealClaim } from './platforms/snapdeal/claim-management/api-based-flow/runClaim'
import { runTataCliqClaim } from './platforms/tatacliq/claim-management/api-based-flow/runClaim'
import { runXbeesClaim } from './platforms/xbees/claim-management/api-based-flow/runClaim'
import { platformKey } from '@shared/utils/platformKey'
import type { Result } from '@shared/types/result'
import { syncDelhiveryDomestics } from '@main/services/delhiveryDomesticSync.service'
import { syncMissingAjioPobs } from '@main/services/ajioPobSync.service'

/** Which of a platform's two claim flows to use. Mirrors the master-import registry. */
export type ClaimFlow = 'api' | 'script'

/**
 * Platform → claim flow → runner.
 *
 * The only place a platform name is mapped to code. Adding a platform is one
 * import and one entry; the runner itself goes under
 * `platforms/<platform>/<automation-type>/<flow>/`, mirroring
 * @trackvid/automation-core so the two trees line up file for file.
 *
 * KEYED BY FLOW, like the master-import registry, because
 * `apiBasedAutomation.<platform>.claim` decides which one a company gets and
 * this used to be a flat map with only the API runners in it. That meant the
 * setting was silently ignored for claims: a company on the Selenium path had
 * the server run Selenium and the desktop run the API flow, from one setting,
 * and the two are not interchangeable.
 *
 * A platform with no `script` entry has no desktop runner for that flow. The
 * processor says so plainly rather than quietly filing through the other one —
 * falling back is how a claim gets raised in a way nobody asked for.
 *
 * Keys are lowercase — the routing settings and the CMS documents disagree on
 * casing, so every lookup lowercases first.
 */
export const CLAIM_RUNNERS: Record<string, Partial<Record<ClaimFlow, ClaimRunner>>> = {
  ajio: { api: runAjioClaim },
  // Both. The API flow talks to the support endpoints; the script flow drives
  // the portal's own Raise Ticket drawer — which is the only one that REFUSES a
  // claim in words (a closed window, a claim already decided) instead of
  // answering 200 with no ticket id.
  delhivery: { api: runDelhiveryClaim, script: runDelhiveryScriptClaim },
  // Both. The API flow talks to the seller portal's own endpoints; the script
  // flow drives its UI through Selenium, which is the only path that works for
  // accounts the API rejects.
  flipkart: { api: runFlipkartClaim, script: runFlipkartScriptClaim },
  // Both. The API flow talks to the supplier portal's endpoints; the script
  // flow fills the same portal's Raise Ticket form, which is the path that
  // works for an account those endpoints reject.
  meesho: { api: runMeeshoClaim, script: runMeeshoScriptClaim },
  myntra: { api: runMyntraClaim },
  // Both. The API flow signs its writes with a CSRF token read from the
  // portal's cookies; the script flow drives the same portal's UI, where the
  // browser sends that header itself — which is the path that works for an
  // account whose stored jar never carried the token.
  nykaa: { api: runNykaaClaim, script: runNykaaScriptClaim },
  snapdeal: { api: runSnapdealClaim },
  // Shaped like AJIO's rather than the API platforms': every Tata CliQ call
  // runs inside a logged-in page (Cloudflare, plus a slave pick that is
  // server-side session state), so there is no HTTP-only flow to offer.
  tatacliq: { api: runTataCliqClaim },
  xbees: { api: runXbeesClaim }
}

/**
 * Script flows that START FROM A STORED SESSION rather than signing in.
 *
 * The distinction exists because "script flow" used to imply "signs in every
 * run, so there is no stored session to be dead" — and the session guard
 * skipped every script flow on that basis. Flipkart's stopped being true when
 * its Selenium flow learned to hydrate the stored jar and prove it by opening
 * the SPF dashboard: a dead session there means the run falls through to a
 * sign-in that needs an emailed code, per account, mid-batch.
 *
 * Kept as a declaration rather than inferred, because the alternative is
 * guessing from the flow name — which is the guess that went stale.
 */
const SESSION_REUSING_SCRIPT_FLOWS = new Set(['flipkart'])

/**
 * Does this platform/flow pair depend on a stored session being alive?
 *
 * True for every API flow by definition — the jar IS the sign-in — and for the
 * script flows above. A false answer means a dead stored session costs the run
 * nothing it was not already going to do, so refusing the claim over one would
 * turn work that would have succeeded into work that never ran.
 */
export const dependsOnStoredSession = (platform: string, flow: ClaimFlow): boolean =>
  flow === 'api' || SESSION_REUSING_SCRIPT_FLOWS.has(platformKey(platform))

/** The runner for one platform and flow, or null when this build has none. */
export const claimRunner = (platform: string, flow: ClaimFlow): ClaimRunner | null =>
  CLAIM_RUNNERS[platformKey(platform)]?.[flow] ?? null

/**
 * The runner to actually use, given the flow the company asked for.
 *
 * Prefers that flow. Falls back to the platform's ONLY other flow when it has
 * exactly one, and reports that it did.
 *
 * The fallback is not a convenience — it closes a hole. TrackVid-BE routes a
 * claim to this machine on `desktopExecution` alone; it does not know or care
 * which flow the desktop has. So a platform routed here whose chosen flow has
 * no desktop runner is a claim nobody files: the server has handed it over and
 * this app refuses it. Filing it through the one flow this build does have is
 * the only outcome that ends with the dispute raised.
 *
 * Where the platform has BOTH flows the choice is real and is obeyed exactly —
 * Flipkart is the only one today, and running its API flow for a company that
 * chose Selenium is precisely the bug this registry was reshaped to prevent.
 */
export const resolveClaimRunner = (
  platform: string,
  chosen: ClaimFlow
): { runner: ClaimRunner; flow: ClaimFlow; substituted: boolean } | null => {
  const flows = CLAIM_RUNNERS[platformKey(platform)]

  if (!flows) return null

  const wanted = flows[chosen]

  if (wanted) return { runner: wanted, flow: chosen, substituted: false }

  const available = (Object.keys(flows) as ClaimFlow[]).filter(flow => flows[flow])

  if (available.length !== 1) return null

  const only = available[0] as ClaimFlow
  const runner = flows[only]

  if (!runner) return null

  return { runner, flow: only, substituted: true }
}

/** Platforms this build can file for at all, in either flow. */
export const claimPlatforms = (): string[] => Object.keys(CLAIM_RUNNERS)

/**
 * Platform → the evidence bundle its claim form takes, for filing by hand.
 *
 * Not keyed by flow: the form is the same whichever flow would have filed it.
 * A platform with no entry (Amazon, Tata CliQ, Other) gets every piece of
 * evidence on the row under TrackVid's own names.
 */
export const CLAIM_RESOURCES: Record<string, ClaimResourceBuilder> = {
  ajio: ajioClaimResources,
  delhivery: delhiveryClaimResources,
  flipkart: flipkartClaimResources,
  meesho: meeshoClaimResources,
  myntra: myntraClaimResources,
  nykaa: nykaaClaimResources,
  snapdeal: snapdealClaimResources,
  xbees: xbeesClaimResources
}

export const claimResourceBuilder = (platform: string): ClaimResourceBuilder =>
  CLAIM_RESOURCES[platformKey(platform)] ?? genericClaimResources

/**
 * Platform → its claim-window ("TAT") check, for the Claims page's Check TAT.
 *
 * Only platforms that ANSWER the question belong here. Meesho does:
 * validateTicketField refuses an out-of-window claim in the marketplace's own
 * words. A platform with no entry has no button — inferring a window from a
 * delivery date and a company setting would be this app's guess, presented to
 * an operator as the marketplace's verdict, and it writes a terminal status.
 *
 * Must stay in step with TAT_CHECK_PLATFORMS in shared/constants/claims.ts,
 * which is what the renderer reads to decide whether to show the button.
 */
export const CLAIM_TAT_CHECKS: Record<string, TatChecker> = {
  meesho: meeshoTatCheck
}

export const tatChecker = (platform: string): TatChecker | null =>
  CLAIM_TAT_CHECKS[platformKey(platform)] ?? null

/**
 * "Did a ticket appear anyway?" — per platform, asked after a claim has failed.
 *
 * Only platforms that can be ASKED by something the claim already knows: Meesho
 * searches its tickets by sub-order, Snapdeal its disputes by suborder. A
 * platform whose read-back needs the ticket id has nothing to offer here — the
 * id is the thing that is missing.
 *
 * The last step of the claim, in other words, and written down as such in the
 * core's common/claimSteps.
 */
export const TICKET_LOOKUPS: Record<string, TicketLookup> = {
  meesho: meeshoTicketLookup,
  snapdeal: snapdealTicketLookup
}

export const ticketLookup = (platform: string): TicketLookup | null =>
  TICKET_LOOKUPS[platformKey(platform)] ?? null

/**
 * Create Claim's return-AWB autofill — per platform, asked of one account with
 * the session it already holds.
 *
 * Myntra, Meesho and Flipkart: each marketplace's own search answers a return
 * AWB in one call. A platform added here gets the all-accounts sweep and
 * the form's toasts for free.
 */
export const RETURN_AWB_LOOKUPS: Record<string, ReturnAwbLookup> = {
  myntra: myntraReturnAwbLookup,
  // The fallback when TrackVid's Meesho master data has not imported the
  // return yet: the supplier portal's own Returns search names its sub-order.
  meesho: meeshoReturnAwbLookup,
  // The order id and order item id, asked in the background while the AWB is
  // typed and saved with the claim by /cms/createCMS.
  flipkart: flipkartReturnAwbLookup
}

export const returnAwbLookup = (platform: string): ReturnAwbLookup | null =>
  RETURN_AWB_LOOKUPS[platformKey(platform)] ?? null

/**
 * Work to do straight after a platform's session is updated — per platform,
 * given the account whose session just landed.
 *
 * Delhivery: its "Domestic" accounts are read with the fresh token and stored
 * on the credential. AJIO: its POBs are fetched when the account has none
 * stored, so a first login does not leave it at "POBs (0)".
 * Run without blocking the capture, and a failure only logs — the session
 * itself is already saved.
 */
export type SessionFollowUp = (username: string) => Promise<Result<unknown>>

export const SESSION_FOLLOW_UPS: Record<string, SessionFollowUp> = {
  ajio: syncMissingAjioPobs,
  delhivery: syncDelhiveryDomestics
}

export const sessionFollowUp = (platform: string): SessionFollowUp | null =>
  SESSION_FOLLOW_UPS[platformKey(platform)] ?? null

/**
 * Platform → its ticket window: read a filed claim's ticket, attach files,
 * comment.
 *
 * AJIO (castellan ticket), Meesho (support ticket), Snapdeal (query case) —
 * each through the API its own portal's ticket window uses. Must stay in step with TICKET_THREAD_PLATFORMS in
 * shared/constants/claims.ts, which is what the renderer reads to decide
 * whether the View icon exists.
 */
export const TICKET_THREADS: Record<string, TicketThreadProvider> = {
  ajio: ajioTicketThread,
  meesho: meeshoTicketThread,
  nykaa: nykaaTicketThread,
  snapdeal: snapdealTicketThread
}

export const ticketThreadProvider = (platform: string): TicketThreadProvider | null =>
  TICKET_THREADS[platformKey(platform)] ?? null
