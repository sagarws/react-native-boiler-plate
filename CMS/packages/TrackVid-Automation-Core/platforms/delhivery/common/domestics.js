// -----------------------------------------------------------------------------
// Delhivery One — the "Domestic" accounts a login can act on
// -----------------------------------------------------------------------------
// The portal's header switcher is titled "Domestic" and lists the seller's HQ
// clients ("STYLEVERSE B2C", "UNIVERSAL SPORTSBIZ EXPRESS", …). A claim names
// one. The list is what the portal itself loads on boot:
//
//   GET https://ucp-app-gateway.delhivery.com/web/api/company/configurations/list_client_mappings
//
//   { result_count, results: [{ hq_client_id, hq_client_name, service_type,
//                               mapping_status, disabled, … }],
//     last_evaluated_key }
//
// This is Delhivery's answer to AJIO's POB list and Tata CliQ's slaves: read
// per credential, stored on it, and offered on the claim form. ⚠️ like the
// shipment search, `total_count` is 0 on a populated answer — `results` is the
// truth.
//
// Only MAPPED, enabled clients are returned: an unmapped or disabled one is not
// in the portal's switcher either, and a claim filed against it is refused.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { GATEWAY_HOST, refreshAccessToken } = require("./sessionStore");

const LIST_URL = `${GATEWAY_HOST}/web/api/company/configurations/list_client_mappings`;
const REQ_TIMEOUT_MS = 20_000;
// A seller with more clients than pages this deep is not a real account; the
// cap only stops a gateway that keeps handing back the same key from looping.
const MAX_PAGES = 20;

function headersFor(ctx) {
    return {
        accept: "*/*",
        authorization: `${ctx.tokenType || "Bearer"} ${ctx.accessToken}`,
        "content-type": "application/json",
        origin: "https://one.delhivery.com",
        referer: "https://one.delhivery.com/",
        // Sent empty, as the portal sends it: this call lists the clients, so
        // it cannot be scoped to one of them.
        "x-hq-client-id": "",
    };
}

/**
 * One gateway row → a Domestic entry, or null when it is not one a claim can use.
 *
 * Pure, exported for tests.
 */
function domesticFromMapping(row) {
    if (!row || typeof row !== "object") return null;
    if (row.disabled === true) return null;
    if (row.mapping_status && String(row.mapping_status).toUpperCase() !== "MAPPED") return null;

    const id = String(row.hq_client_id || row.mapping_data?.uuid || "").trim();
    const name = String(row.hq_client_name || row.mapping_data?.client_name || "").trim();

    if (!id || !name) return null;

    return { id, name, serviceType: String(row.service_type || "").trim() || null };
}

async function fetchPage(ctx, lastKey) {
    return axios({
        method: "get",
        url: LIST_URL,
        params: lastKey ? { last_evaluated_key: typeof lastKey === "string" ? lastKey : JSON.stringify(lastKey) } : undefined,
        headers: headersFor(ctx),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });
}

/**
 * Every Domestic account this session can act on.
 *
 * Uses the session's access token as-is. On a 401 with a refresh token at hand
 * it refreshes ONCE and retries — the token lives ten minutes, and a caller
 * reading a stored session may well hold an expired one. The refreshed tokens
 * come back as `refreshed` so the caller can store them; this function never
 * writes anywhere.
 *
 * @param {object} ctx  a Delhivery session context — accessToken, tokenType,
 *                      and for the refresh: refreshToken, realm, clientId
 * @returns {Promise<{ domestics: {id: string, name: string, serviceType: string|null}[],
 *                     refreshed: object|null }>}
 * @throws when the gateway refuses the session or answers anything but 200
 */
async function listDelhiveryDomestics(ctx) {
    if (!ctx?.accessToken) throw new Error("listDelhiveryDomestics: the session has no access token");

    let session = ctx;
    let refreshed = null;
    const byId = new Map();
    let lastKey = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
        let res = await fetchPage(session, lastKey);

        if (res.status === 401 && !refreshed && session.refreshToken && session.realm) {
            refreshed = await refreshAccessToken(session);

            if (refreshed) {
                session = { ...session, ...refreshed };
                res = await fetchPage(session, lastKey);
            }
        }

        if (res.status !== 200) {
            const err = new Error(
                `Delhivery list_client_mappings answered HTTP ${res.status}` +
                    (res.status === 401 || res.status === 403 ? " — the saved session is no longer accepted" : "")
            );
            err.status = res.status;
            throw err;
        }

        const rows = Array.isArray(res.data?.results) ? res.data.results : [];

        for (const row of rows) {
            const domestic = domesticFromMapping(row);

            // First occurrence wins: within one listing there is no "newer".
            if (domestic && !byId.has(domestic.id)) byId.set(domestic.id, domestic);
        }

        const next = res.data?.last_evaluated_key;

        if (!next || JSON.stringify(next) === JSON.stringify(lastKey)) break;
        lastKey = next;
    }

    return { domestics: [...byId.values()], refreshed };
}

module.exports = { listDelhiveryDomestics, domesticFromMapping, LIST_URL };
