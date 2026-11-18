/**
 * Flipkart Seller Hub — SPF claim direct-API flow.
 *
 * Replaces the Selenium UI navigation (SPF page → Raise New Claim → order-id
 * modal → form fill → Submit → Processing tab lookup) with the same GraphQL
 * operations the portal itself calls. Mirrors the structure of
 * myntraAutoMation/myntraAutoClaim/claimApiFlow.js so both API flows read alike.
 *
 * Auth is HYBRID, exactly like the Myntra API flow: Selenium performs the login
 * (Flipkart gates it behind an emailed OTP — see utils.fetchLatestFlipkartOtp),
 * then the session cookies are handed to axios. The browser is torn down
 * immediately afterwards; everything from that point is HTTP.
 *
 * Verified against a full portal capture (api-network-records.json, 195 entries,
 * one complete claim raised by hand on 2026-08-18). Chronological flow:
 *
 *   POST /getStateDetails → /login → /verifyOtp        (Selenium does this)
 *   NAPI Payments_SPF_WEB_getOrderSearch(trackingId)   → return_item_list[]
 *   NAPI Payments_SPF_WEB_getProductTypes()            → ["Main Product", ...]
 *   NAPI Payments_SPF_WEB_getIssueTypes(productType)   → issue strings
 *   POST /napi/payments-rest/uploadSpfClaimFile        → { url } per file
 *   NAPI Payments_SPF_WEB_createclaimV2(...)           → (claim_id is NULL here)
 *   ORCH GetSpfClaimCountsOrchestrator(searchText)     → which state tab(s) hold it
 *   ORCH GetSpfClaimsOrchestrator(state, tracking_id)  → claimId, status, approvedAmount
 *   NAPI returns_searchReturnItem(tracking_id)         → is this AWB on this account
 *
 * Note createClaimV2 returns nulls for claim_id/incident_id even on success —
 * that is why the claim id is read back from the claims list afterwards,
 * exactly as the UI does.
 *
 * Re-verified against a second capture (Chrome 152, 2026-09-15: login with OTP,
 * claim, ticket search, global AWB search). Every operation, its variables and
 * the response fields this file reads are written up in FLIPKART_API.md next to
 * this file, with JSDoc shapes in flipkartApiTypes.js. When an API breaks, start
 * there.
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
// Shared >= 400 response logging (src/helper/apiResponseLogger.js) — same line shape
// on every claim platform, so one grep finds a failed call anywhere.
const { logApiFailure } = require("../../../../common/apiResponseLogger");
const FormData = require("form-data");

// Login reuses the existing Selenium launcher + OTP handling. Single source of
// truth with the UI flow.
const { buildDriver, flipkartLogin } = require("../common/utils");

// Per-credential session cache (companies doc). Lets a run skip the visible
// Chrome + OTP entirely when a previous session is still alive.
const { getUsableSession, saveSession, clearSession } = require("../../common/sessionStore");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");
const { normalizeLoose } = require("../../../../common/text");
const { flipkartWindowExpired } = require("../../../../common/claimErrors");

const ORIGIN = "https://seller.flipkart.com";
const NAPI_GRAPHQL = `${ORIGIN}/napi/graphql`;
const ORCH_GRAPHQL = `${ORIGIN}/orchestrator/graphql`;
const UPLOAD_URL = `${ORIGIN}/napi/payments-rest/uploadSpfClaimFile`;

// A real Chrome UA — the portal's edge rejects obvious bots.
const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

// Client Hints, copied from the capture. Flipkart's bot layer inspects these.
// Keep the UA major version and these in step — a Chrome 151 UA with Chrome 152
// hints is exactly the kind of mismatch a bot filter looks for.
const CLIENT_HINTS = {
    "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    "sec-ch-ua-arch": '"x86"',
    "sec-ch-ua-full-version": '"152.0.7977.83"',
    "sec-ch-ua-full-version-list":
        '"Chromium";v="152.0.7977.83", "Not?A_Brand";v="24.0.0.0", "Google Chrome";v="152.0.7977.83"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-model": '""',
    "sec-ch-ua-platform": '"macOS"',
    "sec-ch-ua-platform-version": '"15.7.0"',
};

const REQ_TIMEOUT_MS = Number(process.env.FLIPKART_SPF_TIMEOUT_MS || 60000);

const dbg = (...a) => {
    if (process.env.FLIPKART_API_DEBUG === "true") console.log("[flipkart-spf]", ...a);
};

// ---------------------------
// 🍪 Cookie jar (dumb {name:value} bag; single domain)
// ---------------------------
function cookieHeader(jar) {
    return Object.entries(jar || {})
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

// The portal sends x-location-id: LOC<32 hex> on every call. Where the page gets
// it is not in either capture — no response and no cookie carries that value —
// and every call has worked with it empty. So it stays empty unless a caller
// knows better (ctx.locationId) or ops pin one (FLIPKART_LOCATION_ID).
function locationIdOf(ctx) {
    return (ctx && ctx.locationId) || process.env.FLIPKART_LOCATION_ID || "";
}

// Shared headers for both GraphQL endpoints. `operation`/`operation-name` are
// not decoration — the portal sends them on every call and the gateway routes
// on them.
function gqlHeaders(ctx, { operation, operationName, orchestrator = false }) {
    const base = {
        "user-agent": UA,
        accept: "*/*",
        "content-type": "application/json",
        Referer: `${ORIGIN}/index.html`,
        "fk-csrf-token": ctx.csrfToken,
        operation,
        "operation-name": operationName,
        "x-internal-env-type": "WEB",
        "x-location-id": locationIdOf(ctx),
        "x-requested-with": "XMLHttpRequest",
        ...CLIENT_HINTS,
        cookie: cookieHeader(ctx.jar),
    };
    if (orchestrator) {
        // The orchestrator gateway additionally scopes by seller. Both ids carry
        // the seller id — verified in the capture, x-user-id is NOT the ACC… user
        // id that /verifyOtp returns.
        base["x-client-id"] = "SD";
        base["x-seller-id"] = ctx.sellerId || "";
        base["x-user-id"] = ctx.sellerId || "";
    }
    return base;
}

