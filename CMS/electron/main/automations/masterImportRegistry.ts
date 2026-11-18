import type { MasterImportInput, MasterImportOutcome } from './platforms/snapdeal/master-import/api-based-flow/runImport'
import { runSnapdealMasterImport } from './platforms/snapdeal/master-import/api-based-flow/runImport'
import { requestSnapdealMasterReports } from './platforms/snapdeal/master-import/script-based-flow/runImport'
import { runMeeshoMasterImport as runMeeshoByApi } from './platforms/meesho/master-import/api-based-flow/runImport'
import { runMeeshoMasterImport as runMeeshoByScript } from './platforms/meesho/master-import/script-based-flow/runImport'
import { runMyntraMasterImport as runMyntraByApi } from './platforms/myntra/master-import/api-based-flow/runImport'
import { runAjioMasterImportByApi } from './platforms/ajio/master-import/api-based-flow/runImport'
import { runAjioMasterImportByScript } from './platforms/ajio/master-import/script-based-flow/runImport'
import { platformKey } from '@shared/utils/platformKey'

/**
 * Platform → the master import that runs ON THIS MACHINE.
 *
 * Keyed by platform AND flow, because the two settings are orthogonal:
 * `desktopExecution` decides WHERE an import runs, `apiBasedAutomation` decides
 * HOW. A platform can be routed to the desktop while still being configured for
 * the script-based flow, and answering the first question does not answer the
 * second.
 *
 * A missing entry is not a failure — it means that pairing has no desktop
 * implementation yet, and the caller falls back to the server rather than
 * failing. Adding one is a folder plus a line here.
 */

export type MasterImportRunner = (
  input: MasterImportInput,
  onProgress?: (message: string) => void
) => Promise<MasterImportOutcome[]>

type Flow = 'api' | 'script'

const RUNNERS: Record<string, Partial<Record<Flow, MasterImportRunner>>> = {
  snapdeal: {
    // Complete in one pass — schedules the reports, then polls for them over
    // HTTP until they are built, exactly as the automation server's
    // apiScript.js does. Nothing is held open between rounds but a cookie jar.
    api: runSnapdealMasterImport,
    // Phase 1 only: requests the reports and closes the browser. The download
    // happens later, from masterImportQueue.service — this flow drives the
    // portal's UI, and holding a browser open for a report that takes twenty
    // minutes is waste on a server and a window in the operator's way here.
    script: requestSnapdealMasterReports
  },
  // Both complete in one pass. Meesho does not build its export in the
  // background the way Snapdeal does, so neither flow needs the queue: the
  // script flow downloads inside the one page visit, and the API flow polls a
  // history endpoint over HTTP without holding a browser.
  //
  // The API flow covers FORWARD ORDERS ONLY — Meesho publishes no return-order
  // export — and says so per import type rather than quietly importing half.
  meesho: {
    api: runMeeshoByApi,
    script: runMeeshoByScript
  },
  // API only for now. Myntra's script flow downloads through a BullMQ worker
  // backed by Redis, which this app has no equivalent of — porting it means
  // rebuilding that phase on the JSON queue, so it is its own piece of work.
  // A company on `apiBasedAutomation.myntra.masterImport = false` therefore
  // falls through to the server rather than running here.
  myntra: {
    api: runMyntraByApi
  },
  // Two genuinely different fetches over one shared runner: the API flow calls
  // AJIO's download endpoint from inside the logged-in page, the script flow
  // clicks View → Export. Everything either side of that step is identical, so
  // `common/runImport` holds it once.
  ajio: {
    api: runAjioMasterImportByApi,
    script: runAjioMasterImportByScript
  }
}

export const masterImportRunner = (platform: string, flow: Flow): MasterImportRunner | null =>
  RUNNERS[platformKey(platform)]?.[flow] ?? null

/** Which platform/flow pairings can run here, for reporting what cannot. */
export const desktopMasterImports = (): { platform: string; flows: Flow[] }[] =>
  Object.entries(RUNNERS).map(([platform, flows]) => ({
    platform,
    flows: Object.keys(flows) as Flow[]
  }))
