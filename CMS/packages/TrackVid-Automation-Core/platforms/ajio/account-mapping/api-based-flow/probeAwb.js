/**
 * AJIO — does this seller account hold this AWB, and under which POB?
 *
 * AJIO is the only platform where "which account" is half an answer. Every
 * return lives under a PLACE OF BUSINESS, both search endpoints are scoped to
 * one, and `raiseClaim` refuses to start without `configEntry.pobid`. So a
 * mapping that stopped at the account would leave the row exactly as
 * unfileable as it found it — hence two stages, and hence this probe returns a
 * POB alongside its yes.
 *
 *   stage 1  the engine signs in as each credential in turn (one browser page
 *            per account, because AJIO's APIs only answer from inside one)
 *   stage 2  this file sweeps that account's POBs until one owns the AWB
 *
 * THE SWEEP ORDER IS THE WHOLE COST. A company can hold sixty POBs, and the
 * naive loop is sixty requests per account per claim. Two things keep it
 * sane:
 *
 *   1. VMS first, across every POB, before vision is tried on any. The gamora
 *      endpoint filters on `trackingNumber` with no date range at all, so it
 *      finds a return whatever its age; the vision list needs a [from, to]
 *      window and 404s outside it. Interleaving them would spend two requests
 *      per POB to learn what one answers.
 *   2. `recentPobs` — claims arrive in batches from the same warehouse, so
 *      after the first row resolves the rest hit on the first try.
 */

const {
    searchReturnByAwb,
    searchReturnByAwbVMS,
} = require("../../../../platforms/ajio/claim-management/api-based-flow/updatedClaimApiFlow");

/**
 * Same default as the claim flow's own search window, and overridable by the
 * same variable — a return the claim could find must not be one the mapping
 * calls missing.
 */
const SEARCH_WINDOW_DAYS = Number(process.env.CLAIM_SEARCH_WINDOW_DAYS) || 365;

const ymd = (date) => date.toISOString().slice(0, 10);

/** The [from, to] the vision list is scoped to. */
function searchWindow(days = SEARCH_WINDOW_DAYS) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    return { from: ymd(from), to: ymd(to) };
}

/**
 * @param {object}   page              a signed-in AJIO Puppeteer page
 * @param {string}   awb               the return AWB
 * @param {object}   options
 * @param {string[]} options.pobIds    the places of business on THIS account
 * @param {import("../../../../common/accountMapping").RecentFirst} [options.recentPobs]
 * @param {object}   [options.logger]
 * @returns {Promise<{found: boolean, scope: {pobId: string}|null, details: object|null}>}
 */
async function probeAjioAwb(page, awb, { pobIds = [], recentPobs, logger } = {}) {
    const returnAwb = String(awb).trim();

    if (pobIds.length === 0) {
        // Not "no". The account has no POBs recorded, so nothing was asked —
        // said as an error so the run reports an unreachable account rather
        // than a confident miss.
        throw new Error("no POB ids on this AJIO account — nothing to search");
    }

    const ordered = recentPobs ? recentPobs.order(pobIds, (id) => id) : pobIds;
    const { from, to } = searchWindow();
    // Each endpoint's own reason for missing, in AJIO's wording. Collected but
    // only surfaced when BOTH sweeps come up empty.
    const misses = [];

    /**
     * VISION FIRST, AND THAT ORDER IS THE POINT.
     *
     * Both endpoints can answer, because AJIO decides which one serves a return
     * per POB rather than per account — so neither can be dropped. What can be
     * fixed is which is asked first, and it used to be VMS: every AWB paid a
     * full sweep of VMS across every POB before the pob-scoped vision list was
     * tried at all. On a five-POB account that is five wasted calls per AWB,
     * and 148 rows paid it 148 times.
     *
     * Vision is the one the seller portal itself uses for this question —
     * `/dashboard/dropship/return/pob/{pobId}/list?returnAwbNo=…` over the
     * 365-day window below — and it is POB-scoped, so a hit also names the POB
     * the row belongs to, which is half of what a mapping run is for.
     *
     * VMS stays as the fallback for the POBs only gamora serves, and is reached
     * only when vision has missed on every POB. It also ignores the date range
     * entirely (see its own note), so it is the right thing to fall back TO for
     * a return older than the window.
     */
    const endpoints = [
        {
            label: "vision",
            run: (pobid) =>
                searchReturnByAwb(page, { pobid, returnAwb, from, to, userLogger: logger, misses }),
        },
        {
            label: "VMS",
            run: (pobid) => searchReturnByAwbVMS(page, { pobid, returnAwb, userLogger: logger, misses }),
        },
    ];

    let firstError = null;

    for (const endpoint of endpoints) {
        for (const pobId of ordered) {
            let returnOrderId = null;

            try {
                returnOrderId = await endpoint.run(pobId);
            } catch (error) {
                // One POB's failure is not the account's answer — keep sweeping
                // and only report it if nothing is found at all.
                if (!firstError) firstError = error;
                misses.push(`${endpoint.label}/${pobId}: ${error?.message || error}`);
                continue;
            }

            if (returnOrderId) {
                recentPobs?.remember(pobId);

                return {
                    found: true,
                    scope: { pobId },
                    // The return order the AWB belongs to — AJIO spells it
                    // `returnOrderNo` on the vision list ("RT228025990") and
                    // `returnOrderId` on the VMS one; both name the same thing
                    // and both searches return it here. Worth carrying out
                    // because the CMS row has a field for it and
                    // triggerPuppeteerForCms builds the claim's `orderId` from
                    // it, falling back to the bare AWB when it is blank.
                    details: { returnOrderId, resolvedVia: endpoint.label },
                };
            }
        }
    }

    // Nothing found AND something broke: report the breakage. Calling this a
    // clean "not on this account" would move the AWB on to the next credential
    // and, if none matches, leave a row saying master data is missing when the
    // truth is that a search never ran.
    if (firstError) throw firstError;

    logger?.info?.(
        `🔎 AJIO: ${returnAwb} is under none of this account's ${pobIds.length} POB(s)`
    );

    return { found: false, scope: null, details: null };
}

module.exports = { probeAjioAwb, searchWindow, SEARCH_WINDOW_DAYS };