// 401/403 means the cookies died mid-batch. Tagged so the runner can re-login
// once and retry instead of failing every remaining AWB.


// GraphQL answers 200 with an `errors` array rather than an HTTP error code, so
// a status check alone would treat every failure as success.
function gqlError(step, res) {
    const data = res.data || {};
    const errs = data.errors || data.graphErrors || [];
    if (Array.isArray(errs) && errs.length > 0) {
        const msg = errs.map((e) => e && (e.message || e.errorMessage)).filter(Boolean).join("; ");
        const err = new Error(`${step}: ${msg || "GraphQL error"}`);
        err.code = "FLIPKART_API_ERROR";
        err.step = step;
        return err;
    }
    return null;
}

/**
 * Is this worth trying again?
 *
 * Flipkart reports its own timeouts as an HTTP 200 carrying a GraphQL error —
 * `message: "Request Timed Out"`, `httpStatus: 408` — so a plain status check
 * never sees them. One `getIssueTypes` timing out failed a whole claim while
 * the identical call for the next claim answered immediately, which is the
 * shape of a transient fault, not a broken request.
 *
 * Deliberately narrow: gateway and timeout conditions only. A 4xx that is not
 * 408 is the request being wrong, and repeating it just fails slower.
 */
function isTransient(err) {
    const message = String(err?.message || "");

    return (
        /Request Timed Out|ETIMEDOUT|ECONNABORTED|ECONNRESET|socket hang up/i.test(message) ||
        /HTTP (408|429|500|502|503|504)\b/.test(message)
    );
}

const GQL_RETRIES = 2;
const GQL_RETRY_DELAY_MS = 1500;

/**
 * READS are retried; WRITES are not.
 *
 * `operation === "query"` is safe to repeat — asking twice for the issue-type
 * list costs a round trip. A mutation is not: `createClaimV2` has already
 * reached Flipkart by the time a timeout is reported, and repeating it is how
 * one parcel gets two claims. A timed-out mutation must surface as a failure
 * so a human decides.
 */
async function gqlCall(ctx, options) {
    const attempts = options.operation === "query" ? GQL_RETRIES + 1 : 1;
    let lastErr;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await gqlCallOnce(ctx, options);
        } catch (err) {
            lastErr = err;

            if (attempt === attempts || !isTransient(err)) throw err;

            (ctx?.logger?.warn || console.warn).call(
                ctx?.logger || console,
                `↻ ${options.step}: ${err.message} — retrying (${attempt}/${GQL_RETRIES})`
            );

            await new Promise((resolve) => setTimeout(resolve, GQL_RETRY_DELAY_MS * attempt));
        }
    }

    throw lastErr;
}

