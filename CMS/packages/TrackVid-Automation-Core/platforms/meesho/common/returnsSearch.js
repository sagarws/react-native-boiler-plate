// -----------------------------------------------------------------------------
// Meesho — the Returns search. ONE call, two jobs.
// -----------------------------------------------------------------------------
// POST /api/fulfillment/returnRto/fetchReturnClaims
//
// The supplier portal's own Returns screen, and the only Meesho endpoint that
// takes free text: every other one is keyed on the sub-order number, which is
// precisely what an unmapped claim does not have.
//
// It answers BOTH questions a mapping run asks:
//   • whose is this AWB?   the response is scoped to the session's supplier, so
//                          a non-empty `data` IS the answer — another account's
//                          session returns [] for the same AWB
//   • what is its sub-order number?  `sub_order_num` on the row, beside the
//                          `order_num` it is easily confused with (they differ
//                          by the `_1` split suffix)
//
// WHY THIS FILE EXISTS. There were two copies of this call — one under
// account-mapping, one in the claim flow — and they drifted: the claim flow
// learned to repair a session missing its supplier ids, the mapping probe did
// not. So mapping reported "1 account could not be reached" for AWBs the portal
// finds instantly, and the reason was a guard in the copy nobody had updated.
// Two automations, one endpoint, one implementation: L2 `common/`.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { logApiFailure } = require("../../../common/apiResponseLogger");
const { authError } = require("../../../common/apiError");
// The captured request/response contract for every platform's AWB search lives
// in one place, so this file holds no Meesho field names of its own.
const { findSearchRow } = require("../../../common/awbGlobleSearch");
const { cookieHeader } = require("../../../common/sessionHelpers");
const { fetchSupplierIdentity, identityFromCookies } = require("./supplierIdentity.js");
const { meeshoId } = require("./identifiers.js");
const { browserIdHeader } = require("./browserId.js");

const ORIGIN = "https://supplier.meesho.com";
const PATH = "/api/fulfillment/returnRto/fetchReturnClaims";

const REQ_TIMEOUT_MS = Number(process.env.MEESHO_API_TIMEOUT_MS || 60000);

// The fulfillment area runs its own SPA build, so its version differs from the
// supplier-support one (1.2.3). Both are from the 2026-09-16 capture.
const CLIENT_PACKAGE_VERSION = "1.0.4";

// The user-agent and the client hints are one statement and must agree: a
// Chrome 153 user-agent beside a `sec-ch-ua` saying 152 is a pairing no real
// browser produces. From the 2026-09-19 capture.
const CHROME_MAJOR = process.env.MEESHO_CHROME_MAJOR || "153";
const UA =
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Not_A Brand";v="8", "Chromium";v="${CHROME_MAJOR}"`;

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Fill in supplierId / supplierIdentifier when the session arrived without them.
 *
 * A stored session is cookies plus these two ids, and a session that has the
 * cookies but not the ids is repairable in one HTTP call — see
 * supplierIdentity.js. It used to be a dead end here: the probe threw "session
 * carries no supplier id/identifier", the run counted the account as
 * unreachable, and every AWB came back unmapped.
 */
