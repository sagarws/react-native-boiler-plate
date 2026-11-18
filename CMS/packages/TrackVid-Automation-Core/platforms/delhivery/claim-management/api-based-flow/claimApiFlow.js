/**
 * Delhivery One — direct-API claim flow.
 *
 * Replaces the Selenium UI navigation (dashboard → Support → Raise a ticket
 * → drawer → issue/subcategory/claim-type → AWB → upload → submit) with the
 * same JSON APIs the portal itself calls.
 *
 * Auth is HYBRID: Selenium bootstraps the Keycloak OAuth2 flow (email → SSO
 * password → authorization_code → token exchange), then axios handles all
 * downstream calls with an `Authorization: Bearer <access_token>` header.
 * Access tokens expire in 10 minutes; the sessionStore holds the refresh_token
 * (24h) and mints a fresh access_token before each batch or on 401.
 *
 * Endpoints:
 *
 *   POST {AUTH_HOST}/facelessvoid/realms/{realm}/protocol/openid-connect/token
 *   GET  {APP_AUTH_HOST}/p/api/account/profile             (session probe)
 *   GET  {APP_AUTH_HOST}/p/tenants?email=<email>           (realm discovery)
 *   POST {GATEWAY_HOST}/web/api/forward_orders/hq_es_shipments_search/list (AWB search)
 *   POST {GATEWAY_HOST}/web/api/forward_orders/global_search   (AWB search, fallback)
 *   POST {GATEWAY_HOST}/web/api/claims/upload/presigned-urls   (S3 presigned URLs)
 *   POST https://s3.ap-south-1.amazonaws.com/claims-prod-upload-mum/  (multipart to S3)
 *   POST {GATEWAY_HOST}/web/api/support/create_ticket          (the claim submit)
 *   POST {GATEWAY_HOST}/web/api/claims/lost_damage/list         (status readback)
 *
 * TWO OF THESE WERE ONCE GUESSES, AND BOTH WERE WRONG. The original capture
 * stripped POST bodies, so the AWB search and the claim submit were assembled
 * from what the Selenium drawer collects. The search asked `forward_orders`
 * for a REVERSE leg and was answered 400 INVALID_OR_MISSING_PARAMS — "Could
 * not load your dashboard. Please refresh the page." — on every claim; the
 * submit sent flat JSON where the portal sends multipart, and would have
 * failed the moment a search got past. Both were corrected on 2026-09-20
 * against live captures (AWB 29123116000212 → ticket J1789925203929469). See
 * `searchShipments` and `createTicket` for the shapes and what is still
 * unverified.
 *
 * ONE ACCOUNT IS SEVERAL CLIENTS. A seller's shipments are split across HQ
 * clients — EXPRESS and SURFACE on this account — and every call is scoped to
 * one by `x-hq-client-id`. A shipment on the other client comes back as an
 * EMPTY search, not an error, so the AWB lookup sweeps the token's allowed
 * clients rather than trusting the one the session happened to resolve.
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { randomUUID } = require("node:crypto");
// Shared >= 400 response logging (src/helper/apiResponseLogger.js) — same line shape
// on every claim platform, so one grep finds a failed call anywhere.
const { logApiFailure } = require("../../../../common/apiResponseLogger");
const FormData = require("form-data");
// Required lazily, not at module scope. Trackvid-CMS has no puppeteer: it
// captures its own session in an Electron BrowserWindow and hands the jar in,
// so it must be able to import this flow without the browser installed.
// See CLAUDE.md — "Never assume a consumer has your dependency".

const {
    getUsableSession,
    saveSession,
    saveHqClientId,
    clearSession,
    refreshAccessToken,
    GATEWAY_HOST,
    APP_AUTH_HOST,
    TOKEN_URL,
    PROBE_URL,
} = require("../../common/sessionStore");
const { allowedHqClients, decodeJwtPayload, resolveHqClientId } = require("../../common/hqClient");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");
const { loadPuppeteer, resolveExecutablePath } = require("../../../../common/browserRuntime.js");
const { isHeadless } = require("../../../../common/headless.js");
const {
    INVALID_CREDENTIAL_TEXT,
    INVALID_CREDENTIAL_SELECTOR,
} = require("../../common/loginErrors");

const REQ_TIMEOUT_MS = Number(process.env.DELHIVERY_API_TIMEOUT_MS || 60000);
const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const dbg = (...a) => {
    if (process.env.DELHIVERY_API_DEBUG === "true") console.log("[delhivery-api]", ...a);
};

// Delhivery gates most API calls behind an OAuth code + PKCE flow. Node cannot
// mint that authorization_code by itself (the code lives inside a Keycloak
// redirect that only a real browser completes), so login uses Puppeteer for
// the first login of a credential. Every subsequent run reuses the cached
// refresh_token via sessionStore.refreshAccessToken.
//
// The Puppeteer script visits https://one.delhivery.com/, submits email +
// password, waits for the redirect to land on one.delhivery.com/v2/dashboard,
// then reads the token bundle directly from the tab's localStorage / cookies.
// Keycloak stores `kc-callback-*` state cookies but the final tokens live in
// the app's own storage — the exact key varies by frontend build, so we probe
// several common shapes.

// Delhivery's login form renders a rejected password as an inline banner and
// never calls the token endpoint, so without this watcher a wrong password is
// indistinguishable from a hung login: we would sit on the 60s LOGIN_TIMEOUT
// and report a transient failure, leaving the dead credential marked verified.
// The banner's shape is described in ../loginErrors.js.
// Resolves to a never-settling promise on anything OTHER than a seen banner
// (timeout, navigation away, browser closed) so it can sit in a Promise.race
// without ever being the one that decides the outcome.
function watchForInvalidCredentialBanner(page, timeoutMs) {
    return page
        .waitForFunction(
            (src, sel) => {
                const re = new RegExp(src, "i");
                const banner = Array.from(document.querySelectorAll(sel))
                    .find((el) => re.test(el.textContent || ""));
                if (banner) return true;

                // Fallback for a markup change that drops the class.
                return re.test(document.body?.innerText || "");
            },
            { polling: 500, timeout: timeoutMs },
            INVALID_CREDENTIAL_TEXT.source,
            INVALID_CREDENTIAL_SELECTOR,
        )
        .then(() => {
            const err = new Error("INVALID_CREDENTIALS: Wrong credential");
            err.code = "INVALID_CREDENTIALS";
            throw err;
        })
        .catch((err) => {
            if (err?.code === "INVALID_CREDENTIALS") throw err;

            // Timed out / context destroyed — let the other racers decide.
            return new Promise(() => { });
        });
}

// Give a session ctx its x-hq-client-id, persisting anything newly learned.
// Best-effort throughout: a resolver or Mongo failure must not turn a working
// session into a login failure — the claims call will surface the 403 itself,
// with Delhivery's own wording, if the id really is wrong.
async function attachHqClient(ctx, cacheKey, email, { persist = true } = {}) {
    const before = ctx.hqClientId || null;
    try {
        const { hqClientId } = await resolveHqClientId(ctx, { username: email });
        ctx.hqClientId = hqClientId;
        if (persist && hqClientId && hqClientId !== before) {
            await saveHqClientId(cacheKey, hqClientId).catch(() => { });
        }
    } catch (err) {
        console.warn(`   ⚠️ HQ client resolution failed for ${email} (${err.message}) — falling back to the company id`);
    }
    return ctx;
}

// -----------------------------------------------------------------------------
// 🔐 Login (Puppeteer bootstrap → refresh_token in Mongo)
// -----------------------------------------------------------------------------
async function loginDelhiveryApi(credentials, { forceFresh = false } = {}) {
    const email = credentials.username;
    const cacheKey = { credentialId: credentials._id, username: email };
    const started = Date.now();

    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) {
            // A cached session carries a cached hqClientId on every run after the
            // first; the resolver short-circuits on it and only reaches out when
            // the id is missing or no longer in the token's allowed list. Anything
            // it newly learns is written back so the next batch skips the probe.
            cached.cacheKey = cacheKey;
            await attachHqClient(cached, cacheKey, email);
            return cached;
        }
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    let browser = null;
    let page = null;
    let ctx = null;
    try {
        dbg(`🌐 Puppeteer login for ${email}...`);
        browser = await loadPuppeteer().launch({
            headless: isHeadless(),
            args: [
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--window-size=1440,900",
            ],
            executablePath: resolveExecutablePath(
                process.env.NODE_ENV === "production" ? "/usr/bin/google-chrome" : undefined
            ),
        });

        page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setUserAgent(UA);

        // We intercept the token endpoint so we don't have to reverse-engineer
        // where the Delhivery frontend puts the access_token in storage.
        // Whatever the SPA does with it, WE grab a copy first.
        const capturedToken = { promise: null, resolve: null };
        capturedToken.promise = new Promise((r) => { capturedToken.resolve = r; });

        page.on("response", async (res) => {
            const url = res.url();
            if (!url.includes("/protocol/openid-connect/token")) return;
            try {
                const status = res.status();
                if (status !== 200) return;
                const json = await res.json().catch(() => null);
                if (!json || !json.access_token) return;
                // The realm slug lives in the URL: .../realms/<REALM>/protocol/...
                const realmMatch = url.match(/\/realms\/([^/]+)\//);
                const realm = realmMatch ? realmMatch[1] : null;
                if (!realm) return;
                capturedToken.resolve({
                    accessToken: json.access_token,
                    refreshToken: json.refresh_token,
                    accessExpiresIn: json.expires_in,
                    idToken: json.id_token || null,
                    tokenType: json.token_type || "Bearer",
                    realm,
                });
            } catch (_) { /* not our token */ }
        });

        // Landing page → email → Continue → Keycloak password page → Login.
        const landing = process.env.DELHIVERY_LOGIN_URL || "https://one.delhivery.com/";
        await page.goto(landing, { waitUntil: "domcontentloaded", timeout: 60000 });

        // Delhivery's landing page renders after a JS init — the email input
        // is present in the DOM but not visible until the Vue app hydrates.
        // The Selenium runner (utils.js:196-198) sleeps 3.5-5s here for the
        // same reason; mirror it.
        await new Promise((r) => setTimeout(r, 4000));

        // Step 1 — email. Selector verified from the proven Selenium runner
        // (utils.js:202-204): `input[name="email"][type="email"]`. A looser
        // `input[type="email"]` matches too but sometimes matches a hidden
        // browser-autofill helper first; the name-scoped selector avoids it.
        await page.waitForSelector('input[name="email"][type="email"]', {
            visible: true, timeout: 45000,
        });
        await page.type('input[name="email"][type="email"]', email, { delay: 60 });

        // Step 2 — "Continue" button. XPath in Selenium (utils.js:214):
        //   //button[normalize-space()='Continue']
        // Puppeteer's equivalent is a text-match via page.evaluate.
        const continueClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            const btn = btns.find((b) => (b.textContent || "").trim() === "Continue" && !b.disabled);
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!continueClicked) {
            throw new Error("Delhivery login: 'Continue' button not found after email");
        }

        // Step 3 — password. Same visible-vs-hidden pattern the Selenium
        // runner uses (utils.js:233-244) — Chrome sometimes injects a
        // 0×0 hidden password node for autofill; skip past it to the real one.
        await page.waitForFunction(() => {
            const els = Array.from(document.querySelectorAll('input[type="password"]'));
            return els.some((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
        }, { timeout: 30000 });
        await new Promise((r) => setTimeout(r, 800));
        const pwdTyped = await page.evaluate((pw) => {
            const els = Array.from(document.querySelectorAll('input[type="password"]'));
            const visible = els.find((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            if (!visible) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            setter.call(visible, pw);
            visible.dispatchEvent(new Event("input", { bubbles: true }));
            visible.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }, credentials.password);
        if (!pwdTyped) {
            throw new Error("Delhivery login: visible password input not found");
        }

        // Step 4 — "Login" button. XPath in Selenium (utils.js:256):
        //   //button[normalize-space()='Login']
        const loginClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            const visible = btns.filter((b) => {
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && !b.disabled;
            });
            const btn = visible.find((b) => (b.textContent || "").trim() === "Login");
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!loginClicked) {
            throw new Error("Delhivery login: 'Login' button not found");
        }

        // Wait for the token endpoint to fire (which resolves capturedToken),
        // for the portal to reject the password, or for the 60s ceiling.
        // The rejection banner shows within a second or two of submit, so a
        // wrong password fails fast instead of burning the full timeout.
        let loginTimeout = null;
        const tokenBundle = await Promise.race([
            capturedToken.promise,
            watchForInvalidCredentialBanner(page, 60000),
            new Promise((_, rej) => {
                loginTimeout = setTimeout(() => rej(new Error("LOGIN_TIMEOUT: token endpoint never fired")), 60000);
            }),
        ]).finally(() => {
            if (loginTimeout) clearTimeout(loginTimeout);
        });
        ctx = tokenBundle;

        if (!ctx || !ctx.accessToken || !ctx.refreshToken) {
            const err = new Error("LOGIN_NO_TOKEN: token endpoint fired but response missing access/refresh token");
            err.code = "LOGIN_NO_TOKEN";
            throw err;
        }

        // Discover tenant id for the X-HQ-Client-Id header (needed on many
        // API calls). This is scoped to the email, so a single lookup per
        // credential is fine.
        try {
            const tenants = await axios.get(`${APP_AUTH_HOST}/p/tenants?email=${encodeURIComponent(email)}`, {
                headers: {
                    accept: "application/json",
                    authorization: `${ctx.tokenType} ${ctx.accessToken}`,
                    "user-agent": UA,
                },
                validateStatus: () => true,
                timeout: REQ_TIMEOUT_MS,
            });
            if (tenants.status === 200) {
                const list = Array.isArray(tenants.data) ? tenants.data : (tenants.data?.data || tenants.data?.tenants || []);
                const active = list.find?.((t) => t.realm === ctx.realm || t.is_active || t.status === "active") || list[0];
                if (active) {
                    ctx.tenantId = active.client_uuid || active.tenant_id || active.id || null;
                }
                // Informational only. This is the seller's COMPANY uuid — it used to
                // be sent as x-hq-client-id, which is why every claims call on a
                // multi-client account answered 403 "User unauthorised to access
                // mentioned client!". The header now comes from the token instead
                // (../hqClient.js); tenantId survives as the single-client fallback.
                if (ctx.tenantId) {
                    console.log(`   🏢 Delhivery company for ${email}: ${ctx.tenantId}${list.length > 1 ? ` — ${list.length} tenants on this account, picked "${active.name || active.realm || "first match"}"` : ""}`);
                } else {
                    console.warn(`   ⚠️ No company id resolved for ${email} (tenants returned ${list.length} entr${list.length === 1 ? "y" : "ies"})`);
                }
            } else {
                console.warn(`   ⚠️ Tenant lookup for ${email} returned HTTP ${tenants.status}`);
            }
        } catch (err) {
            console.warn(`   ⚠️ Tenant lookup failed for ${email} (${err.message})`);
        }

    } catch (err) {
        if (err?.code === "INVALID_CREDENTIALS") throw err;

        // Late/last-chance probe for a rejection the racing watcher missed —
        // e.g. the banner painted while we were already unwinding on some other
        // failure. The verdict is kept in a flag rather than thrown from inside
        // the probe's own try, which would swallow it on the way out.
        let rejectedByPortal = false;
        try {
            // `page` is the login tab we drove — browser.pages()[0] is the
            // blank tab Puppeteer opens at launch, which never shows the banner.
            if (page && !page.isClosed()) {
                rejectedByPortal = await page
                    .evaluate((src) => new RegExp(src, "i").test(document.body?.innerText || ""),
                        INVALID_CREDENTIAL_TEXT.source)
                    .catch(() => false);
            }
        } catch (_) { /* ignore probe errors */ }

        if (rejectedByPortal) {
            const e = new Error("INVALID_CREDENTIALS: Wrong credential");
            e.code = "INVALID_CREDENTIALS";
            throw e;
        }
        throw err;
    } finally {
        if (browser) {
            try { await browser.close(); } catch (_) { /* already gone */ }
        }
    }

    dbg(`✅ Login done in ${Date.now() - started}ms (realm=${ctx.realm})`);

    // Resolve the header the claims APIs actually authorize against. Deliberately
    // AFTER the finally block above closed Chrome — a multi-client probe is two
    // round-trips we should not hold a browser open for — and before saveSession,
    // so the resolved id is persisted alongside the tokens.
    // persist:false — saveSession below writes the whole record, hqClientId included.
    await attachHqClient(ctx, cacheKey, email, { persist: false });

    // Persist for the next run.
    await saveSession({
        ...cacheKey,
        accessToken: ctx.accessToken,
        refreshToken: ctx.refreshToken,
        accessExpiresIn: ctx.accessExpiresIn,
        idToken: ctx.idToken,
        tokenType: ctx.tokenType,
        realm: ctx.realm,
        tenantId: ctx.tenantId,
        hqClientId: ctx.hqClientId,
        clientId: "ucp-vue-frontend",
        source: forceFresh ? "renew-endpoint" : "claim-api",
    });

    return {
        accessToken: ctx.accessToken,
        refreshToken: ctx.refreshToken,
        tokenType: ctx.tokenType,
        realm: ctx.realm,
        tenantId: ctx.tenantId,
        hqClientId: ctx.hqClientId,
        clientId: "ucp-vue-frontend",
        idToken: ctx.idToken,
        // Carried so httpCall can forget a refused hq client id (see above).
        cacheKey,
    };
}

// -----------------------------------------------------------------------------
// 🧰 HTTP wrapper
// -----------------------------------------------------------------------------
function apiHeaders(ctx, extra = {}) {
    const h = {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        authorization: `${ctx.tokenType || "Bearer"} ${ctx.accessToken}`,
        "content-type": "application/json",
        origin: "https://one.delhivery.com",
        referer: "https://one.delhivery.com/",
        // The portal stamps one on EVERY call. Ours were going out without it
        // while the gateway answered 400 INVALID_OR_MISSING_PARAMS ("Could not
        // load your dashboard. Please refresh the page.") on calls whose body
        // was otherwise right, so it is sent now — fresh per request, as the
        // portal does. Cheap either way; a header the server always receives is
        // not one to keep omitting on a hunch.
        "x-ucp-request-id": randomUUID(),
    };
    // hqClientId is resolved from the token's `allowed_hq_clients` (see
    // ../hqClient.js). tenantId is the COMPANY uuid and is only right for
    // single-client accounts, so it stays a last resort rather than the source.
    const hqClient = ctx.hqClientId || ctx.tenantId;
    if (hqClient) h["x-hq-client-id"] = hqClient;
    return { ...h, ...extra };
}


/**
 * A 403 from the UCP gateway is NOT the same thing as a dead session.
 *
 * Delhivery answers a VALID token that simply may not touch a module with
 *   403 { error_code: "FORBIDDEN", message: "Mapping not found for the client id !" }
 * Treating that as AUTH_EXPIRED was actively harmful: the message read "session
 * expired" when the session probe had just passed, and the runner's AUTH_EXPIRED
 * branch burned a full Puppeteer + Keycloak re-login before failing the AWB the same
 * way — a fresh token cannot conjure a client-id mapping.
 *
 * Tagged DELHIVERY_FORBIDDEN so the runner reports Delhivery's own wording and does
 * NOT retry. A 401, and any 403 without the FORBIDDEN envelope, keep the old
 * behaviour — an unrecognised shape must stay retryable rather than being declared
 * permanent on a guess.
 */
function isForbiddenEnvelope(body) {
    if (!body || typeof body !== "object") return false;
    if (String(body.error_code || "").toUpperCase() === "FORBIDDEN") return true;
    return /mapping not found|not authorized|no access|permission denied/i.test(
        String(body.message || body.translated_message || "")
    );
}

// "unauthorised to access mentioned client" is the gateway saying the
// x-hq-client-id we sent is not one this user may act on — distinct from the
// module-level "Mapping not found for the client id !", and the only 403 that a
// different client id would fix.
const WRONG_HQ_CLIENT = /unauthoris?ed to access mentioned client/i;

function forbiddenError(step, status, body, hqClientId = null) {
    const reason =
        (body && (body.translated_message || body.message)) || "forbidden by the Delhivery gateway";
    // Name the id that was refused. Without it the message is unactionable —
    // the whole point of the failure is WHICH client was rejected.
    const suffix = hqClientId ? ` [x-hq-client-id=${hqClientId}]` : " [x-hq-client-id not sent]";
    const err = new Error(`${step}: ${reason} (HTTP ${status})${suffix}`);
    err.code = "DELHIVERY_FORBIDDEN";
    err.step = step;
    err.status = status;
    err.hqClientId = hqClientId;
    err.wrongHqClient = WRONG_HQ_CLIENT.test(String(reason));
    err.requestId = (body && body.request_id) || null;
    return err;
}

function delhiveryApiError(step, status, body) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body || "");
    const err = new Error(`${step} failed: HTTP ${status} ${bodyStr.slice(0, 300)}`);
    err.code = "DELHIVERY_API_ERROR";
    err.step = step;
    err.status = status;
    return err;
}

