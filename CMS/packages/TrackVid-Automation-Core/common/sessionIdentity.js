// -----------------------------------------------------------------------------
// "Who am I?" — asking a marketplace whether a stored session is still signed in
// -----------------------------------------------------------------------------
// Every portal has one endpoint whose entire job is to answer that: the account
// behind the session. They are the cheapest and least ambiguous question this
// system can ask, and they are what the Sessions screen's "Check now" runs.
//
// WHY THESE AND NOT THE WORKING ENDPOINTS. The probes in each platform's
// sessionStore ask a BUSINESS question — list product types, search returns —
// and a business endpoint can fail for business reasons. It answers empty
// because the seller has no returns this week, or it needs a token the probe
// did not send, and either reads as "signed out". That has cost real time:
// Flipkart's probe was refused 403 EBADCSRFTOKEN for a missing header and the
// app reported a perfectly good session as dead, over and over.
//
// An identity endpoint has no such failure mode. It either names the seller or
// it does not.
//
// ─── THE THREE ANSWERS, AND WHY NULL IS NOT FALSE ────────────────────────────
//
//   true   the portal named the account — this session works
//   false  the portal says nobody is signed in — re-capture is needed
//   null   we cannot tell: no check for this platform, the record is missing
//          something the request needs, the network failed, or the portal
//          answered 5xx
//
// NULL MUST NEVER BE READ AS FALSE. A wrong `false` marks a working session as
// dead and sends an operator to re-capture something that was fine — and, where
// this gates a capture, refuses a good sign-in outright. Both have happened.
// So anything short of a clear answer is `null`, and a caller that cannot use
// `null` is a caller that should not be asking.
//
// ─── THE CAPTURED CONTRACT ───────────────────────────────────────────────────
// Every entry below was captured from a signed-in browser on 2026-09-19 and is
// quoted in its `response` comment. Values are never reproduced — only shapes
// and field names — because a captured request carries a live session.
// -----------------------------------------------------------------------------

const { platformKey } = require("./platforms.js");

const TIMEOUT_MS = Number(process.env.SESSION_IDENTITY_TIMEOUT_MS || 20000);

const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const SEC_CH_UA = '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"';

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * The jar as a Cookie header, whichever shape it is stored in.
 *
 * AJIO keeps an array of whole cookies (its ingest rehydrates them through
 * CDP); everything else keeps a `{ name: value }` map. `cookieHeader` in
 * sessionHelpers handles only the map — on an array it would produce
 * "0=[object Object]".
 */
/**
 * Would a browser send this cookie to `host`? RFC 6265 domain-match: a cookie
 * set for ".ajio.com" goes to seller.ajio.com; one for sellers.relianceretail.com
 * does not. A cookie with no domain (a name→value jar) is always sent.
 */
function domainMatches(cookie, host) {
    const domain = text(cookie && cookie.domain).toLowerCase();

    if (!domain || !host) return true;

    const bare = domain.replace(/^\./, "");

    return host === bare || host.endsWith(`.${bare}`);
}

/**
 * The Cookie header for a request.
 *
 * @param {object|Array} jar
 * @param {string} [forUrl] when given, only the cookies a browser would send to
 *        that URL's host. Without it, every cookie — the behaviour every check
 *        had before this parameter.
 *
 * WHY AJIO PASSES IT. AJIO's jar is the browser's WHOLE cookie store (CDP
 * getAllCookies). An account whose sign-in passes through Reliance Seller
 * Central carries that site's cookies too — including a second `bff_session`
 * for sellers.relianceretail.com. Sent together, the portal can read the wrong
 * one and answer "not authenticated" for a session that works in the browser.
 */
