/**
 * Drives one account's worth of bulk SPF claims through an already-open page.
 *
 * The caller owns the browser. That is deliberate: the automation server
 * launches Puppeteer with its own production flags and a system Chrome, and the
 * desktop app launches it through `common/browserRuntime` with a bundled one
 * and an operator-visible window. Neither could use the other's launch, but
 * everything AFTER the page is open is identical — sign in once per account,
 * resolve the seller id once, then loop the account's articles — and that is
 * what lives here.
 *
 * SIGN IN ONCE PER ACCOUNT, not once per claim. A hundred claims for one seller
 * is one login. The single-claim runners get away with logging in each time
 * because they file one; doing that in bulk is a hundred SSO round-trips
 * through Akamai, which is both slow and the fastest way to get challenged.
 */

const {
    getUserId,
    raiseClaim,
    retryClaimAttachment,
} = require("./returnDeliveredClaimApiFlow");
const { loginAjioPage } = require("../../common/loginPage");
const { reuseSessionRecord, clearPageAuthState } = require("../../common/sessionStore");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nowIso = () => new Date().toISOString();

/** A scoped logger so one article's lines are attributable in a long run. */
function articleLogger(logger, username, awb) {
    const prefix = `[bulk-spf | ${username} | ${awb}]`;

    return {
        info: (message) => logger.info?.(`${prefix} ${message}`),
        warn: (message) => logger.warn?.(`${prefix} ${message}`),
        error: (message) => logger.error?.(`${prefix} ${message}`),
    };
}

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
async function authenticatePage(page, { credentials, sessionRecord = null, logger = console, landingUrl } = {}) {
    const username = credentials?.username;

    if (!username) throw new Error("authenticatePage: credentials.username is required");

    const reused = sessionRecord
        ? await reuseSessionRecord(page, sessionRecord, { username, landingUrl })
        : null;

    if (reused) {
        logger.info?.(`♻️ [bulk-spf] reused the saved session for ${username}`);
    } else {
        if (!credentials.password) {
            throw new Error(`No stored session and no password for ${username}`);
        }

        await loginAjioPage(page, credentials, { logger });
        logger.info?.(`🔑 [bulk-spf] signed in as ${username}`);
    }

    // A reused record already carries the seller id, and its probe just proved
    // it current — so only a fresh login has to go and read it.
    const sellerId = reused?.userId || (await getUserId(page));

    if (!sellerId) {
        throw new Error("Could not resolve the AJIO seller id (activeSellerProfileId) — the session may be dead");
    }

    return { sellerId, reused: !!reused };
}

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
async function reauthenticatePage(page, { credentials, logger = console } = {}) {
    await clearPageAuthState(page);

    return authenticatePage(page, { credentials, sessionRecord: null, logger });
}

const resultRow = (entry, fields) => ({
    awb: entry.awbNumber,
    sku: entry.sku || "",
    claimType: entry.claimType || "",
    masterImportId: String(entry.masterImportId || ""),
    orderStatus: entry.order_status || "",
    result: "",
    reason: "",
    ticketNumber: "",
    error: "",
    timestamp: nowIso(),
    ...fields,
});

/**
 * Every row of a group as a failure, for when the group never got as far as a
 * claim. A login that fails is not one claim's problem — it is every claim for
 * that account, and each needs its own row in the report.
 */
function failGroup(group, reason) {
    return group.configArr.map((entry) => resultRow(entry, { result: "Failed", error: reason }));
}

