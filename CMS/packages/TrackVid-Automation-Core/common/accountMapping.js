/**
 * Which marketplace account an AWB actually belongs to.
 *
 * A CMS claim carries no account until somebody puts one there. Rows arrive
 * from a scan or a feed with only an AWB, and every downstream step needs the
 * account first: the runner picks a credential from it, the row cannot be
 * selected without it, and the claim cannot be filed at all. Filling it in by
 * hand across hundreds of rows is the work this replaces.
 *
 * The answer is not derivable from the AWB. Only the marketplace knows which
 * of a company's logins holds a given return, so finding out means ASKING each
 * account in turn until one says yes — which is what this does.
 *
 * ┌─ engine (here) ────────────────────────────────────────────────────────┐
 * │ ordering, first-hit-wins, error tolerance, what to remember for next   │
 * │ time. Knows nothing about any marketplace.                             │
 * ├─ probe (platforms/<platform>/account-mapping/<flow>/probeAwb.js) ───────┤
 * │ "does THIS account hold this AWB?" — one marketplace, one answer.      │
 * ├─ ctx (the consumer) ────────────────────────────────────────────────────┤
 * │ credentials, sessions, browsers. Automated-Scripts and Trackvid-CMS    │
 * │ each resolve those their own way, so neither belongs here.             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Both runners want this, which is why it is in the core rather than in
 * whichever one grew it first.
 */

const { ACCOUNT_FIELDS } = require("./claimAccount");
const { platformKey } = require("./platforms.js");

/**
 * Platforms an AWB can be mapped on, and how.
 *
 * A LOOKUP, not a switch — adding a platform is one entry here plus its own
 * `account-mapping/` folder, and no shared file changes.
 *
 * One platform is deliberately absent:
 *
 *   nykaa    — has no per-row account at all. The company's single Nykaa login
 *              files every claim (see `usesCompanyWideAccount`), so there is
 *              nothing to map and a "Map Username" run would be a no-op.
 *
 * Tata CliQ used to be the second, on the grounds that it had no automation at
 * all. It has one now — a login, a session and a claim flow — so it is mappable,
 * and its probe costs a search per SLAVE rather than one per login, because a
 * return is visible only to the warehouse that owns it.
 *
 * @property {"api"|"script"} flow  how the probe reaches the marketplace
 * @property {"pob"|"slave"|null} scope
 *                                  a second identifier a hit also resolves —
 *                                  AJIO returns live under a place of business
 *                                  and Tata CliQ's under a slave, and a claim
 *                                  needs both the account AND that identifier
 * @property {string} accountField  where the answer is written on the CMS document
 */
const ACCOUNT_MAPPING = {
    ajio: { flow: "api", scope: "pob", accountField: ACCOUNT_FIELDS.ajio[0] },
    delhivery: { flow: "api", scope: null, accountField: ACCOUNT_FIELDS.delhivery[0] },
    flipkart: { flow: "api", scope: null, accountField: ACCOUNT_FIELDS.flipkart[0] },
    meesho: {
        // The only platform with two ways to be asked, and the only one whose
        // answer is a FLAG rather than a fact: `fetchReturnClaims` takes a
        // free-text query where every other Meesho endpoint wants a sub-order
        // number, so it can answer for an unmapped row — but it is one
        // undocumented endpoint away from changing shape, and the Returns
        // screen always works. See constants.MEESHO_API_BASE_ACCOUNT_MAPPING.
        get flow() {
            // Read on each access, not captured at import: this is a
            // configuration value, and a module that latched it once would need
            // a restart to change its mind about which flow it is describing.
            return require("./constants").MEESHO_API_BASE_ACCOUNT_MAPPING ? "api" : "script";
        },
        scope: null,
        accountField: ACCOUNT_FIELDS.meesho[0],
    },
    myntra: { flow: "api", scope: null, accountField: ACCOUNT_FIELDS.myntra[0] },
    snapdeal: { flow: "api", scope: null, accountField: ACCOUNT_FIELDS.snapdeal[0] },
    // The slave is Tata CliQ's POB: the account alone does not locate a return,
    // because the portal searches one warehouse at a time.
    tatacliq: { flow: "api", scope: "slave", accountField: ACCOUNT_FIELDS.tatacliq[0] },
    xbees: { flow: "api", scope: null, accountField: ACCOUNT_FIELDS.xbees[0] },
};

/** Platform keys an AWB can be mapped on, lowercase. */
const MAPPABLE_PLATFORMS = Object.keys(ACCOUNT_MAPPING);

/** The descriptor for one platform, or null when it cannot be mapped. */
function accountMappingFor(platform) {
    return ACCOUNT_MAPPING[platformKey(platform)] || null;
}

/**
 * Keeps whatever answered last time at the front of the queue.
 *
 * This is the difference between a tool that finishes and one that is
 * abandoned. A sweep is O(accounts), and for AJIO O(accounts × places of
 * business) — a company with three logins and sixty POBs is 180 requests for
 * ONE claim. But claims cluster: the rows queued together are nearly always
 * the same seller's, on the same POB, because that is how a return batch
 * arrives. So after the first row resolves, every later row hits on its first
 * or second try and the sweep collapses to roughly one request.
 *
 * Deliberately NOT persisted. It is a hint about the batch in front of it, and
 * a stale hint from last week would just be the wrong first guess.
 */
