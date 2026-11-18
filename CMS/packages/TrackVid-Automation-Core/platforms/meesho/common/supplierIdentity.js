// -----------------------------------------------------------------------------
// Meesho — who this session is: supplierId + supplierIdentifier
// -----------------------------------------------------------------------------
// Meesho's panel needs BOTH on every call: the numeric id goes in the body and
// the 5-character slug goes in the `identifier` header. Without the slug the
// API answers
//   403 {"errorCode":1001,"message":"Identifier not present or invalid"}
// — which reads exactly like an expired session and is not one.
//
// WHERE IT COMES FROM, AND WHERE IT DOES NOT.
//
// This used to be read from `/api/container/supplier/api/2.0/supplier/config`
// with a `{supplierId: 0}` body, on the belief that the response carried the
// seller's own id. It does not. Verified against a full capture
// (2026-09-16): that response is the remote feature-flag blob — ads_demand_exp,
// enable_new_theme, promotions_banner_config — and contains neither
// `supplier_id` nor `identifier`.
//
// The cost of that was not a failed call; it was a loop nobody could break:
// every capture stored `supplierId: null`, every run then found the stored
// session "incomplete" and signed in again, and the fresh login stored null
// too. Three sign-ins per account per batch, a visible browser each time, and
// a 403 at the end of it.
//
// The real source is the call the SPA itself makes right after login:
//
//   POST /api/container/supplier/prefetch-supply-data   { identifier }
//   → { registrationStatus: { decodedToken: { supplier_identifiers: ["e18ek"],
//                                             supplier_identifier_to_id_mapping: { e18ek: 4647393 } } },
//       supplier: { supplier_id: 4647393, identifier: "e18ek", … } }
//
// It answers with the WHOLE mapping, so it can be asked before the slug is
// known — which is what makes a cookies-only session repairable without a
// browser.
// -----------------------------------------------------------------------------

const ORIGIN = "https://supplier.meesho.com";
const SUPPLY_DATA_PATH = "/api/container/supplier/prefetch-supply-data";

/**
 * The slug out of a panel URL: https://supplier.meesho.com/panel/v3/new/<module>/<slug>/…
 * The SPA redirects to one of these after login, so it is a free second source.
 * @param {string} url
 * @returns {string|null}
 */