async function httpCall(ctx, { method = "get", url, data, headers, step }) {
    const res = await axios({
        method,
        url,
        data,
        headers: apiHeaders(ctx, headers || {}),
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });
    // Print the response before it becomes a thrown Error — the caller usually maps
    // that to a short outcome, and Delhivery's own wording would be lost otherwise.
    if (res.status >= 400) {
        logApiFailure({ platform: "delhivery", step, method, url, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    // 403 + FORBIDDEN envelope = the account may not use this module. Permanent for
    // this run: report it as such instead of pretending the session died.
    if (res.status === 403 && isForbiddenEnvelope(res.data)) {
        const err = forbiddenError(step, res.status, res.data, ctx.hqClientId || ctx.tenantId || null);
        // The gateway rejected this specific client id. Drop it from the cache so
        // the next run re-resolves rather than replaying it for another 24h.
        if (err.wrongHqClient && ctx.cacheKey) {
            await saveHqClientId(ctx.cacheKey, null).catch(() => { });
        }
        throw err;
    }
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        throw delhiveryApiError(step, res.status, res.data);
    }
    return res;
}

// -----------------------------------------------------------------------------
// 📮 AWB existence check
// -----------------------------------------------------------------------------
/**
 * POST /web/api/forward_orders/hq_es_shipments_search/list
 *
 * The portal's shipment search — the one the dashboard grid runs and the one
 * the claim drawer fires when an AWB is typed. Running it FIRST turns a wasted
 * claim attempt (download every image and video, upload them all to S3, then
 * have create_ticket reject the AWB) into one cheap call.
 *
 * ONE PARAMETER WAS WRONG, AND IT LOOKED LIKE A DEAD ENDPOINT. This asked for
 * `filter_shipment_type: ["REVERSE"]`, on the theory that a claim AWB is a
 * return leg. The gateway does not answer "no such type" — it answers
 *
 *   400 { error_code: "INVALID_OR_MISSING_PARAMS",
 *         message: "Could not load your dashboard. Please refresh the page." }
 *
 * which reads as a broken request, or a dead session, or a changed API. It is
 * none of those: the identical body with `["FORWARD"]` returns the shipment.
 * Verified 2026-09-20 on 29123116000212 — an RTO, which is a FORWARD shipment
 * that came back, so REVERSE was wrong about the data as well as unacceptable
 * to the gateway. `forward_orders` is in the path; asking it for reverse legs
 * was never going to work.
 *
 * ⚠️ `total_count` is NOT the number of matches. The live response shows
 * total_count 0 alongside result_count 1 and a populated `results`, so gating
 * on it would reject every valid AWB. `results` is the truth.
 */
const SHIPMENT_SEARCH_STATUSES = [
    "DELIVERED",
    "LOST",
    "RETURNED_TO_ORIGIN",
    "RETURNING_TO_ORIGIN",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
];

async function searchShipments(ctx, { awb, pageSize = 20 } = {}) {
    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/forward_orders/hq_es_shipments_search/list`,
        data: {
            page: 1,
            page_size: pageSize,
            search_term: awb ? String(awb) : "",
            search_on: ["oid", "wbn"],
            filter_shipment_type: ["FORWARD"],
            filter_shipment_status: SHIPMENT_SEARCH_STATUSES,
        },
        step: "Shipment search",
    });
    const body = res.data || {};
    return Array.isArray(body.results) ? body.results : [];
}

/**
 * POST /web/api/forward_orders/hq_es_shipments_search/list — by AWB, no type.
 *
 * Body: { filter_awb_number: [awb], page, page_size, search_on: ["oid","wbn"] }
 *
 * THE LOOKUP THAT FINDS A RETURN. The filtered search above is FORWARD-only,
 * and a claim AWB is often the return leg: 26472713456644 (a DTO pickup)
 * answered the FORWARD search with nothing, then fell through to
 * `global_search`, whose summary rows carry no amount — so the claim would
 * have gone out with no `claim_amount`. The portal itself, right before it
 * uploads the evidence, asks this: the same endpoint, the AWB as a filter and
 * no shipment type at all. It returns the full row, REVERSE included, with
 * `grand_total_value`. Recorded 2026-10-28 on that AWB (→ J1793190060742161).
 */
async function lookupShipmentByAwb(ctx, { awb, pageSize = 10 } = {}) {
    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/forward_orders/hq_es_shipments_search/list`,
        data: {
            filter_awb_number: [String(awb)],
            page: 1,
            page_size: pageSize,
            search_on: ["oid", "wbn"],
        },
        step: "Shipment lookup by AWB",
    });
    const body = res.data || {};
    return Array.isArray(body.results) ? body.results : [];
}

