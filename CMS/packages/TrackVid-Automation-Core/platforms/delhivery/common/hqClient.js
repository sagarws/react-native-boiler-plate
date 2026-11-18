// -----------------------------------------------------------------------------
// Delhivery One — HQ client resolution for the `x-hq-client-id` header
// -----------------------------------------------------------------------------
// Every /web/api/claims/* and /web/api/support/* call on the UCP gateway is
// scoped to an HQ CLIENT, named by the `x-hq-client-id` request header. Get it
// wrong and the gateway answers:
//
//   403 { error_code: "FORBIDDEN", message: "User unauthorised to access mentioned client!" }
//
// which is NOT a dead session — the token is valid and the profile probe still
// passes, so re-logging in loops forever on the same 403.
//
// The value used to come from GET /p/tenants?email=<email>, but that endpoint
// answers REALM DISCOVERY: it returns the seller's COMPANY (the same uuid the
// access token carries as `ucp_company_id`). A company is not an HQ client, and
// on a multi-client account the two never coincide. Observed on
// johnson@wrogn.com:
//
//   ucp_company_id     94a4dca1-2d76-4f38-a958-be14c5d0d332   <- what we sent
//   allowed_hq_clients cms::client::f21a90b3-f015-11ee-b245-06c7672f963d
//                      cms::client::0796af0f-52a5-11f1-8d4f-0acfbd2bd84d
//
// The access token itself is the authority, so that is where the id comes from
// now. `allowed_hq_clients` entries are CMS URNs and the header wants them
// VERBATIM, prefix included — confirmed against the portal's own 200 in
// ApiDocs/55406810251156.json:
//
//   X-HQ-Client-Id: cms::client::0796af0f-52a5-11f1-8d4f-0acfbd2bd84d
//
// Sending the bare uuid tail is refused exactly like sending the company uuid.
//
// When the token allows MORE than one client (`has_multiple_hq_client: "true"`)
// there is nothing in the claim to say which one owns a given AWB; the portal
// makes a human pick from a switcher. We probe instead: the cheapest claims call
// (lost_damage/list with only_count) is fired once per candidate and the first
// that is not refused wins. The winner is persisted on the session record so the
// probe happens once per credential, not once per batch.
// -----------------------------------------------------------------------------

const axios = require("axios");
const { GATEWAY_HOST } = require("./sessionStore");

const PROBE_TIMEOUT_MS = 20_000;

// The header carries the full URN. Entries already come that way out of the
// token; a bare uuid (a hand-set override, an older cached value) is promoted to
// URN form so both shapes end up as the one thing the gateway accepts.
const CLIENT_URN_PREFIX = "cms::client::";

function normalizeHqClientId(entry) {
    const s = String(entry || "").trim();
    if (!s) return null;
    if (s.includes("::")) return s;
    return `${CLIENT_URN_PREFIX}${s}`;
}

// Decode a JWT payload without verifying it. We are reading OUR OWN token,
// minted seconds ago by Keycloak over TLS — there is no trust decision here,
// only a lookup, so a signature check would buy nothing.
function decodeJwtPayload(token) {
    try {
        const part = String(token || "").split(".")[1];
        if (!part) return null;
        return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    } catch (_) {
        return null;
    }
}

/**
 * Every HQ client this access token is allowed to act on, as bare uuids.
 * Empty array when the claim is absent (single-client legacy accounts).
 */
function allowedHqClients(accessToken) {
    const payload = decodeJwtPayload(accessToken);
    const raw = payload?.allowed_hq_clients;
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeHqClientId).filter(Boolean);
}

function companyIdFromToken(accessToken) {
    return decodeJwtPayload(accessToken)?.ucp_company_id || null;
}