async function gqlCallOnce(ctx, { url, operation, operationName, query, variables, step }) {
    const res = await axios.post(
        url,
        { operationName, variables, query },
        {
            headers: gqlHeaders(ctx, {
                operation,
                operationName,
                orchestrator: url === ORCH_GRAPHQL,
            }),
            validateStatus: () => true,
            timeout: REQ_TIMEOUT_MS,
        }
    );

    if (res.status >= 400) {
        logApiFailure({ platform: "flipkart", step, method: "POST", url, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        // The status rides ON the error. Callers need to tell a 5xx apart from
        // a refused payload — one may have been applied anyway and must be
        // verified before it is reported as a failure, the other never was —
        // and matching that out of a message string is how such a check breaks
        // the next time the wording changes.
        const err = new Error(`${step} failed: HTTP ${res.status} ${httpBodySummary(res.data)}`);

        err.status = res.status;
        throw err;
    }
    // GraphQL reports business failures as HTTP 200 with an `errors` array, so a 200 that
    // carries errors is an API failure too — log it alongside the real 4xx/5xx.
    const err = gqlError(step, res);
    if (err) {
        if (res.status < 400) {
            logApiFailure({ platform: "flipkart", step, method: "POST", url, status: `200/GraphQL`, data: res.data, logger: ctx && ctx.logger });
        }
        throw err;
    }
    return res.data && res.data.data;
}

// ---------------------------
// 🔐 Login (Selenium bootstrap → cookie jar + CSRF token + sellerId)
// ---------------------------
// Flipkart's fk-csrf-token is a DOUBLE-SUBMIT token: the value sent in the
// header is also stored in a cookie, and the server answers 403 EBADCSRFTOKEN
// ("Your session seems out of sync") the moment the two disagree. So discovery
// is really "which cookie holds it", and getting it wrong poisons every call.
//
// Verified across 5 accounts on 2 companies: the cookie is always named
// XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h. Obfuscated, but stable. Override with
// FLIPKART_CSRF_COOKIE_NAME if Flipkart rotates it.
const CSRF_COOKIE_NAME = process.env.FLIPKART_CSRF_COOKIE_NAME || "XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h";

// Shape of the real token: two segments, exactly ONE hyphen, e.g.
//   JzRq1dXU-xfSW3HQfPsbi6C8geegObhMgcgQ
// The tail deliberately excludes hyphens. An earlier version allowed them, so a
// UUID matched — which is how `moe_uuid` (MoEngage analytics, also 36 chars) got
// stored as the csrf token and 403'd every call those accounts made.
const CSRF_PATTERN = /^[A-Za-z0-9_]{6,12}-[A-Za-z0-9_]{20,32}$/;

// Cookies that can never be the csrf token however they look. Analytics vendors
// love UUID-ish values, and a false positive here is silent: the session looks
// healthy and every API call 403s.
const CSRF_COOKIE_DENYLIST = [
    /^moe_uuid$/i, /^_ga/i, /^_gid$/i, /^_gcl_au$/i, /^_fbp$/i,
    /^mp_/i, /^AMCVS?_/i, /^s_nr$/i, /^experiment$/i, /^DID$/i,
];

const isDeniedCsrfCookie = (name) => CSRF_COOKIE_DENYLIST.some((re) => re.test(name));

async function discoverCsrfToken(driver, jar) {
    // 0. Operator override — wins over every heuristic below.
    const forced = process.env.FLIPKART_CSRF_COOKIE_NAME;
    if (forced && jar[forced]) {
        dbg(`  csrf from FLIPKART_CSRF_COOKIE_NAME=${forced}`);
        return jar[forced];
    }
    // 1. The known cookie, by name. This is the answer in every observed case.
    if (jar[CSRF_COOKIE_NAME]) {
        dbg(`  csrf from cookie "${CSRF_COOKIE_NAME}"`);
        return jar[CSRF_COOKIE_NAME];
    }
    // 2. A cookie whose NAME mentions csrf, in case Flipkart renames it to
    //    something self-describing.
    for (const [name, value] of Object.entries(jar)) {
        if (/csrf/i.test(name) && value && !isDeniedCsrfCookie(name)) {
            dbg(`  csrf from cookie name "${name}"`);
            return value;
        }
    }
    // 3. Shape match, analytics cookies excluded. Last resort — if this fires,
    //    the cookie name has changed and CSRF_COOKIE_NAME needs updating, so it
    //    warns rather than passing silently.
    for (const [name, value] of Object.entries(jar)) {
        if (isDeniedCsrfCookie(name)) continue;
        if (CSRF_PATTERN.test(String(value || ""))) {
            console.warn(
                `⚠️ [flipkart] csrf token matched by SHAPE from cookie "${name}" — ` +
                `"${CSRF_COOKIE_NAME}" was absent. Set FLIPKART_CSRF_COOKIE_NAME if this is wrong.`
            );
            return value;
        }
    }
    // 4. local/sessionStorage, plus any obvious page global — for a session
    //    where the cookie somehow never landed.
    try {
        const fromPage = await driver.executeScript(function () {
            var re = /^[A-Za-z0-9_]{6,12}-[A-Za-z0-9_]{20,32}$/;
            var stores = [window.localStorage, window.sessionStorage];
            for (var s = 0; s < stores.length; s++) {
                var store = stores[s];
                if (!store) continue;
                for (var i = 0; i < store.length; i++) {
                    var k = store.key(i);
                    var v = store.getItem(k);
                    if (!v) continue;
                    if (/csrf/i.test(k) && v.length < 120) return v;
                    if (re.test(v)) return v;
                    // Some apps stash it inside a JSON blob.
                    if (v.length < 5000 && /csrf/i.test(v)) {
                        try {
                            var parsed = JSON.parse(v);
                            for (var key in parsed) {
                                if (/csrf/i.test(key) && typeof parsed[key] === "string") return parsed[key];
                            }
                        } catch (e) { /* not json */ }
                    }
                }
            }
            var globals = ["__csrfToken", "csrfToken", "FK_CSRF_TOKEN", "__FK_CSRF__"];
            for (var g = 0; g < globals.length; g++) {
                if (typeof window[globals[g]] === "string") return window[globals[g]];
            }
            return null;
        });
        if (fromPage) {
            dbg("  csrf from page storage");
            return fromPage;
        }
    } catch (err) {
        dbg(`  csrf page lookup failed: ${err.message}`);
    }
    return null;
}

// OTP-step signatures thrown by the login flow. Mirrors scriptNew.js — the
// mail can simply be slow, and a fresh browser usually clears it.
function isOtpStuckError(err) {
    const msg = (err && err.message) || String(err || "");
    return /OTP_FETCH_FAILED|OTP_ENTRY_FAILED|OTP|otp[-_ ]?input/i.test(msg);
}

/**
 * Logs in with Selenium, harvests cookies + CSRF token, closes the browser.
 * Returns the ctx object every other function in this file takes.
 *
 * `maxAttempts` retries ONLY an OTP-stuck login, tearing the browser down in
 * between so the retry starts from clean cookies/storage. The caller scales it
 * with batch size for the same reason the Selenium runner does: one flaky OTP
 * otherwise fails every AWB that shares this login.
 *
 * `fetchOtp`, `operatorFallback` and `operatorTimeoutMs` go straight to
 * `flipkartLogin`, and only when given. Dropping them made the desktop app's
 * session capture read Gmail from an environment only the server has: it worked
 * in development (where .env is loaded) and failed every OTP in the packaged
 * app. Omitted, the login reads Gmail exactly as it always has.
 */
async function loginFlipkartApi(
    credentials,
    { maxAttempts = 2, forceFresh = false, fetchOtp, operatorFallback, operatorTimeoutMs } = {},
) {
    const otpOptions = {
        ...(fetchOtp !== undefined ? { fetchOtp } : {}),
        ...(operatorFallback !== undefined ? { operatorFallback } : {}),
        ...(operatorTimeoutMs !== undefined ? { operatorTimeoutMs } : {}),
    };
    const email = credentials.username;
    const cacheKey = { credentialId: credentials._id, username: email };
    const started = Date.now();

    // Reuse a stored session when one is present, unexpired and still accepted
    // by Flipkart. That skips the whole browser+OTP login. `forceFresh` is set
    // by the renew endpoint and by the mid-batch relogin path, where we already
    // know the stored session is no good.
    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        // Drop it before logging in, so a crash between here and the save can't
        // leave a known-dead session for the next run to trip over.
        await clearSession(cacheKey, "forced fresh login");
    }

    let driver = null;
    let jar = {};
    let csrfToken = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        jar = {};
        csrfToken = null;
        dbg(`🌐 Selenium login for ${email} (attempt ${attempt}/${maxAttempts})...`);
        try {
            driver = await buildDriver();
            await flipkartLogin(driver, credentials, otpOptions);

            for (const c of await driver.manage().getCookies()) {
                if (c && c.name) jar[c.name] = c.value;
            }
            dbg(`  ← ${Object.keys(jar).length} cookies: ${Object.keys(jar).join(", ")}`);

            csrfToken = await discoverCsrfToken(driver, jar);
            lastErr = null;
            if (attempt > 1) console.log(`✅ Flipkart login succeeded on attempt ${attempt}/${maxAttempts}`);
            break;
        } catch (err) {
            lastErr = err;
            if (!isOtpStuckError(err) || attempt === maxAttempts) break;
            console.warn(
                `⚠️ Flipkart login attempt ${attempt}/${maxAttempts} stuck at OTP (${err.message}). Retrying...`
            );
            // Breather so a merely-slow OTP mail has time to land.
            await new Promise((r) => setTimeout(r, 6000));
        } finally {
            if (driver) {
                try { await driver.quit(); } catch (_) { /* already gone */ }
                driver = null;
            }
        }
    }

    if (lastErr) throw lastErr;

    if (Object.keys(jar).length === 0) {
        const err = new Error("Flipkart login: no cookies after Selenium bootstrap");
        err.code = "LOGIN_NO_COOKIES";
        throw err;
    }
    if (!csrfToken) {
        // Every mutating call needs it; failing here beats a wall of 403s.
        const err = new Error(
            "Flipkart login: could not locate fk-csrf-token in cookies or page storage. " +
            "Set FLIPKART_CSRF_COOKIE_NAME to the cookie that holds it."
        );
        err.code = "LOGIN_NO_CSRF";
        throw err;
    }

    dbg(`✅ Login done in ${Date.now() - started}ms`);

    // Persist for the next run. Best-effort by design — see sessionStore.
    await saveSession({
        ...cacheKey,
        jar,
        csrfToken,
        source: forceFresh ? "renew-endpoint" : "claim-api",
    });

    return { jar, csrfToken, sellerId: null };
}