/**
 * POST /web/api/forward_orders/global_search
 *
 * The search box at the top of the portal: `{ page, page_size, search_by:
 * "WBN", search_term }` and nothing else — no type filter, no status list.
 *
 * KEPT AS THE FALLBACK, not the primary. It finds a waybill the filtered
 * search cannot (a status outside the list above, a leg it does not cover),
 * which is exactly what a fallback is for. But its rows are a summary: no
 * `cod_amount`, no `client_name`, no addresses. The filtered search answers
 * with the whole shipment, and the claim needs the amount off it.
 */
async function globalSearchShipments(ctx, { awb, pageSize = 10 } = {}) {
    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/forward_orders/global_search`,
        data: {
            page: 1,
            page_size: pageSize,
            search_by: "WBN",
            search_term: awb ? String(awb) : "",
        },
        step: "Shipment search (global)",
    });
    const body = res.data || {};
    return Array.isArray(body.results) ? body.results : [];
}

/** The exact AWB if it is in the rows, else the first row, else null. */
function pickShipment(rows, awb) {
    const exact = (rows || []).find((r) => String(r?.awb_number) === String(awb));
    return exact || (rows || [])[0] || null;
}

/**
 * Both searches on the client the ctx currently points at, the complete one
 * first. Exported because the account-mapping probe asks the same question —
 * "does this login hold this waybill" — and must not answer "no" to a shipment
 * the filtered search happens not to cover.
 */
async function findOnCurrentClient(ctx, awb) {
    let hit = null;

    try {
        hit = pickShipment(await searchShipments(ctx, { awb }), awb);
    } catch (err) {
        // A REFUSED SEARCH IS NOT AN ANSWER ABOUT THE AWB, and this call used
        // to throw straight out of here — taking the global-search fallback
        // below and the caller's whole cross-client sweep with it.
        //
        // The gateway refuses the filtered search on a client that cannot serve
        // it with 400 INVALID_OR_MISSING_PARAMS ("Could not load your
        // dashboard"), which says nothing about whether some OTHER client holds
        // the waybill. Treating it as fatal meant a two-client account failed
        // every claim whenever the session happened to point at the wrong one.
        console.warn(`   ⚠️ [delhivery] shipment search for ${awb} failed: ${err.message}`);
    }

    if (hit) return hit;

    // A return leg: not in the FORWARD search, but a full row by AWB. Before the
    // summary-only global search, because the claim needs the amount off it.
    try {
        hit = pickShipment(await lookupShipmentByAwb(ctx, { awb }), awb);
    } catch (err) {
        console.warn(`   ⚠️ [delhivery] AWB lookup for ${awb} failed: ${err.message}`);
    }

    if (hit) return hit;

    try {
        return pickShipment(await globalSearchShipments(ctx, { awb }), awb);
    } catch (err) {
        // The fallback failing is not an answer about the AWB — let the caller
        // carry on to the next client rather than reporting "nobody has it".
        console.warn(`   ⚠️ [delhivery] global search for ${awb} failed: ${err.message}`);
        return null;
    }
}

/**
 * EXPRESS or SURFACE, as the shipment itself reports it.
 *
 * `box_list[].shipping_mode` is the freight lane — the same word the CMS row
 * carries as `domestic` and the Selenium flow picks from the header dropdown.
 * `client_name` ("UNIVERSAL SPORTSBIZ EXPRESS") carries it too, and is the
 * fallback: the summary rows from `global_search` have no box list.
 */
function shippingModeOf(shipment) {
    const box = Array.isArray(shipment?.box_list) ? shipment.box_list[0] : null;
    const mode = String(box?.shipping_mode || "").trim().toUpperCase();

    if (mode) return mode;

    const label = String(shipment?.client_name || "").toUpperCase();

    if (/\bSURFACE\b/.test(label)) return "SURFACE";
    if (/\bEXPRESS\b/.test(label)) return "EXPRESS";

    return null;
}

/**
 * What this claim is worth, according to Delhivery.
 *
 * NOBODY TYPES THIS. The portal's claim form fills the amount in as soon as an
 * AWB is entered — it is the shipment's own value, not a judgement about the
 * claim — and `cod_amount` is where it comes from (1384 on the shipment, 1384
 * on the ticket that was filed against it). `grand_total_value` is the same
 * figure for a prepaid parcel, where there is no COD to collect.
 *
 * So a CMS row does not need a claim-amount field, and asking an operator to
 * retype a number the marketplace already holds would only be a way to get it
 * wrong.
 */
function shipmentAmountOf(shipment) {
    for (const value of [shipment?.cod_amount, shipment?.grand_total_value]) {
        const amount = Number(value);

        if (Number.isFinite(amount) && amount > 0) return amount;
    }

    return null;
}

/**
 * Find the AWB, trying every HQ client this login is allowed to act on.
 *
 * WHY IT HAS TO SWEEP. A Delhivery seller's shipments are split across HQ
 * clients — one per freight lane on this account, EXPRESS and SURFACE — and
 * every call is scoped to exactly one by `x-hq-client-id`. A shipment on the
 * other client is not "not found on a technicality": the search answers 200
 * with an EMPTY result, which is indistinguishable from an AWB that does not
 * exist. Verified on 29123116000212: found under
 * cms::client::f21a90b3-… (EXPRESS, "UNIVERSAL SPORTSBIZ EXPRESS"), zero
 * results under cms::client::0796af0f-… (SURFACE), same token, same body.
 *
 * The session's own client is asked first — it is right for most AWBs, and the
 * sweep then costs nothing. A hit on another client is REMEMBERED on the
 * session, so a batch from that lane pays for the discovery once.
 *
 * This is also why `resolveHqClientId`'s probe is not enough on its own: it
 * asks "may this login use the claims module at all", which both clients
 * answer yes to. Only the AWB can say which one owns it.
 */
async function findShipmentForAwb(ctx, awb) {
    const current = ctx.hqClientId || ctx.tenantId || null;
    let hit = null;

    try {
        hit = await findOnCurrentClient(ctx, awb);
    } catch (err) {
        // THE SAME TOLERANCE THE CANDIDATE LOOP BELOW ALREADY HAD. This call
        // did not have it, and the asymmetry was the bug: a session pointing at
        // a client that refuses the search threw here, so the sweep that exists
        // precisely to find the right client never ran. The account's OTHER
        // client held the waybill the whole time.
        console.warn(
            `   ⚠️ [delhivery] ${current || "the current client"} could not be searched for ${awb}: ${err.message}`
        );
    }

    if (hit) return { shipment: hit, hqClientId: current, switched: false };

    const others = allowedHqClients(ctx.accessToken).filter((id) => id !== current);

    if (others.length === 0) return null;

    console.log(
        `   🔎 [delhivery] ${awb} is not on ${current || "the current client"} — trying ${others.length} other HQ client(s)`
    );

    for (const candidate of others) {
        // A COPY, so a candidate that answers nothing cannot leave the session
        // pointed at a client that does not own this AWB.
        const probeCtx = { ...ctx, hqClientId: candidate };
        let candidateHit = null;

        try {
            candidateHit = await findOnCurrentClient(probeCtx, awb);
        } catch (err) {
            // One refused client must not end the sweep: the next may be the
            // owner, and reporting "no AWB" because of it would be wrong.
            console.warn(`   ⚠️ [delhivery] client ${candidate} could not be searched: ${err.message}`);
            continue;
        }

        if (!candidateHit) continue;

        // The row names its own client. Prefer it over the candidate we guessed
        // into the header — they agree in every capture, and if they ever do
        // not, the shipment is the authority on who owns it.
        const owner = String(candidateHit.client_uuid || candidate);

        ctx.hqClientId = owner;
        console.log(
            `   🏢 [delhivery] ${awb} belongs to ${candidateHit.client_name || owner} — switching this session to it`
        );

        // Best effort: the claim can be filed either way, and a cache write
        // that fails must not cost the AWB that was just located.
        if (ctx.cacheKey) await saveHqClientId(ctx.cacheKey, owner).catch(() => { });

        return { shipment: candidateHit, hqClientId: owner, switched: true };
    }

    return null;
}

/**
 * Assert the AWB exists on this account, and return the matching shipment.
 *
 * Throws AWB_NOT_FOUND when no client holds it — a permanent verdict for this
 * credential, so the runner reports it instead of retrying.
 *
 * @param {string} [options.domestic] the row's EXPRESS/SURFACE pick, compared
 *        against what the shipment says purely to report a disagreement.
 */
async function assertAwbExists(ctx, awb, { domestic = "" } = {}) {
    const found = await findShipmentForAwb(ctx, awb);

    if (!found) {
        const err = new Error("No AWB number found");
        err.code = "AWB_NOT_FOUND";
        err.awb = awb;
        throw err;
    }

    const mode = shippingModeOf(found.shipment);
    const picked = String(domestic || "").trim().toUpperCase();
    // Only a lane word is comparable. Since the form offers the account's own
    // Domestic list, `domestic` is usually a client name ("STYLEVERSE B2C"),
    // which is not a lane and must not read as a disagreement.
    const wanted = picked === "EXPRESS" || picked === "SURFACE" ? picked : "";

    // Said, never acted on. The shipment is the authority on its own lane, and
    // refusing a claim because somebody picked the wrong word on the form would
    // fail a claim Delhivery would have accepted.
    if (mode && wanted && mode !== wanted) {
        console.warn(
            `   ⚠️ [delhivery] ${awb} is a ${mode} shipment but the claim says ${wanted} — filing against ${mode}`
        );
    }

    return found.shipment;
}

/**
 * POST /web/api/dashboard/claims/liability_preview — body { wbn }.
 *
 * What Delhivery will pay on this waybill, as its own claim form shows it:
 * `claim_amount`, `max_liability`, `product_value`, the liability rule. The
 * portal calls it when an AWB is entered (recorded 2026-10-28: 26472713456644 →
 * claim_amount 1020, "CN till claimed amount").
 *
 * The LAST source of a claim amount, not the first: the row's own figure and
 * the shipment's value are what earlier live submits were filed on, and this is
 * for the shipment that carries neither. Never throws — null when it cannot say.
 */
async function liabilityPreviewAmount(ctx, awb) {
    try {
        const res = await httpCall(ctx, {
            method: "post",
            url: `${GATEWAY_HOST}/web/api/dashboard/claims/liability_preview`,
            data: { wbn: String(awb) },
            step: "Liability preview",
        });
        const preview = res.data?.data?.data || res.data?.data || {};

        for (const value of [preview.claim_amount, preview.max_liability]) {
            const amount = Number(value);

            if (Number.isFinite(amount) && amount > 0) return amount;
        }
    } catch (err) {
        console.warn(`   ⚠️ [delhivery] liability preview for ${awb} unavailable: ${err.message}`);
    }

    return null;
}

// -----------------------------------------------------------------------------
// 🔎 Support categories (for building the create_ticket payload)
// -----------------------------------------------------------------------------
async function getSupportCategories(ctx) {
    const res = await httpCall(ctx, {
        method: "get",
        url: `${GATEWAY_HOST}/web/api/support/categories?raised_from=ucp`,
        step: "Support categories",
    });
    return res.data?.data || res.data || [];
}

// -----------------------------------------------------------------------------
// 📎 Presigned URLs + S3 upload
// -----------------------------------------------------------------------------
/**
 * POST /web/api/claims/upload/presigned-urls
 * Body: { awb, files: [{ fileName, contentType, fileSize }] }
 * Returns: [{ presigned_url, post_fields, s3_key, max_file_size_bytes }]
 *
 * Then multipart POST to each presigned_url with the post_fields as form
 * fields plus the file as `file`.
 */
async function getPresignedUrls(ctx, awb, files) {
    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/claims/upload/presigned-urls`,
        data: { awb, files },
        step: "Get presigned URLs",
    });
    const body = res.data || {};
    const uploads = body.uploads || body.data?.uploads || [];
    if (!Array.isArray(uploads) || uploads.length !== files.length) {
        throw new Error(`Get presigned URLs: expected ${files.length} slots, got ${uploads.length}`);
    }
    return uploads;
}

