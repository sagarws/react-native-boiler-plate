export namespace DEFAULT_API_FLOW {
    let ajio: boolean;
}
export namespace LEGACY_API_FLOW_ENV {
    let ajio_1: any;
    export { ajio_1 as ajio };
    export let myntra: string;
    export let snapdeal: string;
    export let meesho: string;
    export let flipkart: string;
    export let nykaa: string;
    export let delhivery: string;
    export let xbees: string;
}
/**
 * Splits a master-import/claim config array three ways by how each entry's
 * company is routed.
 *
 * A job's config array spans companies, so "which flow is this job using?" no
 * longer has one answer — it is per entry. Callers run the `api` and `script`
 * groups with their own runners and leave `desktop` alone.
 *
 * @param {Array<{companyId?: string}>} configArray
 * @param {string} platform
 * @param {string} automation
 * @returns {Promise<{desktop: Array, api: Array, script: Array}>}
 */
export function partitionByRouting(configArray: Array<{
    companyId?: string;
}>, platform: string, automation: string): Promise<{
    desktop: any[];
    api: any[];
    script: any[];
}>;
/** Clears the cache. Call after writing a setting, and from tests. */
export function clearRoutingCache(companyId: any): void;
/**
 * Should this company/platform/automation use the direct-API flow?
 *
 * @param {string} companyId
 * @param {string} platform    ajio | myntra | …
 * @param {string} automation  claim | masterImport | ticketDownload
 * @param {boolean} [fallback] used when neither a setting nor an env var exists;
 *                              omitted, the platform's `DEFAULT_API_FLOW` applies
 */
export function useApiBasedFlow(companyId: string, platform: string, automation: string, fallback?: boolean): Promise<boolean>;
/**
 * Should this company/platform/automation be handed to the desktop app instead
 * of running here?
 *
 * Defaults to false when unset: the server keeps doing the work until a company
 * explicitly opts in. Routing to a desktop client that may not be installed —
 * and whose claims would then sit untouched, looking exactly like claims that
 * simply had not run yet — is not a safe default.
 */
export function runsOnDesktop(companyId: any, platform: any, automation: any): Promise<boolean>;
/**
 * Does this company automate the sign-in for this platform?
 *
 * `settings.isAutoLoginOnActiveSession[platform]`. Defaults to TRUE when unset,
 * matching the desktop app: an automation that has always signed itself in must
 * not stop doing so because nobody has opened the setting yet.
 */
export function autoLoginEnabled(companyId: any, platform: any): Promise<boolean>;
/**
 * Teaches the headless decision who signs this platform in.
 *
 * The desktop app does this in `prepareCore`; the server had no equivalent, so
 * `isAutoLoginOnActiveSession` reached the routing decisions and never the
 * headless one — a company with auto-login off still got a headless browser
 * here, and nobody could complete the sign-in it was waiting for.
 *
 * Call it before launching a browser for a company's automation. Cheap: the
 * settings read is the same cached one every routing call already makes.
 *
 * Never throws — a settings read that fails leaves the environment in charge,
 * which is the behaviour that was in place before this existed.
 */
export function applyAutoLoginPolicy(companyId: any, platform: any): Promise<void>;
/**
 * Both decisions in one read, for callers that need each.
 *
 * @param {string} companyId
 * @param {string} platform
 * @param {string} automation
 * @param {boolean} [apiFallback] as `useApiBasedFlow`'s `fallback`
 */
export function resolveRouting(companyId: string, platform: string, automation: string, apiFallback?: boolean): Promise<{
    desktopExecution: boolean;
    apiBasedAutomation: boolean;
}>;
