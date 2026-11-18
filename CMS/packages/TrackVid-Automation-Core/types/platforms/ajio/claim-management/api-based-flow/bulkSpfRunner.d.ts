/**
 * Get the page to a signed-in state and resolve the seller id every AJIO URL is
 * built from.
 *
 * Tries the stored session first. AJIO is the one platform whose session cannot
 * be judged from its jar — the check has to run inside a real page — so
 * `reuseSessionRecord` hydrates, navigates and probes, and returns null having
 * already cleared the page's auth state if it is not usable. A null is not an
 * error; it means "sign in", and the sign-in below runs as though nothing had
 * been tried.
 *
 * @param {object} page
 * @param {object} options
 * @param {{username: string, password: string}} options.credentials
 * @param {object|null} [options.sessionRecord] a stored session, if the caller has one
 * @returns {Promise<{ sellerId: string, reused: boolean }>}
 */
export function authenticatePage(page: object, { credentials, sessionRecord, logger, landingUrl }?: {
    credentials: {
        username: string;
        password: string;
    };
    sessionRecord?: object | null;
}): Promise<{
    sellerId: string;
    reused: boolean;
}>;
/**
 * Sign in again on a page whose session AJIO stopped accepting.
 *
 * A long run outlives an AJIO session: a few hours in, every call starts
 * answering 401 "Authorization header missing". The page still carries the dead
 * session in its cookies and storage, and while it does the SSO login URL
 * bounces straight to a signed-in view and the login form never renders — so it
 * is wiped first, and the sign-in is a fresh password login, never a stored
 * session (that is what just died).
 *
 * @returns {Promise<{ sellerId: string, reused: boolean }>}
 */
export function reauthenticatePage(page: any, { credentials, logger }?: {
    logger?: Console;
}): Promise<{
    sellerId: string;
    reused: boolean;
}>;
/**
 * Run every article of one account group on an authenticated page.
 *
 * @param {object} page  already signed in — see `authenticatePage`
 * @param {object} group from `bucketRows` — { credentials, companyId, configArr }
 * @param {object} options
 * @param {string} options.sellerId
 * @param {number} [options.delayMs=5000] pacing between claims
 * @param {(row: object) => any} [options.onResult] called after EVERY article, so
 *        the caller can flush its report before the next one starts
 * @param {object} [options.saveCtx] passed to the claim flow's resource saver,
 *        with the article's AWB added. Omit and nothing is captured.
 * @param {(entry: object, result: object) => any} [options.writeback] persist the
 *        ticket. Injected rather than called from here: the server writes to
 *        TrackVid over its own API and the desktop app goes through its claim
 *        processor, and neither URL belongs in shared code.
 * @param {() => Promise<{ sellerId: string }>} [options.reauthenticate] sign in
 *        again when AJIO rejects the session mid-run (see `reauthenticatePage`).
 *        With it, an article that comes back `auth_expired` gets a fresh sign-in
 *        and ONE retry — finishing its ticket rather than raising another, if one
 *        was already created. If signing in fails, or AJIO rejects the new
 *        session too, the account's remaining articles fail at once instead of
 *        each burning a request and the pacing delay. Without it (the server's
 *        runner today) a dead session fails every remaining article, as before.
 * @returns {Promise<Array>} one row per article
 */
export function runAccountGroup(page: object, group: object, { sellerId, delayMs, onResult, logger, writeback, saveCtx, reauthenticate }?: {
    sellerId: string;
    delayMs?: number;
    onResult?: (row: object) => any;
    saveCtx?: object;
    writeback?: (entry: object, result: object) => any;
    reauthenticate?: () => Promise<{
        sellerId: string;
    }>;
}): Promise<any[]>;
/** One article. Never throws — every outcome comes back as a row. */
export function claimOneArticle(page: any, entry: any, { sellerId, credentials, logger, saveCtx, pobCache }: {
    sellerId: any;
    credentials: any;
    logger: any;
    saveCtx?: any;
    pobCache?: any;
}): Promise<{
    row: any;
    result: {
        status: string;
        message: string;
    } | {
        status: string;
        message: any;
        ticketId?: undefined;
        finalStatus?: undefined;
        returnOrderId?: undefined;
        body?: undefined;
    };
}>;
/**
 * Every row of a group as a failure, for when the group never got as far as a
 * claim. A login that fails is not one claim's problem — it is every claim for
 * that account, and each needs its own row in the report.
 */
export function failGroup(group: any, reason: any): any;
/** Counts for the summary line and the Mattermost post. */
export function summarise(rows: any): {
    total: any;
    success: any;
    failed: any;
    helpCenterFailed: any;
    notClaimable: any;
    dryRun: any;
    skipped: any;
    pending: any;
};
export function resultRow(entry: any, fields: any): any;