async function ensureIdentity(ctx) {
    if (text(ctx.supplierIdentifier) && Number(ctx.supplierId)) return;

    // The session's own cookies first — free, and the identity call below
    // refuses a request that has no identifier. See identityFromCookies.
    const fromCookies = identityFromCookies(ctx.jar);
    if (!Number(ctx.supplierId) && fromCookies.supplierId) ctx.supplierId = fromCookies.supplierId;
    if (!text(ctx.supplierIdentifier) && fromCookies.supplierIdentifier) ctx.supplierIdentifier = fromCookies.supplierIdentifier;
    if (text(ctx.supplierIdentifier) && Number(ctx.supplierId)) return;

    if (!ctx._identityPromise) {
        ctx._identityPromise = fetchSupplierIdentity(ctx, { timeout: REQ_TIMEOUT_MS });
    }

    try {
        const identity = await ctx._identityPromise;

        if (identity.supplierId !== null) ctx.supplierId = identity.supplierId;
        if (identity.supplierIdentifier) ctx.supplierIdentifier = identity.supplierIdentifier;
    } catch (err) {
        // Reported as the session problem it is, not as "this AWB is not on
        // this account" — the two lead somewhere completely different.
        const error = new Error(
            `Meesho session could not name its supplier (${err.message}) — re-capture it`
        );
        error.code = "MEESHO_NO_IDENTITY";
        throw error;
    }

    if (!text(ctx.supplierIdentifier) || !Number(ctx.supplierId)) {
        const error = new Error(
            "Meesho session carries no supplier id/identifier — re-capture it"
        );
        error.code = "MEESHO_NO_IDENTITY";
        throw error;
    }
}

/**
 * Search this account's returns for a free-text query — an AWB, a sub-order
 * number or an order number.
 *
 * @param {object} ctx  `{ jar, supplierId, supplierIdentifier }`
 * @param {string} query
 * @param {{ pageSize?: number, step?: string }} [options]
 * @returns {Promise<{ found: boolean, row: object|null, rows: object[], raw: object }>}
 *   `row` is the STRICT match — the row that actually carries the value asked
 *   for. `text_global` is a search and can answer with neighbours, so `data[0]`
 *   is never the answer.
 */