function cookies(jar, forUrl) {
    if (!jar) return "";

    if (Array.isArray(jar)) {
        let host = "";

        try {
            host = forUrl ? new URL(forUrl).hostname.toLowerCase() : "";
        } catch (_) {
            host = "";
        }

        return jar
            .filter((cookie) => cookie && cookie.name && domainMatches(cookie, host))
            .map((cookie) => `${cookie.name}=${cookie.value ?? ""}`)
            .join("; ");
    }

    return Object.entries(jar)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

/** One cookie's value out of either jar shape. */
function cookieValue(jar, name) {
    if (!jar) return "";

    if (Array.isArray(jar)) {
        const hit = jar.find((cookie) => cookie && cookie.name === name);

        return hit ? text(hit.value) : "";
    }

    return text(jar[name]);
}

const browserHeaders = (referer) => ({
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "user-agent": UA,
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    ...(referer ? { Referer: referer } : {}),
});

/**
 * Per platform: how to ask, and how to read the answer.
 *
 * `request(record)` returns an axios config, or null when the record does not
 * carry what the request needs — which is a `null` verdict, never a `false`.
 * `read(status, body)` returns `{ ok, who }`; `ok` may itself be null.
 */
const IDENTITY_CHECKS = {
    /**
     * AJIO — GET /malekith/auth/me
     *
     * THE ONE THAT CHANGES SOMETHING. AJIO has never been probeable from a
     * stored record: its business calls go through a logged-in page because
     * Akamai wants the browser's own TLS fingerprint, so `probePlatformSession`
     * answers null for it and the Sessions screen could only ever show an
     * expiry date. This endpoint answers from cookies alone.
     *
     * response: { "authenticated": true,
     *             "data": { "username": …, "email": …, "roles": [ … ] } }
     *
     * `If-None-Match` is deliberately NOT sent: the browser's capture carries
     * one and a 304 would arrive with no body to read.
     */
    ajio: {
        request: (record) => ({
            method: "get",
            url: "https://seller.ajio.com/malekith/auth/me",
            headers: {
                ...browserHeaders("https://seller.ajio.com/vmsui/"),
                cookie: cookies(record.jar, "https://seller.ajio.com/malekith/auth/me"),
            },
        }),
        read: (status, body) => {
            if (status !== 200 || !body || typeof body !== "object") return { ok: null };
            // The field is explicit, so there is no inference to make.
            if (body.authenticated !== true) return { ok: false };

            return { ok: true, who: text(body.data && body.data.username) };
        },
    },

    /**
     * Meesho — POST /api/container/supplier/api/2.0/supplier/config
     *
     * response: a large configuration object keyed by feature. There is no
     * identity in it, so the verdict is that it ANSWERED AT ALL: signed out,
     * this endpoint is 401/463 rather than a config blob.
     *
     * `client-package-version` is per SPA area again — 1.0.39 for the container
     * app, where the support APIs send 1.2.4 and fulfillment 1.0.4.
     */
    meesho: {
        request: (record) => {
            const identifier = text(record.supplierIdentifier);
            const supplierId = Number(record.supplierId);

            // Both are on every stored Meesho record; without them this request
            // cannot be addressed, and guessing would be worse than not asking.
            if (!identifier || !supplierId) return null;

            const browserId = cookieValue(record.jar, "browser_id");

            return {
                method: "post",
                url: "https://supplier.meesho.com/api/container/supplier/api/2.0/supplier/config",
                data: { supplierId },
                headers: {
                    ...browserHeaders(
                        `https://supplier.meesho.com/panel/v3/new/growth/${identifier}/home`
                    ),
                    "content-type": "application/json;charset=UTF-8",
                    origin: "https://supplier.meesho.com",
                    "client-type": "d-web",
                    "client-package-version":
                        process.env.MEESHO_CONTAINER_CLIENT_VERSION || "1.0.39",
                    identifier,
                    "supplier-id": String(supplierId),
                    // Forwarded from the session, never invented — see
                    // platforms/meesho/common/browserId.js for what that cost.
                    ...(browserId
                        ? { "browser-id": (() => {
                              try {
                                  return decodeURIComponent(browserId);
                              } catch {
                                  return browserId;
                              }
                          })() }
                        : {}),
                    cookie: cookies(record.jar),
                },
            };
        },
        read: (status, body) => {
            if (status === 401 || status === 403 || status === 463) return { ok: false };
            if (status !== 200) return { ok: null };
            // An object with keys is the config. An empty body, or a string
            // (a login page), is not.
            if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
                return { ok: null };
            }

            return { ok: true };
        },
    },

    /**
     * Snapdeal — GET /manageprofile/profile
     *
     * response: { "companyName": …, "primaryEmail": …, "active": true, … }
     *
     * Cookies alone; nothing else is stored for Snapdeal and nothing else is
     * needed.
     */
    snapdeal: {
        request: (record) => ({
            method: "get",
            url: "https://seller.snapdeal.com/manageprofile/profile",
            headers: {
                ...browserHeaders("https://seller.snapdeal.com/"),
                "x-requested-with": "XMLHttpRequest",
                cookie: cookies(record.jar),
            },
        }),
        read: (status, body) => {
            if (status === 401 || status === 403) return { ok: false };
            if (status !== 200) return { ok: null };
            // Signed out, Snapdeal answers the login PAGE with a 200. A string
            // body is therefore the refusal, not an error.
            if (typeof body === "string") return { ok: false };
            if (!body || typeof body !== "object") return { ok: null };

            const who = text(body.primaryEmail) || text(body.companyName);

            return who ? { ok: true, who } : { ok: false };
        },
    },

    /**
     * Nykaa — GET /portal/api/me?portalId=…
     *
     * response: { "displayName": …, "emailId": …, "id": …, "email": [ … ] }
     *
     * Zoho Desk behind the portal, so the id is part of the address and a
     * record without one cannot be asked.
     */
    nykaa: {
        request: (record) => {
            const portalId = text(record.portalId);

            if (!portalId) return null;

            return {
                method: "get",
                url: `https://dispute.nykaa.com/portal/api/me?portalId=${encodeURIComponent(portalId)}`,
                headers: {
                    ...browserHeaders("https://dispute.nykaa.com/portal/en/home"),
                    "x-requested-with": "XMLHttpRequest",
                    cookie: cookies(record.jar),
                },
            };
        },
        read: (status, body) => {
            if (status === 401 || status === 403) return { ok: false };
            if (status !== 200) return { ok: null };
            if (!body || typeof body !== "object") return { ok: null };

            const who = text(body.emailId) || text(body.displayName);

            return who ? { ok: true, who } : { ok: false };
        },
    },

    /**
     * Flipkart — GET /napi/manageProfile/getSellerAccountDetails?sellerId=…
     *
     * response: { "data": [ { "profileInfo": { "sellerId": …, "emailId": …,
     *             "businessName": … }, … } ] }
     *
     * Needs the CSRF token as well as the cookies: Flipkart double-submits it
     * and answers 403 EBADCSRFTOKEN when the header is missing — which is a
     * statement about the REQUEST, not the session, so a record without a token
     * is `null` here rather than a session declared dead.
     *
     * The seller id falls back to the `sellerId` cookie, which the jar carries
     * even when the stored record does not.
     */
    flipkart: {
        request: (record) => {
            const csrfToken = text(record.csrfToken);
            const sellerId = text(record.sellerId) || cookieValue(record.jar, "sellerId");

            if (!csrfToken || !sellerId) return null;

            return {
                method: "get",
                url: `https://seller.flipkart.com/napi/manageProfile/getSellerAccountDetails?sellerId=${encodeURIComponent(sellerId)}`,
                headers: {
                    ...browserHeaders("https://seller.flipkart.com/index.html"),
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "x-requested-with": "XMLHttpRequest",
                    "fk-csrf-token": csrfToken,
                    cookie: cookies(record.jar),
                },
            };
        },
        read: (status, body) => {
            // A CSRF refusal is about the request we sent. Saying "dead" here is
            // exactly the bug that made every Flipkart capture fail.
            const code = text(body && body.error && body.error.code);

            if (status === 403 && /csrf/i.test(code)) return { ok: null };
            if (status === 401 || status === 403) return { ok: false };
            if (status !== 200) return { ok: null };

            const profile =
                body && Array.isArray(body.data) && body.data[0] && body.data[0].profileInfo;

            if (!profile) return { ok: false };

            return { ok: true, who: text(profile.emailId) || text(profile.sellerId) };
        },
    },

    /**
     * Myntra — GET /api/boot/partners
     *
     * response (signed in): { "partnerId": …, "sellerId": …,
     *                         "sellerType": [ … ], … }
     * response (signed out): the SAME endpoint, HTTP 200, with neither.
     *
     * NOT the `/vms/v3/partner?ids=…` endpoint, which is the one captured by
     * hand. That one is addressed by a numeric partner id — 23026 in the
     * capture — and no stored session carries it: the `erp.at` token decodes to
     * a storeId (2297), which is a different number. It could only be used by
     * first discovering the id, and the call that discovers it is this one.
     *
     * So this is strictly better: one request, no id, and it answers with the
     * partner id the other endpoint would have needed. Myntra's own probe has
     * been using it in production all along; what is new is that its verdict
     * now reaches the Sessions screen.
     *
     * READ THE BODY, NOT THE STATUS. Myntra answers 200 to anyone. Signed out,
     * it returns the anonymous boot payload — which is why "HTTP 200" alone has
     * never been evidence of anything here.
     */
    myntra: {
        request: (record) => ({
            method: "get",
            url: "https://partnersapi.myntrainfo.com/api/boot/partners",
            headers: {
                ...browserHeaders("https://partners.myntrainfo.com/"),
                accept: "*/*",
                origin: "https://partners.myntrainfo.com",
                "sec-fetch-site": "same-site",
                "x-myntra-app-name": "partners",
                "x-myntra-knuth": "yes",
                "x-requested-with": "XMLHttpRequest",
                cookie: cookies(record.jar),
            },
        }),
        /**
         * WHO IT NAMES, not what kind of partner it is.
         *
         * This asked for a partner id AND a non-empty `sellerType`, on the
         * reasoning that an id alone could be the anonymous payload wearing
         * part of a costume. The recorded traffic says otherwise, and the
         * account it cost is worth writing down:
         *
         *   partnerType "VENDOR"      partnerCode "DYVY"
         *   partnerId   "14880"       sellerId    0
         *   sellerType  []            user.loginId "listing@…"
         *   hasAccess   true          user.status  ACTIVE
         *
         * That is a signed-in session. `sellerType` is the SELLER
         * classification — PPMP, FBM, SJIT — and a VENDOR does not have one, so
         * the rule refused every vendor account on the platform. One seller
         * portal, two kinds of partner, and only one of them could ever be
         * captured: the operator watched the browser reach a named dashboard,
         * and the app reported that Myntra answers as if nobody is signed in.
         *
         * So the question is the one this file exists to ask — does the
         * marketplace NAME somebody? A logged-in boot payload carries the user
         * it belongs to; the anonymous one has no user to carry. The partner id
         * stays as corroboration, and `sellerType` goes back to being what it
         * is: a detail about sellers, true of no vendor.
         */
        read: (status, body) => {
            if (status === 401 || status === 403) return { ok: false };
            if (status !== 200) return { ok: null };
            if (!body || typeof body !== "object") return { ok: null };

            // Coerced, because the payload is not consistent about it: the
            // recorded vendor carries `partnerId: "14880"` as a string and
            // `sellerId: 14880` as a number, on two calls seconds apart.
            const id = (value) =>
                typeof value === "number" ? String(value) : text(value);

            const user = body.user && typeof body.user === "object" ? body.user : {};
            const named = text(user.loginId) || text(user.uidx) || text(user.email);
            // `sellerId: 0` is Myntra's "not a seller", not an id — a vendor
            // account carries it alongside a real partnerId.
            const partner =
                id(body.partnerId) ||
                id(body.partnerCode) ||
                (body.sellerId ? id(body.sellerId) : "");

            if (!named || !partner) return { ok: false };

            return { ok: true, who: named };
        },
    },

    /**
     * Delhivery — GET /p/api/account/profile
     *
     * response: { "email": …, "first_name": …, "ucp_roles": [ … ] }
     *
     * Jarless: the session IS the bearer token, so there is nothing to send but
     * the header.
     */
    delhivery: {
        request: (record) => {
            const token = text(record.accessToken);

            if (!token) return null;

            return {
                method: "get",
                url: "https://ucp-app-auth.delhivery.com/p/api/account/profile",
                headers: {
                    accept: "application/json, text/plain, */*",
                    "accept-language": "en",
                    "user-agent": UA,
                    origin: "https://one.delhivery.com",
                    Referer: "https://one.delhivery.com/",
                    authorization: `${text(record.tokenType) || "Bearer"} ${token}`,
                },
            };
        },
        read: (status, body) => {
            if (status === 401 || status === 403) return { ok: false };
            if (status !== 200) return { ok: null };
            if (!body || typeof body !== "object") return { ok: null };

            const who = text(body.email);

            return who ? { ok: true, who } : { ok: false };
        },
    },
};