async function uploadToS3(upload, filePath) {
    if (!upload?.presigned_url || !upload?.post_fields) {
        throw new Error("uploadToS3: missing presigned_url / post_fields");
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(upload.post_fields)) form.append(k, v);
    form.append("file", fs.createReadStream(filePath));

    const res = await axios.post(upload.presigned_url, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS * 5,   // uploads may be large videos
    });
    // Own request, so it does not pass through httpCall — log it here too.
    if (res.status >= 400) {
        logApiFailure({ platform: "delhivery", step: "S3 upload", method: "POST", url: upload.presigned_url, status: res.status, data: res.data });
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`S3 upload failed: HTTP ${res.status} ${String(res.data || "").slice(0, 200)}`);
    }
    return upload.s3_key;
}

/**
 * Upload every file for a claim, return the array of s3_keys in the order
 * their filenames were requested. Delhivery names files with a convention
 * like `Unbox_Video_1.mp4`, `Unbox_Image_2.jpg`, ... so we mirror that.
 */
async function materializeAttachments(ctx, awb, files) {
    // files: [{ localPath, contentType, fileName }] where fileName is the
    // portal-style name (Unbox_Image_2.jpg etc). If fileName is missing we
    // fall back to path.basename.
    const filesMeta = files.map((f, i) => {
        const stat = fs.statSync(f.localPath);
        return {
            fileName: f.fileName || path.basename(f.localPath),
            contentType: f.contentType || "application/octet-stream",
            fileSize: stat.size,
            localPath: f.localPath,
        };
    });
    const uploads = await getPresignedUrls(
        ctx,
        awb,
        filesMeta.map(({ fileName, contentType, fileSize }) => ({ fileName, contentType, fileSize }))
    );
    /**
     * THE WHOLE RECORD, not just the key.
     *
     * create_ticket does not take a list of s3 keys — it takes a
     * `media_context` naming each file's key, MIME type, byte size and the
     * identifier it was uploaded under (see below). All four are already known
     * here, and re-deriving them at submit time would mean stat-ing files the
     * caller may already have cleaned up.
     */
    const uploaded = [];
    for (let i = 0; i < filesMeta.length; i++) {
        const key = await uploadToS3(uploads[i], filesMeta[i].localPath);
        uploaded.push({
            s3_key: key,
            content_type: filesMeta[i].contentType,
            file_size: filesMeta[i].fileSize,
            identifier: filesMeta[i].fileName,
        });
    }
    return uploaded;
}

