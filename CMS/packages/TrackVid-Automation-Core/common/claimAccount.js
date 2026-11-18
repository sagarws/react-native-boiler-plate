/**
 * Which marketplace account a claim belongs to.
 *
 * Every platform records this in a different place on the CMS document, and
 * there is no `account` object anywhere on it. The desktop runners all read
 * `doc.account?.username`, which `/cms/find-by-awb` has never returned — so
 * every desktop claim failed with "The claim has no marketplace account
 * attached" the moment one was finally run, on every platform, not just Myntra.
 *
 * The mapping below is taken from TrackVid-BE's own
 * `triggerPuppeteerForCms.ts`, which groups rows by exactly these fields before
 * handing them to the server's runners, and from the CMS model for the two
 * platforms that grouping does not reach. Between them they are the authority;
 * this is the same knowledge in a form both consumers can use.
 *
 * It answers ONE question — where is this claim's account stored — and it is
 * deliberately not also the list of platforms that can be automated. Reading it
 * for Tata CliQ returns a username; that says nothing about whether anything
 * can file the claim.
 *
 * ONE MAP, not a switch. Adding a platform is one entry here — matching the
 * folder rule that dispatch is a lookup, never `if (platform === ...)`.
 */

const { platformKey } = require("./platforms.js");

/** Reads a nested path off the claim document, safely. */
const at = (doc, path) =>
    path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);

/**
 * Where each platform keeps its account identifier, in priority order.
 *
 * More than one entry means the field moved or differs by import vintage — the
 * first non-empty wins, so an older row still resolves.
 */
const ACCOUNT_FIELDS = {
    ajio: ["ajio_account_email"],
    meesho: ["meesho_account_email"],
    snapdeal: ["snapdeal_account_username"],
    myntra: ["myntraClaimDetails.username"],
    nykaa: ["nykaaClaimDetails.username"],
    // Five platforms share the `otherClaimDetails` bundle, as the CMS model
    // does. The server's grouping only covers the first three — Tata CliQ and
    // Amazon have no automation to dispatch to — but this map answers a
    // different question from that one: WHERE the account is stored, not which
    // platforms get run. The desktop's claims list reads it to fill its
    // Username column, and a platform missing here shows an empty column for a
    // claim that names an account perfectly well.
    flipkart: ["otherClaimDetails.username"],
    delhivery: ["otherClaimDetails.username"],
    xbees: ["otherClaimDetails.username"],
    // ONE SPELLING, because the lookup canonicalises now. Callers arrive with
    // "Tata CliQ" (the desktop's tab label), "tata cliq" (older stored rows) or
    // "tatacliq" (the registry key and what the newer forms store) — see
    // platformKey. This was briefly keyed under two spellings instead, which
    // fixed the two that were known and left "Tata CliQ" resolving to no
    // fields at all.
    tatacliq: ["otherClaimDetails.username"],
    amazon: ["otherClaimDetails.username"],
};

/**
 * The seller account a claim should be filed from, or null.
 *
 * `null` is a real answer, not a failure: Nykaa carries no per-row account —
 * the server falls back to the company's single verified Nykaa login — so a
 * caller that gets null should look the account up by platform rather than
 * treat the claim as broken.
 *
 * @param {string} platform  platform key, any casing
 * @param {object} doc       the claim document from /cms/find-by-awb
 * @returns {string|null}
 */
function claimAccountUsername(platform, doc) {
    const fields = ACCOUNT_FIELDS[platformKey(platform)] || [];

    for (const field of fields) {
        const value = at(doc, field);

        if (typeof value === "string" && value.trim()) return value.trim();
    }

    // Last resort, and deliberately last: some callers build their own document
    // and do attach an account object. Reading it first would let a stale or
    // hand-made value beat the field the server actually groups by.
    const attached = doc?.account?.username;

    return typeof attached === "string" && attached.trim() ? attached.trim() : null;
}

/** Platforms with no per-row account — resolve by company login instead. */
function usesCompanyWideAccount(platform) {
    return platformKey(platform) === "nykaa";
}

module.exports = { claimAccountUsername, usesCompanyWideAccount, ACCOUNT_FIELDS };