class RecentFirst {
    constructor() {
        this.seen = [];
    }

    /** `items`, reordered so the most recently successful keys come first. */
    order(items, keyOf) {
        const rank = new Map(this.seen.map((key, index) => [key, index]));

        // A stable sort by rank: unseen keys share Infinity and therefore keep
        // the order they were given, so a first run behaves as if this were not
        // here at all.
        return [...items].sort(
            (a, b) =>
                (rank.get(keyOf(a)) ?? Number.POSITIVE_INFINITY) -
                (rank.get(keyOf(b)) ?? Number.POSITIVE_INFINITY)
        );
    }

    /** Records a key that just answered, at the front. */
    remember(key) {
        if (key == null) return;
        this.seen = [key, ...this.seen.filter((seen) => seen !== key)];
    }
}

/**
 * Asks each account whether it holds this AWB, and stops at the first that does.
 *
 * @param {object}   input
 * @param {string}   input.awb        the return AWB to place
 * @param {string[]} [input.alternates]  other identifiers for the SAME return —
 *                                    a sub-order number, an order number. Passed
 *                                    to the probe, which may try them when the
 *                                    AWB finds nothing; a probe that ignores
 *                                    them behaves exactly as before.
 *
 *                                    They matter because a stale AWB misses on
 *                                    EVERY account, and the sweep then reports
 *                                    the row as belonging to nobody — which
 *                                    reads as a problem with the accounts rather
 *                                    than with the one number being asked about.
 * @param {any[]}    input.accounts   opaque account objects — whatever the consumer's
 *                                    credential record looks like; only `keyOf` reads them
 * @param {(account: any, awb: string, alternates: string[]) => Promise<{found: boolean, scope?: any, details?: any}>}
 *                   input.probe      one marketplace question, one answer
 * @param {(account: any) => string} [input.keyOf]  identity for ordering and reporting
 * @param {RecentFirst} [input.recent] shared across a batch so the sweep shortens
 * @param {object}   [input.logger]
 *
 * @returns {Promise<{
 *   matched: any|null, key: string|null, scope: any|null, details: any|null,
 *   attempts: {key: string, found: boolean, error: string|null}[],
 *   errors: {key: string, error: string}[]
 * }>}
 *
 * NEVER THROWS for a marketplace answer. "No" is an answer, and so is "this
 * account's session is dead" — one broken login must not stop the other two
 * from being asked, because the AWB probably belongs to one of them. The
 * errors are returned instead, so the caller can say "not found, but two of
 * five accounts could not be reached", which is a different thing from "not
 * found" and leads somewhere different.
 */
async function mapAwbToAccount({ awb, alternates = [], accounts, probe, keyOf = defaultKey, recent, logger }) {
    const attempts = [];
    const errors = [];
    const ordered = recent ? recent.order(accounts, keyOf) : accounts;
    // Other names for the SAME return, passed through untouched. A probe that
    // ignores the third argument behaves exactly as it did before this existed,
    // which is every probe but Meesho's.
    const others = (Array.isArray(alternates) ? alternates : [alternates])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value && value.toLowerCase() !== String(awb || "").toLowerCase());

    for (const account of ordered) {
        const key = keyOf(account);

        try {
            const answer = await probe(account, awb, others);

            attempts.push({ key, found: answer?.found === true, error: null });

            if (answer?.found === true) {
                recent?.remember(key);
                logger?.info?.(`🔗 ${awb} belongs to ${key}`);

                return {
                    matched: account,
                    key,
                    scope: answer.scope ?? null,
                    details: answer.details ?? null,
                    attempts,
                    errors,
                };
            }
        } catch (error) {
            const message = error?.message || String(error);

            attempts.push({ key, found: false, error: message });
            errors.push({ key, error: message });
            logger?.warn?.(`⚠️ could not ask ${key} about ${awb}: ${message}`);
        }
    }

    return { matched: null, key: null, scope: null, details: null, attempts, errors };
}

const defaultKey = (account) =>
    String(account?.username ?? account?.key ?? account?.id ?? account ?? "");

/**
 * One sentence saying what a failed mapping actually means.
 *
 * "Not found on any account" and "not found, but three of four accounts
 * refused to answer" look identical in a status column and call for opposite
 * responses — re-import the master data, versus fix the sessions. Naming the
 * unreachable accounts is the whole difference.
 */
function describeMiss(awb, result) {
    const asked = result.attempts.length - result.errors.length;

    if (result.errors.length === 0) {
        return `${awb} was not found on any of the ${asked} account(s) checked`;
    }

    const names = result.errors.map((entry) => entry.key).join(", ");

    return (
        `${awb} was not found on the ${asked} account(s) that answered — ` +
        `${result.errors.length} could not be reached (${names})`
    );
}

module.exports = {
    ACCOUNT_MAPPING,
    MAPPABLE_PLATFORMS,
    accountMappingFor,
    mapAwbToAccount,
    describeMiss,
    RecentFirst,
};