// -----------------------------------------------------------------------------
// ✅ Create ticket (the claim submit)
// -----------------------------------------------------------------------------
/**
 * The portal's category, and how the CMS row's wording reaches it.
 *
 * THE FORM AND THE API DO NOT SPEAK THE SAME WORDS. The drawer offers
 * "Damage / Missing / Mismatch" and "Damage in delivered/returned shipment";
 * the API that the drawer then calls sends `category: "Claim LnD B2C"` and
 * `sub_category: "Damaged"`. Passing the drawer's labels through — which is
 * what this used to do — hands the gateway strings it has never seen.
 *
 * "Damaged" is verified (live submit, 2026-09-20, ticket J1789925203929469).
 * "Missing" and "Mismatch" are the same transformation applied to the other two
 * options and are NOT yet confirmed against a live submit; `logCategoryChoice`
 * prints the portal's own list when one of them is used, so the first run on
 * either pins it down instead of guessing twice.
 */
const CLAIM_CATEGORY = "Claim LnD B2C";

/**
 * The portal's own sub-category names, which are NOT the words the drawer uses
 * and not the words a reasonable guess produces.
 *
 * Both of these are from live submits that came back with a ticket id:
 *
 *   "Received used or damaged product"   → "Damaged"          (J1789925203929469)
 *   "Item missing or received empty box" → "Content Mismatch" (J1790859523117080)
 *
 * THE SECOND ONE IS WHY THIS IS A TABLE AND NOT A PATTERN. "Item missing" maps
 * to CONTENT MISMATCH, not to anything containing the word missing — a rule
 * that read the claim's own wording would get it confidently wrong, which is
 * exactly what happened: a claim went out as "Mismatch", a name the portal does
 * not have, and came back 200 with no ticket id at all.
 *
 * Ordered, and the first match wins. A row's own subcategory is matched before
 * its claim type because it is the more specific of the two.
 */