function identifierFromUrl(url) {
    const match = /\/panel\/v\d+\/new\/[^/]+\/([A-Za-z0-9_-]{3,32})(?:[/?#]|$)/.exec(String(url || ""));
    return match ? match[1] : null;
}

/**
 * Pull { supplierId, supplierIdentifier } out of a prefetch-supply-data body.
 * Prefers the `supplier` block and falls back to the token's mapping, which is
 * what answers when the request was made without a known slug.
 * @returns {{ supplierId: number|null, supplierIdentifier: string|null }}
 */
function identityFromSupplyData(body, preferredIdentifier = null) {
    const supplier = (body && body.supplier) || {};
    const token = (body && body.registrationStatus && body.registrationStatus.decodedToken) || {};
    const mapping = token.supplier_identifier_to_id_mapping || {};

    let supplierIdentifier =
        supplier.identifier ||
        preferredIdentifier ||
        (Array.isArray(token.supplier_identifiers) ? token.supplier_identifiers[0] : null) ||
        Object.keys(mapping)[0] ||
        null;

    let supplierId =
        supplier.supplier_id ??
        (supplierIdentifier && mapping[supplierIdentifier] !== undefined ? mapping[supplierIdentifier] : null);

    // A seller with exactly one account: the mapping alone settles both.
    if (supplierId === null && Object.keys(mapping).length === 1) {
        supplierIdentifier = Object.keys(mapping)[0];
        supplierId = mapping[supplierIdentifier];
    }

    return {
        supplierId: supplierId === null || supplierId === undefined ? null : supplierId,
        supplierIdentifier: supplierIdentifier || null,
    };
}

/**
 * Evaluated INSIDE a signed-in page — Puppeteer's login and the desktop app's
 * capture both run this, so "what a session is" has one definition.
 *
 * Resolves to `{ supplierId, supplierIdentifier }` or `{ error }`.
 *
 * A string because Trackvid-CMS has no Puppeteer: it evaluates this with
 * webContents.executeJavaScript. Self-contained for the same reason — it cannot
 * close over anything in this module.
 */
const IDENTITY_PAGE_SCRIPT = `(async () => {
    try {
        var slugMatch = /\\/panel\\/v\\d+\\/new\\/[^/]+\\/([A-Za-z0-9_-]{3,32})(?:[/?#]|$)/.exec(location.href);
        var slug = slugMatch ? slugMatch[1] : "";

        const r = await fetch(${JSON.stringify(SUPPLY_DATA_PATH)}, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identifier: slug }),
            credentials: "include",
        });

        if (!r.ok) {
            return { error: "prefetch-supply-data answered HTTP " + r.status + " — the session may not be signed in yet" };
        }

        const body = await r.json().catch(() => null);

        if (!body) return { error: "prefetch-supply-data returned a body that was not JSON" };

        var supplier = body.supplier || {};
        var token = (body.registrationStatus && body.registrationStatus.decodedToken) || {};
        var mapping = token.supplier_identifier_to_id_mapping || {};
        var ids = Object.keys(mapping);

        var supplierIdentifier = supplier.identifier || slug || (token.supplier_identifiers || [])[0] || ids[0] || null;
        var supplierId = supplier.supplier_id;

        if (supplierId === undefined || supplierId === null) {
            supplierId = supplierIdentifier && mapping[supplierIdentifier] !== undefined
                ? mapping[supplierIdentifier]
                : (ids.length === 1 ? mapping[ids[0]] : null);
        }

        if (supplierId === null || supplierId === undefined) {
            return { error: "prefetch-supply-data answered without a supplier id" };
        }

        return { supplierId: supplierId, supplierIdentifier: supplierIdentifier };
    } catch (err) {
        return { error: "prefetch-supply-data could not be reached: " + (err && err.message ? err.message : String(err)) };
    }
})()`;

// The identity call is NOT addressed like the panel's other calls, and the
// difference is not cosmetic. Verified from the capture:
//
//   prefetch-supply-data   client-type: web      no client-package-version
//   every panel call       client-type: d-web    client-package-version 1.2.3
//
// Sending the panel's headers to this endpoint is answered by the edge with
// 403 "Access Denied" — an HTML page, not Meesho — which reads as a dead
// session and sends a perfectly good one back through a browser sign-in.
const IDENTITY_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const CLIENT_HINTS = {
    "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
};

/**
 * The supplier's ids as the session's OWN cookies carry them — no network.
 *
 * The portal sets `current_az_identifier` (the slug, e.g. "dg97w") and `s_id`
 * (the numeric id, e.g. 3438) on every signed-in browser, and a captured jar
 * keeps them. A stored session that lost its `supplierIdentifier` was stuck
 * without this: the identity endpoint below REFUSES a request with no
 * identifier (HTTP 403 "Identifier not present or invalid"), so it could not
 * repair itself, and every call keyed on the identifier — opening a ticket —
 * answered HTTP 204 with nothing in it (observed 2026-10-30).
 *
 * @param {Record<string, string>|Array<{name: string, value: string}>} jar
 * @returns {{ supplierId: number|null, supplierIdentifier: string|null }}
 */
function identityFromCookies(jar) {
    const read = (name) => {
        if (Array.isArray(jar)) {
            const hit = jar.find((cookie) => cookie && cookie.name === name);
            return hit ? String(hit.value || "").trim() : "";
        }
        return jar && typeof jar === "object" ? String(jar[name] || "").trim() : "";
    };
    const id = Number(read("s_id"));
    const slug = read("current_az_identifier");

    return {
        supplierId: Number.isFinite(id) && id > 0 ? id : null,
        // Meesho's slugs are short lowercase alphanumerics; anything else is not one.
        supplierIdentifier: /^[a-z0-9]{3,20}$/i.test(slug) ? slug : null,
    };
}

/**
 * The same question over plain HTTP, for a stored session that carries cookies
 * and nothing else. Repairs it without opening a browser — which is the whole
 * point: a session whose cookies still work should never cost a sign-in.
 *
 * Headers are built here, exactly as the portal sends them, rather than taken
 * from the caller: this endpoint's are different from every other call's, and
 * the one time they were shared it cost a sign-in per account.
 *
 * @param {{ jar: Record<string,string>, supplierIdentifier?: string|null }} record
 * @param {{ timeout?: number, userAgent?: string }} [options]
 * @returns {Promise<{ supplierId: number|null, supplierIdentifier: string|null }>}
 */
async function fetchSupplierIdentity(record, { timeout = 20000, userAgent = IDENTITY_UA } = {}) {
    const axios = require("axios");
    const { cookieHeader } = require("../../../common/sessionHelpers");

    // The identifier the endpoint insists on — the record's, else the cookie's.
    const known =
        (record && record.supplierIdentifier) || identityFromCookies(record && record.jar).supplierIdentifier || "";

    const res = await axios.post(
        `${ORIGIN}${SUPPLY_DATA_PATH}`,
        { identifier: known },
        {
            headers: {
                "content-type": "application/json;charset=UTF-8",
                "user-agent": userAgent,
                // `web`, not `d-web`. See above.
                "client-type": "web",
                ...(known ? { identifier: known } : {}),
                ...CLIENT_HINTS,
                Referer: known ? `${ORIGIN}/panel/v3/new/growth/${known}/home` : `${ORIGIN}/`,
                cookie: cookieHeader((record && record.jar) || {}),
            },
            maxRedirects: 0,
            validateStatus: () => true,
            timeout,
        }
    );

    if (res.status !== 200 || !res.data || typeof res.data !== "object") {
        const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");
        const err = new Error(
            `Meesho supplier identity: HTTP ${res.status} ${body.replace(/\s+/g, " ").slice(0, 160)}`
        );
        err.code = "MEESHO_IDENTITY_FAILED";
        err.status = res.status;
        throw err;
    }

    return identityFromSupplyData(res.data, known || null);
}

module.exports = {
    ORIGIN,
    IDENTITY_UA,
    SUPPLY_DATA_PATH,
    IDENTITY_PAGE_SCRIPT,
    fetchSupplierIdentity,
    identityFromSupplyData,
    identityFromCookies,
    identifierFromUrl,
};