/** One article. Never throws — every outcome comes back as a row. */
async function claimOneArticle(page, entry, { sellerId, credentials, logger, saveCtx = null, pobCache = null }) {
    const log = articleLogger(logger, credentials.username, entry.awbNumber || entry.return_order_no);
    const tempTicket = String(entry.temp_ticket || "").trim();

    // A return order number lets the claim skip AJIO's AWB search entirely,
    // which is what makes self-ship returns (no AWB at all) and returns older
    // than the search window resolvable.
    const returnOrderId = String(entry.return_order_no || "").trim() || undefined;

    // Debug capture, when the caller asked for it — the request and response
    // of a claim that went wrong, filed under this company and AWB.
    const ctx = saveCtx ? { ...saveCtx, awbNumber: entry.awbNumber } : {};

    const result = tempTicket
        ? await retryClaimAttachment(page, { sellerId, ticketId: tempTicket, configEntry: entry, userLogger: log, saveCtx: ctx })
        : await raiseClaim(page, { sellerId, configEntry: entry, credentials, userLogger: log, returnOrderId, saveCtx: ctx, pobCache });

    if (result.status === "success" || result.status === "already_raised") {
        return { row: resultRow(entry, { result: "Success", ticketNumber: result.ticketId || "" }), result };
    }

    // Searchable in AJIO but holding no detail — an old or incomplete return
    // that cannot be claimed and cannot be opened in AJIO's own UI either.
    // Neither a success nor a failure, and re-running will not change it.
    if (result.status === "not_claimable") {
        return { row: resultRow(entry, { result: "Not Claimable", reason: result.message || "" }), result };
    }

    // DISABLE_SUBMIT walked the whole claim and stopped at the submit. Recorded
    // as its own outcome so a dry run does not read as a hundred failures.
    if (result.status === "dry_run") {
        return { row: resultRow(entry, { result: "Dry Run", reason: result.message || "" }), result };
    }

    // The session died mid-batch. Named rather than folded into "Failed": every
    // remaining claim for this account will fail the same way, and a report that
    // says so is worth more than twenty identical unexplained failures.
    if (result.status === "auth_expired") {
        return {
            row: resultRow(entry, {
                result: "Failed",
                ticketNumber: result.ticketId || "",
                error: `session expired — ${result.message || "AJIO rejected the session"}`,
            }),
            result,
        };
    }

    // A ticket exists but something after it did not — almost always the
    // attachment. Keeping the id is what lets a retry finish that ticket rather
    // than raise a second one for the same return.
    const ticketNumber = result.ticketId || "";

    return {
        row: resultRow(entry, {
            result: ticketNumber ? "Help Center Failed" : "Failed",
            ticketNumber,
            error: result.message || "claim failed",
        }),
        result,
    };
}

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
async function runAccountGroup(page, group, { sellerId, delayMs = 5000, onResult, logger = console, writeback, saveCtx = null, reauthenticate } = {}) {
    const { credentials, configArr } = group;

    /*
     * The POB records this group needs, fetched once each.
     *
     * `getPobRecord` reads the seller's WHOLE work-places list (size=100) and
     * picks one entry out of it in memory, so a group of 500 rows against one
     * warehouse made 500 identical requests for the same list — claims arrive
     * in batches from the same place, which is exactly the shape that repeats.
     *
     * A GROUP, not the process: this lives as long as one account's rows on one
     * page and is dropped with them. The record holds storeName, pincode,
     * contact and integrationType — seller data that does not change across a
     * run, but which nobody should be serving from an hour ago on a server that
     * stays up for weeks.
     */
    const pobCache = new Map();
    const rows = [];
    let currentSellerId = sellerId;
    // Set once the session cannot be recovered; every article after it fails with this.
    // A session may expire more than once in a run measured in hours, and each
    // time costs one sign-in. What ends the account is a sign-in that fails, or a
    // brand-new session AJIO rejects on its very first request.
    let sessionDead = null;

    for (let index = 0; index < configArr.length; index++) {
        const entry = configArr[index];

        if (sessionDead) {
            const row = resultRow(entry, { result: "Failed", error: `session expired — ${sessionDead}` });

            rows.push(row);
            if (onResult) await onResult(row);
            continue;
        }

        logger.info?.(
            `📦 [bulk-spf] ${credentials.username} — ${entry.awbNumber || entry.return_order_no} ` +
            `(${index + 1}/${configArr.length}, ${entry.claimType || "?"})`
        );

        let row;

        try {
            let outcome = await claimOneArticle(page, entry, { sellerId: currentSellerId, credentials, logger, saveCtx, pobCache });

            if (outcome.result?.status === "auth_expired" && reauthenticate) {
                logger.warn?.(`🔁 [bulk-spf] ${credentials.username}: AJIO rejected the session — signing in again`);

                try {
                    currentSellerId = (await reauthenticate()).sellerId;
                } catch (error) {
                    sessionDead = `signing in again failed: ${error.message}`;
                }

                if (!sessionDead) {
                    // A ticket created before the 401 must be FINISHED, not raised
                    // again: retry through its temp ticket so the attachment lands
                    // on the claim that already exists.
                    const retryEntry = outcome.result.ticketId
                        ? { ...entry, temp_ticket: outcome.result.ticketId }
                        : entry;

                    outcome = await claimOneArticle(page, retryEntry, {
                        sellerId: currentSellerId,
                        credentials,
                        logger,
                        saveCtx,
                        // Safe across the re-authentication: the key carries the
                        // seller id, so a login that came back as a different
                        // seller misses and re-reads. The record is seller data,
                        // not session data — a new session does not change it.
                        pobCache,
                    });

                    if (outcome.result?.status === "auth_expired") {
                        sessionDead = "AJIO rejected the new session too";
                    }
                }

                if (sessionDead) {
                    logger.error?.(`⛔ [bulk-spf] ${credentials.username}: ${sessionDead} — failing the remaining articles`);
                    outcome = {
                        row: resultRow(entry, {
                            result: outcome.result?.ticketId ? "Help Center Failed" : "Failed",
                            ticketNumber: outcome.result?.ticketId || "",
                            error: `session expired — ${sessionDead}`,
                        }),
                        result: outcome.result,
                    };
                }
            }

            row = outcome.row;

            if (writeback && outcome.row.result === "Success") {
                // Non-fatal: the claim is raised at AJIO either way, and failing
                // the row here would hide a ticket that actually exists.
                try {
                    await writeback(entry, outcome.result);
                } catch (error) {
                    logger.warn?.(`⚠️ [bulk-spf] writeback failed for ${entry.awbNumber}: ${error.message}`);
                }
            }
        } catch (error) {
            // raiseClaim reports rather than throws, so reaching here means
            // something outside the claim broke — a closed page, a dead session.
            row = resultRow(entry, { result: "Failed", error: error.message });
        }

        rows.push(row);

        if (onResult) await onResult(row);

        if (index < configArr.length - 1 && delayMs && !sessionDead) await sleep(delayMs);
    }

    return rows;
}

/** Counts for the summary line and the Mattermost post. */
function summarise(rows) {
    const count = (result) => rows.filter((row) => row.result === result).length;
    const helpCenterFailed = count("Help Center Failed");

    return {
        total: rows.length,
        success: count("Success"),
        failed: count("Failed") + helpCenterFailed,
        helpCenterFailed,
        notClaimable: count("Not Claimable"),
        dryRun: count("Dry Run"),
        skipped: count("Skipped"),
        pending: count("Pending"),
    };
}

module.exports = { authenticatePage, reauthenticatePage, runAccountGroup, claimOneArticle, failGroup, summarise, resultRow };