const SUB_CATEGORY_RULES = [
    // Verified. An empty box and a wrong article are the same complaint to this
    // portal: what arrived is not what should have.
    { match: /missing|empty box|short|mismatch|wrong/i, value: "Content Mismatch" },
    // Verified.
    { match: /damage|used/i, value: "Damaged" },
];

/** Names a live submit has accepted. The rest are logged as unverified. */
const VERIFIED_SUB_CATEGORIES = new Set(["Damaged", "Content Mismatch"]);

/**
 * The row's subcategory (or claim type, when the subcategory is blank) → the
 * portal's own sub_category word.
 */
function subCategoryFor({ subcategory, claimType } = {}) {
    // THE ROW'S OWN SUBCATEGORY FIRST, then its claim type — the two can say
    // different things ("Damage in delivered/returned shipment" filed as "Item
    // missing"), and reading them as one string lets the vaguer half win.
    for (const field of [subcategory, claimType]) {
        const text = String(field || "");

        if (!text) continue;

        const rule = SUB_CATEGORY_RULES.find((r) => r.match.test(text));

        if (rule) return rule.value;
    }

    // Nothing recognisable. "Damaged" is the commonest claim by a wide margin,
    // and a verified name beats an invented one — `logCategoryChoice` says so
    // out loud, with the portal's real list beside it.
    return "Damaged";
}

/**
 * The account this token belongs to, for `email_id`.
 *
 * Read from the token rather than plumbed through every caller: it is already
 * in the JWT (`email`, else `preferred_username`), it is by definition the
 * account the ticket is being raised from, and a second source could disagree
 * with the one the gateway authenticated.
 */
function emailFromToken(ctx) {
    const payload = decodeJwtPayload(ctx && ctx.accessToken);
    return payload?.email || payload?.preferred_username || "";
}

/**
 * Print the portal's own category list when we are about to send an unverified
 * sub_category. Best effort, and never fatal — a diagnostic, not a gate.
 */
async function logCategoryChoice(ctx, category, subCategory) {
    if (VERIFIED_SUB_CATEGORIES.has(subCategory)) return;

    try {
        const list = await getSupportCategories(ctx);
        console.log(
            `   ℹ️ [delhivery] sending unverified sub_category "${subCategory}" under "${category}". ` +
            `Portal categories: ${JSON.stringify(list).slice(0, 600)}`
        );
    } catch (err) {
        console.log(
            `   ℹ️ [delhivery] sending unverified sub_category "${subCategory}" under "${category}" ` +
            `(category list unavailable: ${err.message})`
        );
    }
}

/**
 * POST /web/api/support/create_ticket — the claim submit.
 *
 * MULTIPART, NOT JSON, and that is the whole shape of this function. The
 * portal sends `multipart/form-data` with ONE part named `ticket_request`,
 * filename "blob", Content-Type application/json, whose body is:
 *
 *   {
 *     "category": "Claim LnD B2C",
 *     "sub_category": "Damaged",
 *     "ref_nums": "29123116000212",
 *     "claim_amount": 1384,
 *     "description": "…",
 *     "email_id": "seller@example.com",
 *     "media_context": "{\"upload_type\":\"CUSTOMER_UPLOAD\",\"source\":\"CMS\",
 *                        \"uploaded_files\":[{\"s3_key\":…,\"content_type\":…,
 *                        \"file_size\":…,\"identifier\":…}]}"
 *   }
 *
 * `media_context` is a STRING containing JSON, not an object — nested exactly
 * as the portal nests it. The previous shape here (flat JSON with
 * `raised_from`, `awb_number`, `attachment_keys`, `claim_type`, `domestic`) was
 * assembled by inference from what the Selenium drawer collects, because the
 * original capture had no request body. None of those field names appear in
 * the real request.
 *
 * Verified against a live submit on 2026-09-20 (AWB 29123116000212 →
 * J1789925203929469). Response is unchanged:
 *   { ticket_id, request_id, message, public_ticket_id, invalid, sync,
 *     duplicate, deflected }
 */
async function createTicket(ctx, {
    awbNumber,
    subcategory,          // the row's drawer label — mapped, see above
    claimType,            // typeOfClaim, used for the fallback description
    description,
    claimAmount,          // rupees; omitted when the row carries none
    files,                // [{ s3_key, content_type, file_size, identifier }]
    category = CLAIM_CATEGORY,
    subCategory = null,   // an explicit override, for a caller that knows better
}) {
    assertClaimSubmitEnabled("delhivery", "create ticket");

    const sub = subCategory || subCategoryFor({ subcategory, claimType });
    const uploaded = Array.isArray(files) ? files : [];
    const amount = Number(claimAmount);

    await logCategoryChoice(ctx, category, sub);

    const ticketRequest = {
        category,
        sub_category: sub,
        ref_nums: String(awbNumber),
        /*
         * WHAT `ref_nums` IS, and the field whose absence cost a claim.
         *
         * Without it the portal answered 200 with `public_ticket_id: null` —
         * no error, no reason, just a ticket that was never raised. The flow
         * reported "Ticket id not captured after submit; verify manually" and
         * the row went to Failed, which is the most expensive outcome there is:
         * it reads as "maybe a ticket exists" and nobody can tell.
         *
         * "WBN" is a waybill number. Every claim this app files is keyed on
         * one, so it is constant here rather than a parameter — the day one is
         * keyed on an order id instead, this becomes an argument.
         */
        object_type: "WBN",
        description:
            description ||
            `This conversation thread has been created automatically for your claim associated with ` +
            `AWB# ${awbNumber}.\nClaim type: ${claimType || sub}`,
        email_id: emailFromToken(ctx),
        media_context: JSON.stringify({
            upload_type: "CUSTOMER_UPLOAD",
            source: "CMS",
            uploaded_files: uploaded,
        }),
    };

    /**
     * SENT ONLY WHEN THERE IS ONE. The caller reads it off the shipment
     * (`cod_amount`), which is where the portal's own form gets it, so this is
     * normally filled. A blank means the shipment carried no value either —
     * and a zero we invented would be worse than letting the gateway say the
     * field is required.
     */
    if (Number.isFinite(amount) && amount > 0) {
        ticketRequest.claim_amount = amount;
    } else {
        console.warn(
            `   ⚠️ [delhivery] ${awbNumber}: neither the row nor the shipment carries an amount — ` +
            `create_ticket is being sent without one`
        );
    }

    const form = new FormData();
    // filename + contentType matter: the portal sends this part as a file named
    // "blob", and a plain field of the same name is a different request.
    form.append("ticket_request", Buffer.from(JSON.stringify(ticketRequest)), {
        filename: "blob",
        contentType: "application/json",
    });

    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/support/create_ticket`,
        data: form,
        // Replaces the JSON content-type from apiHeaders, boundary included.
        headers: form.getHeaders(),
        step: "Create ticket",
    });

    const data = res.data || {};
    const publicTicketId = data.public_ticket_id || data.data?.public_ticket_id || null;
    const ticketUuid = data.ticket_id || data.data?.ticket_id || null;

    /*
     * A 200 WITH NO TICKET IS THE PORTAL REFUSING, QUIETLY.
     *
     * It is what a payload it does not accept produces — a missing
     * `object_type`, a sub_category it has never heard of — and it carries no
     * error, no code and no message to say so. The caller turns it into "Ticket
     * id not captured after submit; verify manually", which is both true and
     * unactionable: somebody then has to open the portal to find out whether a
     * claim exists.
     *
     * So the request is written down beside it. What was sent is the only thing
     * that explains what came back, and the alternative is reproducing the
     * claim by hand to find out — which is how the missing `object_type` was
     * found in the first place.
     */
    if (!publicTicketId) {
        console.warn(
            `⚠️ [delhivery] create_ticket answered HTTP ${res.status} with no ticket id. ` +
            `Sent: category=${JSON.stringify(ticketRequest.category)} ` +
            `sub_category=${JSON.stringify(ticketRequest.sub_category)} ` +
            `object_type=${JSON.stringify(ticketRequest.object_type)} ` +
            `ref_nums=${JSON.stringify(ticketRequest.ref_nums)} ` +
            `claim_amount=${JSON.stringify(ticketRequest.claim_amount ?? null)} ` +
            `files=${uploaded.length}. Answered: ${JSON.stringify(data).slice(0, 300)}`
        );
    }
    // "duplicate: true" means Delhivery already had a ticket for this AWB —
    // the response still carries the existing public_ticket_id, and we treat
    // it as a pre-existing claim rather than a filing failure.
    return {
        publicTicketId,
        ticketUuid,
        duplicate: data.duplicate === true,
        deflected: data.deflected === true,
        message: data.message || null,
    };
}

// -----------------------------------------------------------------------------
// 🎟️ Support tickets by AWB (failure recovery)
// -----------------------------------------------------------------------------
/**
 * POST /web/api/support/client_tickets
 * Body: { page, status: [...], ref_num: <awb> }
 *
 * The portal's own ticket list, filtered by AWB. Its value here is recovery: a
 * claim can fail on our side AFTER Delhivery already created the ticket — the
 * submit succeeds but the response is lost, create_ticket answers without a
 * public id, or the run dies between submit and DB write. In all of those the
 * ticket is real and re-running would file a duplicate. Asking by AWB is the
 * only way to find out.
 *
 * ⚠️ The response body was NOT in any capture (silent webRequest mode dropped
 * it), so only `public_ticket_id` is confirmed — from the create_ticket response
 * and from a live sample. Everything else here reads defensively: the result
 * array is looked for under each plausible key, and the ticket id and status
 * under each plausible field. DELHIVERY_API_DEBUG=true prints the real keys when
 * nothing matches, which is how to pin this down without another capture.
 */
/**
 * The status buckets, asked for ONE AT A TIME.
 *
 * All four in a single `status` array is what this used to send, and every call
 * came back 400 INVALID_OR_MISSING_PARAMS — the same "Could not load your
 * dashboard" the gateway gives for anything it dislikes, with nothing to say
 * which part. The portal's own request (captured 2026-10-01) sends exactly one:
 *
 *     {"page":1,"status":["CLOSED"],"ref_num":"55406810335613"}
 *
 * So each is asked separately and the first hit wins. CLOSED leads because a
 * ticket this lookup is for has usually been decided already — it runs after a
 * submit whose answer was lost, which means minutes or hours have passed.
 *
 * THE FILTER IS NOT THE ROW'S OWN WORD. The ticket that came back under
 * `status: ["CLOSED"]` reads `"status": "rejected"`. The filter names a bucket;
 * the row names an outcome, and the two vocabularies do not match — which is
 * why a ticket is never searched for by the status it reports.
 */
const TICKET_STATUSES = ["CLOSED", "RESOLVED", "OPEN", "RESPONSE_NEEDED"];

function pickTicketList(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== "object") return [];
    for (const key of ["results", "tickets", "data", "items", "records"]) {
        const v = body[key];
        if (Array.isArray(v)) return v;
        // One level of nesting: { data: { results: [...] } }
        if (v && typeof v === "object") {
            for (const inner of ["results", "tickets", "items", "records"]) {
                if (Array.isArray(v[inner])) return v[inner];
            }
        }
    }
    return [];
}

function pickTicketId(row) {
    return (
        row?.public_ticket_id ||     // confirmed — the "J17872…" display id
        row?.publicTicketId ||
        row?.jarvis_ticket_id ||
        row?.ticket_display_id ||
        row?.ticket_id ||
        null
    );
}

function pickTicketStatus(row) {
    return row?.status || row?.ticket_status || row?.state || null;
}

/** One bucket, one call — the shape the portal itself sends. */
async function listClientTicketsByStatus(ctx, { awb, status, page = 1 }) {
    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/support/client_tickets`,
        data: { page, status: [status], ref_num: awb ? String(awb) : "" },
        step: `Client tickets (${status})`,
    });

    const rows = pickTicketList(res.data);

    if (rows.length === 0 && res.data && typeof res.data === "object") {
        dbg(`client_tickets returned no recognisable list — top-level keys: ${Object.keys(res.data).join(", ")}`);
    }

    return rows;
}

