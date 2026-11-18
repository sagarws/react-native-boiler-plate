/**
 * Writes one failure case, and returns where it went.
 *
 * @param {string} platform  ajio | meesho | …
 * @param {object} kase
 * @param {string}  kase.code       the claim code an operator will read (MR1: …)
 * @param {string} [kase.reason]    one line on why the flow could not explain it
 * @param {string} [kase.awbNumber]
 * @param {string} [kase.subOrderNumber]
 * @param {string} [kase.account]   which login filed it
 * @param {number} [kase.status]    the HTTP status that came back
 * @param {unknown} [kase.request]  a DESCRIPTION of what was sent — never the
 *        request itself; see the header
 * @param {unknown} [kase.response] the body as received; redacted here
 * @param {object} [logger]
 * @returns {string|null} the file written, or null if nothing could be
 */
export function saveClaimFailure(platform: string, kase?: {
    code: string;
    reason?: string;
    awbNumber?: string;
    subOrderNumber?: string;
    account?: string;
    status?: number;
    request?: unknown;
    response?: unknown;
}, logger?: object): string | null;
/** Cases on disk, newest first — for a consumer that wants to list them. */
export function listClaimFailures(): string[];
/**
 * Where cases are written.
 *
 * `os.tmpdir()` rather than the working directory, because the two consumers
 * disagree about what that is: the automation server runs from a checkout it
 * can write to, and a packaged Electron app's resources directory is read-only
 * on macOS. A temp path is writable in both and survives long enough to be
 * read after a failure — which is the whole window this serves.
 *
 * `CLAIM_FAILURE_DIR` overrides it, for an operator who wants the cases beside
 * the rest of a run's output.
 */
export function failureDir(): string;