// ---------------------------
// 🔎 Step 1 — order search (replaces the order-id modal)
// ---------------------------
const Q_ORDER_SEARCH = `query Payments_SPF_WEB_getOrderSearch($query: String!) {
  getOrderSearch(query: $query) {
    return_item_list {
      sku
      title
      order_item_id
      order_id
      return_id
      claim_type
      status
      claim_eligible
      claim_details {
        claim_id
        incident_id
        claim_status
        claim_amount
        claim_status_reason
        __typename
      }
      tracking_id
      service_profile
      shipment_type
      shipment_status
      auto_claim_type
      sub_reason
      eligible_quantity
      total_quantity
      quantity
      auto_payout
      completed_date
      seller_id
      type
      reason
      old_claim
      total_price
      product_image
      claim_eligible_reason
      shipment_expectation
      __typename
    }
    has_more
    next_page
    __typename
  }
}`;

/**
 * trackingId (the CMS awbNumber) → the return line item to claim against.
 *
 * Returns:
 *   { found: false, item: null,  claimId: null }   — nothing on this account
 *   { found: true,  item, claimId: null }          — claimable
 *   { found: true,  item, claimId: "..." }         — already claimed; the caller
 *                                                    records the id instead of
 *                                                    filing a duplicate
 */
async function getOrderSearch(ctx, trackingId) {
    if (!trackingId) throw new Error("getOrderSearch: trackingId is required");

    const data = await gqlCall(ctx, {
        url: NAPI_GRAPHQL,
        operation: "query",
        operationName: "Payments_SPF_WEB_getOrderSearch",
        query: Q_ORDER_SEARCH,
        variables: { query: String(trackingId) },
        step: "Order search",
    });

    const list = (data && data.getOrderSearch && data.getOrderSearch.return_item_list) || [];
    if (list.length === 0) return { found: false, item: null, claimId: null };

    // The capture only ever returned a single item per tracking id. If Flipkart
    // ever returns several, prefer a claim-eligible one so we don't stall on a
    // sibling line that was already settled.
    const item = list.find((r) => r && r.claim_eligible) || list[0];

    // Cache the seller id — the orchestrator endpoint needs it in a header and
    // this is the earliest place it appears.
    if (item && item.seller_id && !ctx.sellerId) ctx.sellerId = String(item.seller_id);

    const claimId = (item && item.claim_details && item.claim_details.claim_id) || null;
    return { found: true, item, claimId };
}

// ---------------------------
// 🏷️ Product / issue type vocabularies
// ---------------------------
const Q_PRODUCT_TYPES = `query Payments_SPF_WEB_getProductTypes {
  getProductTypes {
    product_type
    __typename
  }
}`;

// `String!` exactly as the portal declares it. A nullable declaration is a
// different operation to a strict GraphQL server.
const Q_ISSUE_TYPES = `query Payments_SPF_WEB_getIssueTypes($productType: String!) {
  getIssueTypes(productType: $productType) {
    Main_Product
    Combo_product
    Packaging
    Accessory
    Freebie
    __typename
  }
}`;

async function getProductTypes(ctx) {
    const data = await gqlCall(ctx, {
        url: NAPI_GRAPHQL,
        operation: "query",
        operationName: "Payments_SPF_WEB_getProductTypes",
        query: Q_PRODUCT_TYPES,
        variables: {},
        step: "Product types",
    });
    return (data && data.getProductTypes && data.getProductTypes.product_type) || [];
}