async function searchReturns(ctx, query, { pageSize = 50, step = "Search returns" } = {}) {
    // Upper-cased on the way out — `text_global` is a text match, and a waybill
    // that arrived from a scanner or a spreadsheet in lower case searches as
    // "not found" against a return that is sitting right there. See
    // platforms/meesho/common/identifiers.js.
    const wanted = meeshoId(query);

    if (!wanted) throw new Error("searchReturns: a query is required");

    await ensureIdentity(ctx);

    const identifier = text(ctx.supplierIdentifier);
    const supplierId = Number(ctx.supplierId);

    const res = await axios({
        method: "post",
        url: `${ORIGIN}${PATH}`,
        data: {
            screenType: "returns",
            size: pageSize,
            page_pointer: null,
            cursor: null,
            filter_cursor: null,
            // The tab the Returns screen is on when it searches. Anything else
            // scopes the search to a different set and answers empty.
            filters: { shipment_status: "search_return_rto", text_global: wanted },
            supplier_details: { identifier, id: supplierId },
            identifier,
            child_supplier_identifier: null,
            child_supplier_id: null,
        },
        headers: {
            "user-agent": UA,
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            origin: ORIGIN,
            Referer: `${ORIGIN}/panel/v3/new/fulfillment/${identifier}/returns/search-returns?q=${encodeURIComponent(wanted)}`,
            // Meesho routes on these three. The capture also carries a
            // `browser-id` fingerprint, deliberately not reproduced: it is a
            // per-browser token this process has no honest value for, and
            // inventing one is worse than omitting it. If Meesho ever starts
            // requiring it, that is the first thing to add.
            identifier,
            "client-type": "d-web",
            "client-package-version": CLIENT_PACKAGE_VERSION,
            // Forwarded from the session's own `browser_id` cookie — see
            // browserId.js. The claim submit began requiring it; there is no
            // reason to think this endpoint will not.
            ...browserIdHeader(ctx.jar),
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            cookie: cookieHeader(ctx.jar),
        },
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    if (res.status >= 400) {
        logApiFailure({
            platform: "meesho",
            step,
            method: "POST",
            url: `${ORIGIN}${PATH}`,
            status: res.status,
            data: res.data,
            logger: ctx && ctx.logger,
        });
    }

    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }

    if (res.status === 301 || res.status === 302) {
        const location = res.headers?.location || "";

        if (/login|signin|auth/i.test(location)) {
            throw authError(step, res.status, `redirect to ${location}`);
        }
    }

    if (res.status < 200 || res.status >= 300) {
        throw new Error(
            `${step} failed: HTTP ${res.status} ${String(JSON.stringify(res.data || "")).slice(0, 300)}`
        );
    }

    const row = findSearchRow("meesho", res.data, wanted);
    const rows = Array.isArray(res.data && res.data.data) ? res.data.data.filter(Boolean) : [];

    return { found: Boolean(row), row: row || null, rows, raw: res.data };
}

/**
 * The same search, asked with more than one identifier — first answer wins.
 *
 * WHY A SECOND QUESTION IS WORTH ASKING. The AWB on a CMS row is not always the
 * AWB Meesho is holding. A return that was re-booked gets a new waybill and the
 * row keeps the old one; a row scanned off a packet can carry the forward leg's
 * number; some rows never had one at all. In every one of those cases the search
 * answers `data: []`, and "not found" reads as "this parcel is not on this
 * account" — which is wrong, and leads somewhere completely different from the
 * truth, which is "this parcel is here under another number".
 *
 * The sub-order number is the identifier Meesho actually keys on, and it does
 * not change. So when the AWB finds nothing, asking again by sub-order number
 * costs one request and turns a dead end into a hit — and the row that comes
 * back carries `awb`, which is the CURRENT waybill, straight from Meesho.
 *
 * ORDER MATTERS. The AWB is asked first, because it is the more specific of the
 * two and the one the operator is looking at. The sub-order number is the
 * fallback, not the default.
 *
 * Blanks and repeats are skipped rather than sent: `text_global` with an empty
 * string is a request that cannot match, and asking the same value twice is a
 * second round-trip for an answer already in hand.
 *
 * @param {object} ctx
 * @param {{ awb?: string, subOrderNumber?: string, orderNumber?: string }} identifiers
 * @param {{ pageSize?: number, step?: string, logger?: object }} [options]
 * @returns {Promise<{ found: boolean, row: object|null, rows: object[], raw: object|null,
 *                     matchedBy: string|null, query: string|null, tried: string[] }>}
 *   `matchedBy` names WHICH identifier answered — the caller needs it to say
 *   "found by sub-order number; the AWB on this row is stale".
 */
async function findReturn(ctx, identifiers, { pageSize = 50, step = "Search returns", logger } = {}) {
    // Normalised HERE as well as inside `searchReturns`, so that the dedupe
    // below and the `tried` list report the same spelling that was sent. An AWB
    // given as "vlr…" and a sub-order number given as "VLR…" are one query, and
    // comparing the raw values would send it twice.
    const candidates = [
        { by: "awb", value: meeshoId(identifiers && identifiers.awb) },
        { by: "subOrderNumber", value: meeshoId(identifiers && identifiers.subOrderNumber) },
        { by: "orderNumber", value: meeshoId(identifiers && identifiers.orderNumber) },
    ];

    const tried = [];
    let last = null;

    for (const candidate of candidates) {
        if (!candidate.value) continue;
        if (tried.includes(candidate.value)) continue;

        tried.push(candidate.value);

        const result = await searchReturns(ctx, candidate.value, { pageSize, step });

        last = result;

        if (result.found) {
            if (candidate.by !== "awb" && tried.length > 1) {
                logger?.info?.(
                    `Meesho found this return by ${candidate.by} (${candidate.value}) after the AWB search came back empty`
                );
            }

            return {
                found: true,
                row: result.row,
                rows: result.rows,
                raw: (result.row && result.row.raw) || null,
                matchedBy: candidate.by,
                query: candidate.value,
                tried,
            };
        }
    }

    if (tried.length === 0) {
        throw new Error("findReturn: at least one identifier is required");
    }

    return {
        found: false,
        row: null,
        rows: (last && last.rows) || [],
        raw: null,
        matchedBy: null,
        query: null,
        tried,
    };
}

module.exports = { searchReturns, findReturn, ensureIdentity, ORIGIN, PATH };