/**
 * Every ticket this client holds for the AWB, across the status buckets.
 *
 * ONE REFUSED BUCKET IS NOT AN ANSWER. These calls are a recovery — they run
 * after a submit whose reply was lost — so a 400 or a 403 on one status must
 * not throw away the three that might hold the ticket. The error is kept and
 * reported only if NOTHING answered, where it is the whole explanation.
 */
async function listClientTickets(ctx, { awb, statuses = TICKET_STATUSES, page = 1 } = {}) {
    let lastError = null;

    for (const status of statuses) {
        try {
            const rows = await listClientTicketsByStatus(ctx, { awb, status, page });

            if (rows.length > 0) return rows;
        } catch (err) {
            lastError = err;
            dbg(`client_tickets ${status} failed: ${err.message}`);
        }
    }

    if (lastError && statuses.length > 0) throw lastError;

    return [];
}

/**
 * Find the ticket Delhivery already holds for this AWB.
 *
 * Returns null when there is none. Takes the FIRST row, as instructed — the
 * filter is already scoped to one AWB, and Delhivery returns newest first.
 */
async function findTicketByAwb(ctx, awb) {
    const rows = await listClientTickets(ctx, { awb });
    if (!rows.length) return null;

    /*
     * THE ONE FOR THIS AWB, not simply the first row.
     *
     * The filter is already scoped by `ref_num`, and in every capture the list
     * holds one ticket — but the recovery this feeds WRITES A TICKET NUMBER
     * ONTO A CLAIM, and a number from a neighbouring parcel is worse than no
     * number at all. `tracking_id` is the AWB the portal itself puts on the row.
     */
    const row = rows.find((entry) => String(entry?.tracking_id || "") === String(awb)) || rows[0];
    const publicTicketId = pickTicketId(row);
    if (!publicTicketId) {
        dbg(`client_tickets row for ${awb} carried no ticket id — row keys: ${Object.keys(row || {}).join(", ")}`);
        return null;
    }
    return {
        publicTicketId,
        ticketStatus: pickTicketStatus(row),
        ticketCount: rows.length,
        raw: row,
    };
}

/**
 * A CLAIM ticket Delhivery already holds for this AWB, or null.
 *
 * THE SECOND DUPLICATE CHECK, and the one that catches a claim raised a minute
 * ago. `claims/lost_damage/list` is the first, and it does not show a claim
 * filed through Support straight away: after 26472713456644 was filed
 * (J1793190060742161, recorded 2026-10-28) the claims list still answered
 * empty for it, while this list already had the ticket. Without this a second
 * run on that AWB would have raised a second ticket.
 *
 * Differs from `findTicketByAwb` on purpose — that one is failure recovery and
 * takes whatever ticket the AWB has. This one decides whether to FILE, so:
 *
 *   - only claim tickets count (category "Claim …", e.g. "Claim LnD B2C") — a
 *     delivery query raised on the same AWB must not stop a claim;
 *   - every status bucket is read, not the first non-empty one — a closed
 *     query must not hide an open claim;
 *   - only a row whose `tracking_id` is this AWB counts.
 *
 * Throws only when every bucket was refused; the caller treats that as "could
 * not check", never as "no ticket".
 */
async function findClaimTicketByAwb(ctx, awb, { statuses = TICKET_STATUSES } = {}) {
    let answered = false;
    let lastError = null;

    for (const status of statuses) {
        let rows;

        try {
            rows = await listClientTicketsByStatus(ctx, { awb, status });
            answered = true;
        } catch (err) {
            lastError = err;
            dbg(`client_tickets ${status} failed: ${err.message}`);
            continue;
        }

        const row = rows.find(
            (entry) =>
                String(entry?.tracking_id || "") === String(awb) &&
                /^claim\b/i.test(String(entry?.category || ""))
        );
        const publicTicketId = row ? pickTicketId(row) : null;

        if (publicTicketId) {
            return { publicTicketId, ticketStatus: pickTicketStatus(row), category: row.category, raw: row };
        }
    }

    if (!answered && lastError) throw lastError;

    return null;
}

/** Delhivery's internal ticket id — a UUID, not the "J…" number anyone can look up. */
const INTERNAL_TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInternalTicketId(value) {
    return INTERNAL_TICKET_ID.test(String(value || "").trim());
}