async function getIssueTypes(ctx, productType) {
    const data = await gqlCall(ctx, {
        url: NAPI_GRAPHQL,
        operation: "query",
        operationName: "Payments_SPF_WEB_getIssueTypes",
        query: Q_ISSUE_TYPES,
        variables: { productType },
        step: "Issue types",
    });
    const bag = (data && data.getIssueTypes) || {};
    // The response keys the list by product type with spaces turned into
    // underscores ("Main Product" → Main_Product).
    const key = String(productType || "").trim().replace(/\s+/g, "_");
    const list = bag[key];
    if (Array.isArray(list)) return list;
    // Fall back to the first non-empty bucket rather than failing outright.
    for (const k of Object.keys(bag)) {
        if (k !== "__typename" && Array.isArray(bag[k]) && bag[k].length) return bag[k];
    }
    return [];
}

// The CMS stores the portal's display text, so an exact match is the norm.
// Compare case- and punctuation-insensitively so a stray capital or hyphen in the
// CMS row doesn't reject an otherwise valid issue type.


function resolveFromVocabulary(value, vocabulary, label) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error(`Missing ${label}`);
    if (!Array.isArray(vocabulary) || vocabulary.length === 0) return raw; // nothing to check against
    const exact = vocabulary.find((v) => v === raw);
    if (exact) return exact;
    const loose = vocabulary.find((v) => normalizeLoose(v) === normalizeLoose(raw));
    if (loose) return loose;
    throw new Error(
        `Unknown ${label} "${raw}" — Flipkart accepts: ${vocabulary.join(" | ")}`
    );
}

// ---------------------------
// 📎 Step 2 — attachment upload
// ---------------------------
// Flipkart validates the uploaded file by its FILENAME EXTENSION, independently
// of the content type it sniffs — see ../common/attachments.js, which owns the
// list and the reasoning, because both flows need the same answer.
const {
    ALLOWED_UPLOAD_EXTENSIONS,
    httpBodySummary,
    isUnattachable,
} = require("../common/attachments.js");

/**
 * POST multipart to /napi/payments-rest/uploadSpfClaimFile → { url: "/attachments/..." }.
 * That `url` becomes the `path` of a createClaimV2 attachment entry.
 *
 * TWO different names are in play and they must not be conflated:
 *   - the multipart FILENAME, which Flipkart extension-checks, so it always
 *     comes from the file on disk (…_shipping_123.png), and
 *   - `displayName`, the label that goes in the createClaimV2 attachments array
 *     ("shipping-label" in the captured payload), which never touches the upload.
 *
 * NOTE: the capture recorded the response but not the multipart body (Chrome's
 * debugger omits binary payloads), so the form field name is not proven. "file"
 * is the overwhelming convention; override with FLIPKART_UPLOAD_FIELD if the
 * server rejects it.
 */