/*
 * DELIBERATELY ABSENT:
 *
 *   xbees     signs in with one API call and no browser, so checking it is
 *             wasted work — see RENEW_ON_CHECK below.
 *   tatacliq  its session can only be judged inside a live page: Cloudflare
 *             wants a real browser, and the slave pick is server-side state.
 *
 * Absent means `null`, which means "ask the old probe instead". Neither is made
 * worse by this file existing.
 */

/**
 * Platforms where SIGNING IN AGAIN is the check.
 *
 * Xbees has no cookie jar and no browser step: its session is a bearer token
 * obtained by posting credentials to one endpoint. For a platform like that,
 * asking "is this token still good?" and then signing in when the answer is no
 * is two calls to learn what one call would have settled — and the one call
 * leaves a FRESH token behind either way, where the probe leaves an old one
 * that is a little closer to expiry.
 *
 * So the caller renews instead, and the verdict is whether the login worked.
 *
 * Deliberately NOT Delhivery, which is the same shape. Delhivery has a captured
 * identity endpoint, and its sign-in is the one an operator may have to watch —
 * a check that quietly triggers logins is a check nobody can run casually.
 *
 * This is a DECLARATION, not an implementation: the consumers own sign-in, and
 * this package must not start driving one from a health check.
 */
const RENEW_ON_CHECK = ["xbees"];