/**
 * The public "J…" number for a ticket known only by its internal UUID.
 *
 * WHY THIS EXISTS. `claims/lost_damage/list` names a claim's ticket as
 * `jarvis_ticket_id` — Delhivery's internal UUID ("587232ca-22bb-…"), not the
 * J-number the portal, the seller and `fetchClientTicket` all use. A claim found
 * already filed was recorded with that UUID, and the status check then could
 * not read its ticket at all. The support-ticket list carries both:
 * `ticket_id` is the same UUID, `public_ticket_id` the J-number (recorded
 * 2026-10-28: 8a2e5b88-… ⇄ J1793190060742161).
 *
 * Every status bucket, matched on `ticket_id`. Null when no row matches or the
 * list cannot be read — the caller keeps what it had rather than guessing.
 */
async function resolvePublicTicketId(ctx, awb, ticketUuid, { statuses = TICKET_STATUSES } = {}) {
    if (!isInternalTicketId(ticketUuid)) return null;

    for (const status of statuses) {
        let rows;

        try {
            rows = await listClientTicketsByStatus(ctx, { awb, status });
        } catch (err) {
            dbg(`client_tickets ${status} failed while resolving ${ticketUuid}: ${err.message}`);
            continue;
        }

        const row = rows.find(
            (entry) => String(entry?.ticket_id || "").toLowerCase() === String(ticketUuid).trim().toLowerCase()
        );
        const publicTicketId = row?.public_ticket_id || null;

        if (publicTicketId) return publicTicketId;
    }

    return null;
}

// Ticket lifecycle → CMS status.
//
// Only the two unambiguous ones are mapped. RESOLVED/CLOSED describe the TICKET,
// not the claim's outcome — a ticket closes whether the claim was paid or
// refused — so asserting "Approved" from them would overwrite a real verdict
// with a guess. They map to null, which leaves the CMS status untouched for the
// existing status sync (claims/lost_damage/list) to fill in from the claim's own
// state. Same rationale as DELHIVERY_TO_CMS_STATUS below.
const TICKET_STATUS_TO_CMS = {
    open: "In Review",
    response_needed: "Awaiting Seller Response",
};

function mapTicketStatus(ticketStatus) {
    if (!ticketStatus) return null;
    const key = String(ticketStatus).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return TICKET_STATUS_TO_CMS[key] || null;
}

// -----------------------------------------------------------------------------
// 🎫 Claim status readback
// -----------------------------------------------------------------------------
/**
 * POST /web/api/claims/lost_damage/list
 *
 * Body: search_on ["awb_number"], search_type "CONTAINS", search_term, page,
 *       page_size, only_count, range_created_at, range_updated_at
 * Response: { results: [{ claim_id, wbn, closing_remark, status,
 *             jarvis_ticket_id, ... }] }
 *
 * status values observed: "claim_rejected". Others inferred:
 *   open / claim_approved / in_review / (pending?)
 * The mapping table below leaves unknowns as null so the CMS status is
 * untouched rather than mis-labelled.
 */
async function listLostDamageClaims(ctx, { awb, monthsWindow = 2 } = {}) {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - monthsWindow);

    const body = {
        search_on: ["awb_number"],
        search_type: "CONTAINS",
        search_term: awb ? String(awb) : "",
        page_size: 20,
        page: 1,
        only_count: false,
        range_created_at: [
            { op: "GTE", value: start.toISOString() },
            { op: "LTE", value: now.toISOString() },
        ],
        range_updated_at: [{ op: "EQ", value: "" }],
    };
    const res = await httpCall(ctx, {
        method: "post",
        url: `${GATEWAY_HOST}/web/api/claims/lost_damage/list`,
        data: body,
        step: "Claim list",
    });
    return res.data?.results || res.data?.data?.results || [];
}

// -----------------------------------------------------------------------------
// 🎫 Ticket readback — the support ticket, by the number the claim was given
// -----------------------------------------------------------------------------
/**
 * POST {GATEWAY_HOST}/web/api/support/client_tickets
 *
 * VERIFIED (one.delhivery.com, 2026-09-18):
 *   → { public_ticket_id: "J1789715959679284", page: "1", status: "CLOSED" }
 *   ← { total_count: 1, results: [ { ticket_id, status: "rejected",
 *       public_ticket_id, tracking_id, subject, category, sub_category } ] }
 *
 * THE VERDICT IS ONE WORD, and it is not the one the claims list uses:
 * `accepted` and `rejected`, against that list's `claim_approved` /
 * `claim_rejected`. Two vocabularies for the same fact, so they are mapped
 * separately rather than folded into one table that would have to guess which
 * endpoint a string came from.
 *
 * ASKED TWICE WHEN IT HAS TO BE. The captured call filters on `status: CLOSED`,
 * which is the finished ticket — and a claim still being looked at is not
 * closed, so that filter alone would report every open claim as "no ticket".
 * The unfiltered call is tried second, in that order, because the filtered one
 * is the shape Delhivery actually answered.
 */
async function fetchClientTicket(ctx, publicTicketId) {
    const ticketId = String(publicTicketId || "").trim();

    if (!ticketId) throw new Error("fetchClientTicket: public_ticket_id is required");

    for (const filter of [{ status: "CLOSED" }, {}]) {
        const res = await httpCall(ctx, {
            method: "post",
            url: `${GATEWAY_HOST}/web/api/support/client_tickets`,
            data: { public_ticket_id: ticketId, page: "1", ...filter },
            step: `Client ticket (${filter.status || "any"})`,
        });

        const results = res.data?.results || res.data?.data?.results || [];
        const found = results.find(
            (row) => String(row?.public_ticket_id || "").trim() === ticketId
        ) || results[0];

        if (found) return found;
    }

    return null;
}

/**
 * The support ticket's own verdict → a CMS status.
 *
 * ONLY THE TWO THAT ARE DECISIONS. `accepted` is the claim paid, `rejected` is
 * the claim refused, and every other state Delhivery reports — open, pending,
 * whatever it calls the middle — means nobody has decided yet. Those map to
 * null, which leaves the row exactly as it is: a claim under review stays under
 * review rather than being rewritten every time the sweep runs.
 */
const DELHIVERY_TICKET_TO_CMS_STATUS = {
    accepted: "Approved",
    rejected: "Rejected",
};

function mapDelhiveryTicketStatus(ticketStatus) {
    if (!ticketStatus) return null;

    return DELHIVERY_TICKET_TO_CMS_STATUS[String(ticketStatus).trim().toLowerCase()] || null;
}

// -----------------------------------------------------------------------------
// 🗂️ Status mapping
// -----------------------------------------------------------------------------
// Verified: claim_rejected. Inferred (marked): claim_approved, open, in_review.
// Unknown states map to null and deliberately leave the CMS status untouched
// (mirrors the Flipkart mapping's rationale).
const DELHIVERY_TO_CMS_STATUS = {
    // verified
    claim_rejected: "Rejected",
    // inferred
    claim_approved: "Approved",
    approved: "Approved",
    resolved: "Approved",
    rejected: "Rejected",
    open: "In Review",
    in_review: "In Review",
    pending: "In Review",
    processing: "In Review",
    // seller-blocked variants
    awaiting_response: "Awaiting Seller Response",
    seller_action_required: "Awaiting Seller Response",
};

function mapDelhiveryStatus(delhiveryStatus) {
    if (!delhiveryStatus) return null;
    const key = String(delhiveryStatus).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return DELHIVERY_TO_CMS_STATUS[key] || null;
}

function claimStatusToCmsStatus(delhiveryStatus) {
    return mapDelhiveryStatus(delhiveryStatus) || "Success";
}

module.exports = {
    loginDelhiveryApi,
    searchShipments,
    globalSearchShipments,
    lookupShipmentByAwb,
    findOnCurrentClient,
    shippingModeOf,
    shipmentAmountOf,
    liabilityPreviewAmount,
    findShipmentForAwb,
    assertAwbExists,
    getSupportCategories,
    getPresignedUrls,
    uploadToS3,
    materializeAttachments,
    createTicket,
    subCategoryFor,
    CLAIM_CATEGORY,
    fetchClientTicket, mapDelhiveryTicketStatus, DELHIVERY_TICKET_TO_CMS_STATUS,
    listClientTickets,
    findTicketByAwb,
    findClaimTicketByAwb,
    resolvePublicTicketId,
    isInternalTicketId,
    mapTicketStatus,
    TICKET_STATUSES,
    listLostDamageClaims,
    mapDelhiveryStatus,
    claimStatusToCmsStatus,
    DELHIVERY_TO_CMS_STATUS,
    GATEWAY_HOST,
    apiHeaders,
    httpCall,
};