// A candidate is "accepted" when the gateway does anything other than refuse
// the client id. 200 obviously passes; so does a 4xx that is about the REQUEST
// (400 bad range, 404 no rows) rather than about who we claim to be — those
// prove the header got past authorization. Only 401/403 disqualify.
async function probeHqClient(ctx, hqClientId) {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    try {
        const res = await axios({
            method: "post",
            url: `${GATEWAY_HOST}/web/api/claims/lost_damage/list`,
            data: {
                search_on: ["awb_number"],
                search_type: "CONTAINS",
                search_term: "",
                page_size: 1,
                page: 1,
                only_count: true,
                range_created_at: [
                    { op: "GTE", value: start.toISOString() },
                    { op: "LTE", value: now.toISOString() },
                ],
                range_updated_at: [{ op: "EQ", value: "" }],
            },
            headers: {
                accept: "application/json, text/plain, */*",
                authorization: `${ctx.tokenType || "Bearer"} ${ctx.accessToken}`,
                "content-type": "application/json",
                origin: "https://one.delhivery.com",
                referer: "https://one.delhivery.com/",
                "x-hq-client-id": hqClientId,
            },
            validateStatus: () => true,
            timeout: PROBE_TIMEOUT_MS,
        });
        return { ok: res.status !== 401 && res.status !== 403, status: res.status };
    } catch (err) {
        // A transport failure says nothing about the client id — do not let it
        // eliminate a candidate that might be the right one.
        return { ok: false, status: null, error: err.message };
    }
}

/**
 * Resolve the `x-hq-client-id` for this session.
 *
 * @param {object} ctx      session ctx — needs accessToken/tokenType, and
 *                          hqClientId when one was already cached
 * @param {object} opts
 * @param {string} opts.username  for log lines
 * @returns {Promise<{hqClientId: string|null, source: string, candidates: string[]}>}
 */
async function resolveHqClientId(ctx, { username = "unknown" } = {}) {
    const candidates = allowedHqClients(ctx.accessToken);

    // Already resolved on a previous run and still allowed — reuse it. The
    // "still allowed" check matters: a client can be revoked between runs, and
    // a stale cached id would 403 every AWB with no clue why.
    if (ctx.hqClientId) {
        const cached = normalizeHqClientId(ctx.hqClientId);
        if (!candidates.length || candidates.includes(cached)) {
            return { hqClientId: cached, source: "cached", candidates };
        }
        console.warn(
            `   ⚠️ [delhivery/hq-client] Cached client ${ctx.hqClientId} for ${username} is no longer in the token's allowed list — re-resolving`
        );
    }

    if (!candidates.length) {
        // No claim in the token: single-client account, where the company id IS
        // the client id. This is the old behaviour, kept for exactly the shape
        // it was accidentally right for.
        const companyId = companyIdFromToken(ctx.accessToken) || ctx.tenantId || null;
        if (companyId) {
            console.log(
                `   🏢 [delhivery/hq-client] ${username}: no allowed_hq_clients claim — falling back to company id ${companyId}`
            );
        } else {
            console.warn(
                `   ⚠️ [delhivery/hq-client] ${username}: no allowed_hq_clients claim and no company id — x-hq-client-id will be OMITTED and every claims call will 403`
            );
        }
        return { hqClientId: companyId, source: "company-fallback", candidates };
    }

    if (candidates.length === 1) {
        console.log(`   🏢 [delhivery/hq-client] ${username}: ${candidates[0]} (only allowed client)`);
        return { hqClientId: candidates[0], source: "token", candidates };
    }

    console.log(
        `   🔎 [delhivery/hq-client] ${username} has ${candidates.length} allowed clients — probing for the one that serves claims...`
    );
    const refusals = [];
    for (const candidate of candidates) {
        const { ok, status, error } = await probeHqClient(ctx, candidate);
        if (ok) {
            console.log(`   🏢 [delhivery/hq-client] ${username}: ${candidate} (probe HTTP ${status})`);
            return { hqClientId: candidate, source: "probe", candidates };
        }
        refusals.push(`${candidate}→${error ? error : `HTTP ${status}`}`);
    }

    // Every candidate refused. Send the first anyway rather than omitting the
    // header: the caller's 403 then carries Delhivery's own wording, which is
    // more useful to whoever reads the log than a silent missing header.
    console.warn(
        `   ⚠️ [delhivery/hq-client] ${username}: no allowed client accepted the claims module (${refusals.join(", ")}) — using ${candidates[0]}`
    );
    return { hqClientId: candidates[0], source: "probe-exhausted", candidates };
}

module.exports = {
    allowedHqClients,
    companyIdFromToken,
    decodeJwtPayload,
    normalizeHqClientId,
    probeHqClient,
    resolveHqClientId,
    CLIENT_URN_PREFIX,
};