/** Is signing in again the right way to check this platform? */
const renewsOnCheck = (platform) => RENEW_ON_CHECK.includes(platformKey(platform));

/** Platforms this module can ask, lowercase. */
const IDENTITY_PLATFORMS = Object.keys(IDENTITY_CHECKS);

const checkFor = (platform) => IDENTITY_CHECKS[platformKey(platform)] || null;

/** Is there an identity endpoint for this platform? */
const hasIdentityCheck = (platform) => checkFor(platform) !== null;

/**
 * Ask the marketplace who this session belongs to.
 *
 * @param {string} platform
 * @param {object} record  the stored session — `{ jar, ...extras }`
 * @param {{ logger?: object }} [options]
 * @returns {Promise<{ok: true|false|null, who: string|null, detail: string, status: number|null}>}
 */
async function checkSessionIdentity(platform, record, { logger } = {}) {
    const key = platformKey(platform);
    const check = checkFor(key);
    const answer = (ok, detail, extra = {}) => ({ ok, who: null, status: null, detail, ...extra });

    if (!check) return answer(null, `no identity endpoint for ${key}`);
    if (!record) return answer(null, "no stored session");

    let config;

    try {
        config = check.request(record);
    } catch (err) {
        return answer(null, `could not build the request (${err.message})`);
    }

    if (!config) {
        // The record is missing something the request is addressed by. Not a
        // verdict on the session — a statement about what we hold.
        return answer(null, "the stored session does not carry what this check needs");
    }

    const axios = require("axios");
    let res;

    try {
        res = await axios({
            ...config,
            timeout: TIMEOUT_MS,
            maxRedirects: 0,
            validateStatus: () => true,
        });
    } catch (err) {
        // Offline, DNS, a timeout. Says nothing about the session.
        return answer(null, `the check could not run (${err.message})`);
    }

    // A redirect to a login page is the clearest refusal a portal gives.
    if (res.status >= 300 && res.status < 400) {
        const location = text(res.headers && res.headers.location);

        if (/login|signin|auth/i.test(location)) {
            return answer(false, `redirected to ${location}`, { status: res.status });
        }

        return answer(null, `redirected to ${location || "somewhere else"}`, { status: res.status });
    }

    if (res.status >= 500) {
        // The portal is having a bad day. Not evidence about the session.
        return answer(null, `the portal answered HTTP ${res.status}`, { status: res.status });
    }

    let verdict;

    try {
        verdict = check.read(res.status, res.data) || { ok: null };
    } catch (err) {
        return answer(null, `could not read the answer (${err.message})`, { status: res.status });
    }

    const who = text(verdict.who) || null;
    const detail =
        verdict.ok === true
            ? `signed in${who ? ` as ${who}` : ""}`
            : verdict.ok === false
                ? `HTTP ${res.status} — the portal does not recognise this session`
                : `HTTP ${res.status} — no clear answer`;

    if (verdict.ok === false) {
        logger?.warn?.(`[identity] ${key}: ${detail}`);
    }

    return { ok: verdict.ok ?? null, who, status: res.status, detail };
}

module.exports = {
    IDENTITY_CHECKS,
    IDENTITY_PLATFORMS,
    RENEW_ON_CHECK,
    renewsOnCheck,
    hasIdentityCheck,
    checkSessionIdentity,
};