async function uploadSpfClaimFile(ctx, filePath, displayName) {
    if (!filePath || !(await fs.pathExists(filePath))) {
        throw new Error(`uploadSpfClaimFile: file not found: ${filePath}`);
    }
    const field = process.env.FLIPKART_UPLOAD_FIELD || "file";

    // The name Flipkart validates — never displayName, which has no extension.
    const uploadFilename = path.basename(filePath);
    const ext = path.extname(uploadFilename).toLowerCase();

    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
        // Fail here with something an operator can act on, rather than letting
        // Flipkart answer HTTP 500 with a validation blob — or, for a video,
        // HTTP 503 from a gateway that gave up on the body before anything
        // read its name. The callers partition evidence before downloading
        // anything (see ../common/attachments.js), so reaching this with a
        // video means a caller skipped that step.
        throw new Error(
            isUnattachable(uploadFilename)
                ? `Attachment "${uploadFilename}" is a ${ext} file — Flipkart's claim upload takes ` +
                  `${ALLOWED_UPLOAD_EXTENSIONS.join(", ")} only, so a video or document can never be ` +
                  `attached to a claim. Remove it from the row's evidence.`
                : `Attachment "${uploadFilename}" has ${ext ? `an unsupported extension (${ext})` : "no file extension"} — ` +
                  `Flipkart accepts ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}. Check the source URL on the CMS row.`
        );
    }

    // Label for the claim payload; falls back to the filename when unset.
    const name = displayName || uploadFilename;

    const form = new FormData();
    form.append(field, fs.createReadStream(filePath), { filename: uploadFilename });

    const res = await axios.post(UPLOAD_URL, form, {
        headers: {
            ...form.getHeaders(),
            "user-agent": UA,
            Accept: "*/*",
            Referer: `${ORIGIN}/index.html`,
            "FK-CSRF-TOKEN": ctx.csrfToken,
            "X-LOCATION-ID": locationIdOf(ctx),
            ...CLIENT_HINTS,
            cookie: cookieHeader(ctx.jar),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    // Own request, so it does not pass through gqlCall — log it here too.
    if (res.status >= 400) {
        logApiFailure({ platform: "flipkart", step: `Attachment upload (${uploadFilename})`, method: "POST", url: UPLOAD_URL, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) {
        throw authError("Attachment upload", res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        const err = new Error(
            `Attachment upload failed (${uploadFilename}): HTTP ${res.status} ${httpBodySummary(res.data)}`
        );

        err.status = res.status;
        throw err;
    }
    const url = res.data && res.data.url;
    if (!url) {
        throw new Error(
            `Attachment upload returned no url for ${uploadFilename}: ${JSON.stringify(res.data || "").slice(0, 300)}`
        );
    }
    dbg(`  📎 uploaded ${uploadFilename} as "${name}" → ${url.slice(0, 60)}...`);
    return { name, path: url };
}

// ---------------------------
// ✅ Step 3 — create the claim
// ---------------------------
const M_CREATE_CLAIM = `mutation Payments_SPF_WEB_createclaimV2($order_id: String!, $order_item_id: String!, $return_id: String!, $product_type: String, $issue_type: String, $shipment_expectation: String, $description: String, $attachments: [ClaimAttachment], $quantity_affected: Float) {
  createClaimV2(
    order_id: $order_id
    order_item_id: $order_item_id
    return_id: $return_id
    product_type: $product_type
    issue_type: $issue_type
    shipment_expectation: $shipment_expectation
    description: $description
    attachments: $attachments
    quantity_affected: $quantity_affected
  ) {
    claim_id
    incident_id
    state
    __typename
  }
}`;

async function createClaimV2(ctx, variables) {
    // DESABLE_SAVE=true → search + uploads still run, the filing mutation doesn't.
    assertClaimSubmitEnabled("Flipkart", "createClaimV2 mutation");
    const data = await gqlCall(ctx, {
        url: NAPI_GRAPHQL,
        operation: "mutation",
        operationName: "Payments_SPF_WEB_createclaimV2",
        query: M_CREATE_CLAIM,
        variables,
        step: "Create claim",
    });
    // Observed: all three fields come back null even on a successful filing.
    // Treated as "submitted" — the id is read back from the Processing list.
    return (data && data.createClaimV2) || {};
}

// ---------------------------
// 🎫 Step 4 — find the claim: state counts → claims list
// ---------------------------
// The SPF Claims page is tabbed by state, and the list endpoint filters by ONE
// state at a time. The portal therefore asks in two steps, and so do we:
//
//   1. GetSpfClaimCountsOrchestrator(searchText = tracking id)
//        → sellerClaims.stateCounts [{ state, count }]  — which tabs hold it
//   2. GetSpfClaimsOrchestrator(filter { search, searchOption: "tracking_id",
//                                        status: <a state from step 1> })
//        → claims[] { claimId, incidentId, status, approvedAmount, … }
//
// States seen in the capture's unfiltered counts: SELLER_PENDING, PROCESSING,
// APPROVED, AUTO_CLOSE, REJECTED. A claim filed a moment ago counts under
// PROCESSING.
const Q_SPF_CLAIM_COUNTS = `query GetSpfClaimCountsOrchestrator($input: ClaimInput) {
  claim(input: $input) {
    sellerClaims {
      total
      stateCounts {
        state
        count
      }
    }
    autoProcessedClaims {
      source
      count
    }
  }
}`;

const Q_SPF_CLAIMS = `query GetSpfClaimsOrchestrator($input: ClaimInput) {
  claims(input: $input) {
    hasMore
    nextUrl
    claims {
      returnType
      returnId
      claimType
      warehouseCode
      productPrice
      settlementAmount
      totalPrice
      reasonCodeDisplay
      approvedAmount
      claimId
      sku
      productDetails
      productImage
      orderItemId
      incidentId
      status
      orderId
      createdAt
      updatedAt
      trackingId
      quantityApproved
      quantityClaimed
      sellerRequestedQuantity
    }
  }
}`;

// The orchestrator scopes every call by x-seller-id. A session restored from the
// store has no seller id yet; getOrderSearch is the cheapest call that returns
// one, and it caches it on ctx.
async function ensureSellerId(ctx, trackingId) {
    if (ctx.sellerId || !trackingId) return ctx.sellerId || null;
    await getOrderSearch(ctx, trackingId);
    return ctx.sellerId || null;
}

/**
 * Step 1 — how many claims match `searchText`, per state.
 * @returns {Promise<import("./flipkartApiTypes").ClaimStateCounts>}
 */
async function getClaimStateCounts(ctx, searchText) {
    await ensureSellerId(ctx, searchText);

    const data = await gqlCall(ctx, {
        url: ORCH_GRAPHQL,
        operation: "query",
        operationName: "GetSpfClaimCountsOrchestrator",
        query: Q_SPF_CLAIM_COUNTS,
        variables: { input: { searchText: searchText ? String(searchText) : null } },
        step: "SPF claim counts",
    });

    const claim = (data && data.claim) || {};
    const seller = claim.sellerClaims || {};
    const stateCounts = (Array.isArray(seller.stateCounts) ? seller.stateCounts : [])
        .filter((s) => s && s.state)
        .map((s) => ({ state: String(s.state), count: Number(s.count) || 0 }));

    return {
        total: Number(seller.total) || 0,
        stateCounts,
        autoProcessedClaims: Array.isArray(claim.autoProcessedClaims) ? claim.autoProcessedClaims : [],
    };
}

/**
 * Step 2 — one page of the claims list for ONE state.
 * @returns {Promise<{ hasMore: boolean, nextUrl: string|null, claims: import("./flipkartApiTypes").SpfClaim[] }>}
 */
async function getSpfClaims(ctx, { search = null, searchOption = "tracking_id", status, pageSize = 10, startingPage = 1 } = {}) {
    if (!status) throw new Error("getSpfClaims: status is required — the list is filtered by one state at a time");
    await ensureSellerId(ctx, searchOption === "tracking_id" ? search : null);

    const data = await gqlCall(ctx, {
        url: ORCH_GRAPHQL,
        operation: "query",
        operationName: "GetSpfClaimsOrchestrator",
        query: Q_SPF_CLAIMS,
        variables: {
            input: {
                filter: {
                    search: search ? String(search) : null,
                    searchOption: search ? searchOption : null,
                    status,
                },
                pagination: { pageSize, startingPage, sort: null },
            },
        },
        step: `SPF claims lookup (${status})`,
    });

    const list = (data && data.claims) || {};
    return {
        hasMore: Boolean(list.hasMore),
        nextUrl: list.nextUrl || null,
        claims: Array.isArray(list.claims) ? list.claims.filter(Boolean) : [],
    };
}

// Amounts arrive as numbers (622.68) but a string or null must not become NaN in
// the CMS.
function toAmount(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Which of the returned rows is OUR claim.
 *
 * Strict. The filter is server-side, but a row is only accepted when something
 * on it ties it to this parcel: the tracking id itself, or — because older
 * claims come back with trackingId null — the claim id / order item id / return
 * id the caller already knows. Never rows[0]: a wrong ticket number stapled onto
 * a CMS row is worse than none.
 */
function matchesClaim(row, trackingId, { claimId, orderItemId, returnId } = {}) {
    if (!row) return false;
    if (claimId && row.claimId && String(row.claimId) === String(claimId)) return true;
    if (row.trackingId) return String(row.trackingId) === String(trackingId);
    return Boolean(
        (orderItemId && row.orderItemId && String(row.orderItemId) === String(orderItemId)) ||
        (returnId && row.returnId && String(row.returnId) === String(returnId))
    );
}

/** @returns {import("./flipkartApiTypes").FoundClaim} */
function normalizeClaim(row) {
    const status = row.status ? String(row.status).toUpperCase() : null;
    return {
        claimId: row.claimId ? String(row.claimId) : null,
        incidentId: row.incidentId ? String(row.incidentId) : null,
        status,
        approvedAmount: toAmount(row.approvedAmount),
        settlementAmount: toAmount(row.settlementAmount),
        quantityApproved: toAmount(row.quantityApproved),
        orderId: row.orderId || null,
        orderItemId: row.orderItemId || null,
        returnId: row.returnId || null,
        trackingId: row.trackingId || null,
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null,
        raw: row,
    };
}

/**
 * tracking id → the claim Flipkart holds for it, with its state and amounts.
 * Returns null when there is no claim for it on this account.
 *
 * The two-step lookup above: counts name the state tabs, then each named tab is
 * searched. A parcel can carry more than one claim over its life (one rejected,
 * one re-filed) — `hint.claimId` picks a known one, otherwise the newest wins.
 *
 * @param {object} ctx
 * @param {string} trackingId
 * @param {{ claimId?: string|null, orderItemId?: string|null, returnId?: string|null }} [hint]
 * @returns {Promise<import("./flipkartApiTypes").FoundClaim|null>}
 */
async function findClaim(ctx, trackingId, hint = {}) {
    if (!trackingId) throw new Error("findClaim: trackingId is required");

    const counts = await getClaimStateCounts(ctx, trackingId);
    const states = counts.stateCounts.filter((s) => s.count > 0).map((s) => s.state);
    if (states.length === 0) return null;

    const matches = [];
    for (const status of states) {
        const { claims } = await getSpfClaims(ctx, { search: trackingId, searchOption: "tracking_id", status });
        for (const row of claims) {
            if (matchesClaim(row, trackingId, hint)) matches.push(normalizeClaim(row));
        }
        const known = hint.claimId && matches.find((m) => m.claimId === String(hint.claimId));
        if (known) return known;
    }

    if (matches.length === 0) {
        dbg(`  counts named ${states.join(", ")} for ${trackingId} but no row matched`);
        return null;
    }

    // "2026-09-15 10:56:26.0" sorts correctly as text, and is not reliably
    // parseable as a Date.
    matches.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return matches[0];
}

/**
 * Mirrors the UI: open SPF Claims, select the Processing tab, search by
 * tracking id, read the Claim ID off the single matching row.
 *
 * Kept for callers that already know the state. `findClaim` asks the counts
 * first and so does not need to.
 */
async function getClaimIdFromProcessing(ctx, trackingId, { status = "PROCESSING" } = {}) {
    const { claims } = await getSpfClaims(ctx, { search: trackingId, searchOption: "tracking_id", status });
    if (claims.length === 0) return null;

    const hit = claims.find((r) => r && r.trackingId && String(r.trackingId) === String(trackingId));
    if (!hit) {
        dbg(`  no row for ${trackingId} in ${claims.length} returned claim(s)`);
        return null;
    }
    return hit.claimId || null;
}

// ---------------------------
// 🌐 Global AWB search — does this return belong to this account?
// ---------------------------
// The Returns page's search box. The session is the account, so a return that
// comes back here is on this login and one that does not is not.
//
// The capture's full query asks for ~80 fields; only the ones below are read.
// Asking for fewer is always valid GraphQL, and every field here is in the
// captured query.
const Q_SEARCH_RETURN_ITEM = `query returns_searchReturnItem($searchValue: String, $searchBy: String) {
  data: returns_searchReturnItem(searchBy: $searchBy, searchValue: $searchValue) {
    timeStamp
    response {
      tracking_id {
        trackingId
        __typename
      }
      order_id {
        orderId
        orderItemIds
        __typename
      }
      product {
        order_item_id
        title
        sku
        quantity
        selling_price
        __typename
      }
      return_type {
        returnType
        returnId
        __typename
      }
      completed_date
      return_status {
        status
        shipmentStatus
        __typename
      }
      data {
        tracking_id
        return_id
        return_type
        status
        shipment_status
        location_id
        return_status_text
        __typename
      }
      __typename
    }
    __typename
  }
}`;

/**
 * Global AWB search. `searchBy` is "tracking_id" (the CMS AWB) or
 * "order_item_id", the two the portal uses.
 *
 * Returns { found, returns[] }, `returns` holding only rows that really are for
 * `searchValue`. What Flipkart answers for an unknown AWB is not in the capture:
 * an empty or null `response` is read as not found, and so is a GraphQL error
 * that says so — anything else is thrown, because "could not ask" is not "not on
 * this account".
 *
 * @returns {Promise<{ found: boolean, returns: import("./flipkartApiTypes").AccountReturn[] }>}
 */
async function searchReturnItem(ctx, searchValue, { searchBy = "tracking_id" } = {}) {
    if (!searchValue) throw new Error("searchReturnItem: searchValue is required");

    let data;
    try {
        data = await gqlCall(ctx, {
            url: NAPI_GRAPHQL,
            operation: "query",
            operationName: "returns_searchReturnItem",
            query: Q_SEARCH_RETURN_ITEM,
            variables: { searchBy, searchValue: String(searchValue) },
            step: "Global AWB search",
        });
    } catch (err) {
        if (err && err.code === "FLIPKART_API_ERROR" && /not\s*found|no\s*(data|record|result|return)/i.test(err.message)) {
            return { found: false, returns: [] };
        }
        throw err;
    }

    const rows = (data && data.data && Array.isArray(data.data.response) ? data.data.response : []).filter(Boolean);
    const wanted = String(searchValue);

    const returns = rows
        .map((row) => {
            const orderIds = row.order_id || {};
            const returnType = row.return_type || {};
            const status = row.return_status || {};
            const inner = row.data || {};
            return {
                trackingId: (row.tracking_id && row.tracking_id.trackingId) || inner.tracking_id || null,
                orderId: orderIds.orderId || null,
                orderItemIds: Array.isArray(orderIds.orderItemIds) ? orderIds.orderItemIds.map(String) : [],
                returnId: returnType.returnId || inner.return_id || null,
                returnType: returnType.returnType || inner.return_type || null,
                status: status.status || inner.status || null,
                shipmentStatus: status.shipmentStatus || inner.shipment_status || null,
                statusText: inner.return_status_text || null,
                completedDate: row.completed_date || null,
                products: Array.isArray(row.product) ? row.product.filter(Boolean) : [],
            };
        })
        .filter((r) =>
            searchBy === "tracking_id"
                ? String(r.trackingId) === wanted
                : searchBy === "order_item_id"
                    ? r.orderItemIds.includes(wanted)
                    : true
        );

    return { found: returns.length > 0, returns };
}

// ---------------------------
// 🗂️ Claim status → CMS status
// ---------------------------
// The Selenium runner reads which TILE a claim sits on (Processing / Approved /
// Not Approved) and reports "Success" / "Approved" / "Rejected" accordingly.
// The API exposes the same fact as a string, in two places:
//   getOrderSearch → return_item_list[].claim_details.claim_status  ("OPEN")
//   GetSpfClaimsOrchestrator → claims[].status                      (the tab)
//
// VERIFIED values: claim_status "OPEN"; tab states PROCESSING, SELLER_PENDING,
// APPROVED, REJECTED and AUTO_CLOSE. AUTO_CLOSE is deliberately NOT mapped: the
// capture shows the tab exists, not whether a claim closed that way was paid, so
// it reports the in-progress default rather than a verdict nobody verified.
const CLAIM_STATUS_TO_CMS = {
    OPEN: "Success",
    PROCESSING: "Success",
    SELLER_PENDING: "Success",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    // older spellings, kept so a historic value still reads correctly
    CLAIM_APPROVED: "Approved",
    NOT_APPROVED: "Rejected",
    CLAIM_REJECTED: "Rejected",
};

function claimStatusToCmsStatus(claimStatus) {
    const key = String(claimStatus || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    return CLAIM_STATUS_TO_CMS[key] || "Success";
}

/**
 * The amount Flipkart approved, only when the claim IS approved. Every other
 * state carries approvedAmount 0, which is not a payout.
 * @param {{ status?: string|null, approvedAmount?: number|null }|null} claim
 * @returns {number|null}
 */
function approvedAmountOf(claim) {
    if (!claim || String(claim.status || "").toUpperCase() !== "APPROVED") return null;
    return toAmount(claim.approvedAmount);
}

// Flipkart's 14-day SPF window is reported through claim_eligible=false plus a
// reason string. What an operator reads is the code; the TAG lives on as
// `err.code`, which is what the flows match on to decide whether a row should
// stop retrying, and Flipkart's own sentence rides along as `detail`.
function ineligibilityError(item) {
    const reason = String((item && item.claim_eligible_reason) || "").trim();
    if (/\b(\d+\s*days?|window|expired|passed)\b/i.test(reason)) {
        return flipkartWindowExpired(reason);
    }
    return new Error(
        `NOT_CLAIM_ELIGIBLE: Flipkart will not accept a claim for this return` +
        (reason ? ` — ${reason}` : ``) +
        ` (status=${item.status}, shipment_status=${item.shipment_status})`
    );
}

// Flipkart claim state → CMS status.
//
// `claimStatusToCmsStatus` above answers a different question — it reports a
// SCRIPT outcome ("Success"/"Approved"/"Rejected") for a claim just filed. This
// is the CMS claim status, which has more states and is what a status read
// writes. Kept here so the server's sync and the desktop's Refill Data read one
// table rather than two that can disagree.
//
// AUTO_CLOSE is deliberately absent: the tab exists, but whether a claim closed
// that way was paid is not established, and anything unlisted maps to null and
// leaves the CMS status untouched.
const FLIPKART_TO_CMS_STATUS = {
    OPEN: "In Review",
    PROCESSING: "In Review",
    IN_REVIEW: "In Review",
    // Flipkart is blocked on US — someone has to act, so it must not hide
    // inside "In Review".
    SELLER_PENDING: "Awaiting Seller Response",
    APPROVED: "Approved",
    CLAIM_APPROVED: "Approved",
    REJECTED: "Rejected",
    NOT_APPROVED: "Rejected",
    CLAIM_REJECTED: "Rejected",
};

function mapFlipkartStatus(flipkartStatus) {
    if (!flipkartStatus) return null;

    const key = String(flipkartStatus).trim().toUpperCase().replace(/[\s-]+/g, "_");

    return FLIPKART_TO_CMS_STATUS[key] || null;
}

module.exports = {
    FLIPKART_TO_CMS_STATUS, mapFlipkartStatus,
    loginFlipkartApi,
    claimStatusToCmsStatus,
    ineligibilityError,
    getOrderSearch,
    getProductTypes,
    getIssueTypes,
    resolveFromVocabulary,
    uploadSpfClaimFile,
    createClaimV2,
    getClaimIdFromProcessing,
    getClaimStateCounts,
    getSpfClaims,
    findClaim,
    searchReturnItem,
    approvedAmountOf,
    // exported for tests / reuse
    matchesClaim,
    cookieHeader,
    discoverCsrfToken,
    ORIGIN,
};
