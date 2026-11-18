/**
 * Nykaa Dispute Portal — direct-API claim flow (Zoho Desk).
 *
 * Replaces the Puppeteer UI navigation (My Area → Add ticket → fill form →
 * Submit → capture #ticketId) with the JSON API the SPA calls.
 *
 * Auth is HYBRID: Puppeteer bootstraps the Zoho IAM login (see the existing
 * runner's utils.js:loginNykaa — password is client-side encrypted with a
 * public key from /getPayloadEncryptionPublicKey, so we can't POST it from
 * Node), then axios handles every subsequent call. sessionStore caches the
 * cookie jar so subsequent runs skip Puppeteer entirely.
 *
 * Verified end-to-end against ApiDocs/Naykaa auto claim (1).json:
 *
 *   GET  /portal/api/me?portalId=<PORTAL_ID>              (session probe)
 *   GET  /portal/api/departments?portalId=...             (department vocab)
 *   POST /portal/api/tickets?portalId=<PORTAL_ID>         (submit + response has ticketNumber)
 *   GET  /portal/api/tickets?portalId=...&viewId=...&sortBy=recentThread
 *                                                          (list — status readback)
 *   GET  /portal/api/tickets/<id>?portalId=...&include=products (detail)
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
// Shared >= 400 response logging (src/helper/apiResponseLogger.js) — same line shape
// on every claim platform, so one grep finds a failed call anywhere.
const { logApiFailure } = require("../../../../common/apiResponseLogger");
// Required lazily, not at module scope. Trackvid-CMS has no puppeteer: it
// captures its own session in an Electron BrowserWindow and hands the jar in,
// so it must be able to import this flow without the browser installed.
// See CLAUDE.md — "Never assume a consumer has your dependency".

const {
    getUsableSession, saveSession, clearSession, probeSession, cookieHeader, ORIGIN,
    canWrite, resolveCsrfCookie, CSRF_COOKIE_CANDIDATES,
} = require("../../common/sessionStore");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");
const { loadPuppeteer, resolveExecutablePath } = require("../../../../common/browserRuntime.js");
const { isHeadless } = require("../../../../common/headless.js");
const { harvestAllCookies, toJar } = require("../../../../common/cookieHarvest");

const REQ_TIMEOUT_MS = Number(process.env.NAYKAA_API_TIMEOUT_MS || 60000);
const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const dbg = (...a) => {
    if (process.env.NAYKAA_API_DEBUG === "true") console.log("[nykaa-api]", ...a);
};

// Zoho's portalId is on every /portal/api/* call as a query param. It is a
// per-tenant public identifier (not a secret), stable across all Nykaa seller
// accounts. Captured from live traffic; override with NAYKAA_PORTAL_ID.
// Moved to ../../common/portal.js — the session capture needs it too, and two
// copies of a tenant id is how a captured session ends up addressed to a portal
// the claim flow is not talking to. Still exported from here: callers import it
// from this module.
const DEFAULT_PORTAL_ID = require("../../common/portal.js").NYKAA_PORTAL_ID;

// Verified from capture — Nykaa Seller Claims layout inside Dispute Management dept.
const DEFAULT_DEPARTMENT_ID = process.env.NAYKAA_DEPARTMENT_ID || "77727000009728717";
const DEFAULT_LAYOUT_ID = process.env.NAYKAA_LAYOUT_ID || "77727000009743998";

// -----------------------------------------------------------------------------
// 🚦 Rate limiting
// -----------------------------------------------------------------------------
// The portal is Zoho Desk, which enforces a PER-MINUTE call cap and answers an
// over-budget request with HTTP 429 { errorCode: "THRESHOLD_EXCEED" }. Two
// things keep us under it: a minimum spacing between requests (so a loop can
// never burst), and a Retry-After-aware wait when we do get 429'd.
const MIN_REQUEST_INTERVAL_MS = Number(process.env.NAYKAA_API_MIN_INTERVAL_MS || 250);
// ONE retry, deliberately. Each 429 wait is up to a full minute, so four
// retries meant four minutes spent on a single AWB before it was even allowed to
// fail — and the batch behind it stalled the whole time. Since a rate-limited
// AWB is now parked and replayed after the batch (apiScriptNew's deferred pass),
// the second refusal costs nothing: give the window one chance to roll, then
// move on and come back to it later.
const RATE_LIMIT_MAX_RETRIES = Number(process.env.NAYKAA_API_RATE_LIMIT_RETRIES || 1);
// Zoho does not always send Retry-After. The window is a MINUTE, so backing off
// in ~20s steps toward a full minute is the useful shape — retrying in 1s just
// spends another call on the same rejection.
const RATE_LIMIT_FALLBACK_MS = Number(process.env.NAYKAA_API_RATE_LIMIT_WAIT_MS || 20000);
const RATE_LIMIT_MAX_WAIT_MS = 60000;
// Zoho answers a 429 raised near the end of its minute with `Retry-After: 0`.
// Taken literally that is a busy-loop: the retry fires inside the same second,
// is refused again, and two of three retries are spent before the window has
// moved at all. Observed doing exactly that — "waiting 54s" then "waiting 0s"
// twice in the same second, then failing the AWB. Zero means "the window is
// about to roll", so wait for it to actually roll.
const RATE_LIMIT_MIN_WAIT_MS = Number(process.env.NAYKAA_API_RATE_LIMIT_MIN_WAIT_MS || 5000);

// -----------------------------------------------------------------------------
// Proactive per-minute budget
// -----------------------------------------------------------------------------
// MIN_REQUEST_INTERVAL_MS spaces calls but models nothing about a per-MINUTE
// cap: at 250ms apart a batch bursts ~240 calls/min and discovers the ceiling by
// hitting it, which costs a ~60s stall every few AWBs. A sliding 60s window
// paces us under the cap instead of reacting to it.
//
// Zoho does not publish the portal's cap and it is not in any response header,
// so the budget SELF-TUNES: every 429 cuts it, every clean minute earns a little
// back. Whatever the real number is, this converges on it without anyone having
// to guess right.
const RATE_WINDOW_MS = 60_000;
const MAX_PER_MINUTE = Number(process.env.NAYKAA_API_MAX_PER_MINUTE || 50);
const MIN_PER_MINUTE = Number(process.env.NAYKAA_API_MIN_PER_MINUTE || 10);
const BUDGET_CUT_FACTOR = 0.6;   // on a 429
const BUDGET_RECOVER_STEP = 2;   // per clean minute

let budgetPerMinute = MAX_PER_MINUTE;
let requestTimes = [];           // ms timestamps inside the current window
let lastBudgetRecoveryAt = 0;
let lastRateLimitAt = 0;
let okSinceRateLimit = false;

function pruneWindow(now) {
    const cutoff = now - RATE_WINDOW_MS;
    if (requestTimes.length && requestTimes[0] <= cutoff) {
        requestTimes = requestTimes.filter((t) => t > cutoff);
    }
}

// Earn budget back after a quiet minute so one 429 does not throttle the rest of
// a 44-AWB batch forever.
function recoverBudget(now) {
    if (budgetPerMinute >= MAX_PER_MINUTE) return;
    // A minute of ELAPSED time is not a quiet minute. Sitting out a 60s
    // rate-limit wait advances the clock without proving anything, so time-only
    // recovery handed the budget back the instant the wait ended and the very
    // next call cut it again — the "12 → 10" pair repeating per retry.
    //
    // A quiet minute means: a full window since the last 429, AND at least one
    // request actually accepted in the meantime. Waiting is not evidence; a 2xx
    // is.
    if (!okSinceRateLimit) return;
    if (now - lastRateLimitAt <= RATE_WINDOW_MS) return;
    if (!lastBudgetRecoveryAt) { lastBudgetRecoveryAt = now; return; }
    if (now - lastBudgetRecoveryAt <= RATE_WINDOW_MS) return;
    lastBudgetRecoveryAt = now;
    budgetPerMinute = Math.min(MAX_PER_MINUTE, budgetPerMinute + BUDGET_RECOVER_STEP);
    dbg(`rate budget recovered to ${budgetPerMinute}/min`);
}

// Called on every 429: the cap is lower than we thought.
function cutBudget(step) {
    const before = budgetPerMinute;
    lastRateLimitAt = Date.now();
    lastBudgetRecoveryAt = lastRateLimitAt;
    okSinceRateLimit = false;
    budgetPerMinute = Math.max(MIN_PER_MINUTE, Math.floor(budgetPerMinute * BUDGET_CUT_FACTOR));
    if (budgetPerMinute !== before) {
        console.warn(`🚦 [nykaa/API] 429 on "${step}" — lowering budget ${before} → ${budgetPerMinute} calls/min`);
    } else {
        // Already at the floor and STILL refused: the real cap is below it, and
        // silently pacing at an impossible rate would 429 every AWB forever.
        console.warn(
            `🚦 [nykaa/API] 429 on "${step}" at the floor of ${budgetPerMinute} calls/min — ` +
            `lower NAYKAA_API_MIN_PER_MINUTE if this repeats`
        );
    }
}

// Ticket-index paging. Built ONCE per account (see loadTicketIndex) instead of
// once per AWB, so these are affordable in a way the old per-AWB paging was not.
const TICKET_INDEX_PAGES = Number(process.env.NAYKAA_TICKET_INDEX_PAGES || 12);
const TICKET_INDEX_LIMIT = Number(process.env.NAYKAA_TICKET_INDEX_LIMIT || 25);
const TICKET_INDEX_TTL_MS = Number(process.env.NAYKAA_TICKET_INDEX_TTL_MS || 5 * 60 * 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------
// 🧍 Human-paced claim submission
// -----------------------------------------------------------------------------
// Nykaa's bulk-claim ceiling is FOUR TICKETS PER MINUTE. That is a limit on
// claims, not on API calls, so the request-level budget below cannot express it:
// a claim costs a variable number of requests, and staying under N calls/min
// says nothing about how many tickets got filed.
//
// It is also not a burst allowance. Firing four creates back to back and then
// idling 45s is the shape that earns a 429 — and it reads like a script. A human
// filing claims produces a steady trickle with uneven gaps, so that is what this
// emits: one claim roughly every 60/4 = 15s, each gap randomised ±35% so no two
// look alike.
//
// The jitter is SYMMETRIC about the base gap, which matters: the spread makes the
// traffic look organic without changing the mean, so four claims still land in a
// minute rather than drifting to three. A rolling 60s window is enforced on top,
// so a run of short gaps can never push a fifth claim into the same minute.
const CLAIMS_PER_MINUTE = Number(process.env.NAYKAA_CLAIMS_PER_MINUTE || 4);
const CLAIM_WINDOW_MS = 60_000;
// 0 = metronome, 0.35 = gaps anywhere in 9.75s–20.25s at 4/min.
const CLAIM_JITTER = Number(process.env.NAYKAA_CLAIM_JITTER || 0.35);

let claimTimes = [];
let pacerStartedAt = 0;   // anchor for the ideal schedule
let claimIndex = 0;       // how many claims this process has paced

// The arithmetic is shared — this file's pacer adds a rate BUDGET on top of it,
// which is why the budget stays here and the jitter does not. See
// common/humanPace.js.
const { jitter } = require("../../../../common/humanPace");

function baseClaimGapMs() {
    return CLAIM_WINDOW_MS / CLAIMS_PER_MINUTE;   // 15s at 4/min
}

// Exposed for tests / diagnostics — one sample of the randomised gap.
function humanClaimGapMs() {
    return Math.max(0, jitter(baseClaimGapMs(), CLAIM_JITTER));
}

async function paceClaim() {
    if (CLAIMS_PER_MINUTE <= 0) return;

    const base = baseClaimGapMs();
    const now0 = Date.now();
    if (!pacerStartedAt) pacerStartedAt = now0;

    // Anchor each claim to an ABSOLUTE slot rather than to "gap since the last
    // one". Chaining gaps makes jitter accumulate in one direction: a gap the
    // window gate had to stretch becomes the baseline for the next, and the run
    // drifts slower and slower — measured at 3.47/min against a target of 4.
    // Anchoring means a delayed claim is absorbed instead of inherited, so the
    // long-run rate is exactly CLAIMS_PER_MINUTE while individual gaps still vary.
    const idealAt = pacerStartedAt + claimIndex * base;
    // The first claim of a run pays no gap — there is nothing to be spaced from,
    // and a positive jitter here would just stall the batch on the starting line.
    const desiredAt = claimIndex === 0
        ? now0
        : idealAt + Math.round((Math.random() * 2 - 1) * base * CLAIM_JITTER);

    for (; ;) {
        const now = Date.now();
        claimTimes = claimTimes.filter((t) => t > now - CLAIM_WINDOW_MS);

        // Hard guarantee: never a fifth claim inside any rolling 60s, whatever
        // the jitter did.
        if (claimTimes.length >= CLAIMS_PER_MINUTE) {
            // A fixed settle time here would pin every release to the same
            // offset past the 60s boundary, and at 4/min the window gate binds
            // often enough that the whole run collapses onto a repeating 4-gap
            // cycle — regular enough to read as scripted despite the jitter.
            // Randomising the settle keeps the phase moving. The anchored
            // schedule above absorbs it, so the rate stays at 4/min.
            const waitMs = claimTimes[0] + CLAIM_WINDOW_MS - now + jitter(1200, 0.8);
            console.log(
                `⏱️ [nykaa/API] ${claimTimes.length}/${CLAIMS_PER_MINUTE} claims in the last minute — ` +
                `next in ${Math.ceil(waitMs / 1000)}s`
            );
            await sleep(Math.max(waitMs, 250));
            continue;
        }

        const waitMs = desiredAt - now;
        if (waitMs > 0) {
            console.log(`⏱️ [nykaa/API] Pacing next claim in ${(waitMs / 1000).toFixed(1)}s (${CLAIMS_PER_MINUTE}/min)`);
            await sleep(waitMs);
            continue;
        }

        claimIndex += 1;
        claimTimes.push(now);
        return;
    }
}


// Module-scoped: one process talks to one portal, and the cap is per account on
// their side, so spacing every outbound call is the behaviour we want.
let lastRequestAt = 0;
async function throttle() {
    // 1) minimum spacing, so no tight loop can burst. Randomised ±35% for the
    //    same reason the claim pacer is: identical gaps are a fingerprint.
    const gap = lastRequestAt + jitter(MIN_REQUEST_INTERVAL_MS, 0.35) - Date.now();
    if (gap > 0) await sleep(gap);

    // 2) per-minute budget: if the window is full, wait for the oldest call to
    //    age out rather than spending a request on a certain 429.
    for (; ;) {
        const now = Date.now();
        recoverBudget(now);
        pruneWindow(now);
        if (requestTimes.length < budgetPerMinute) break;
        const waitMs = requestTimes[0] + RATE_WINDOW_MS - now + 250;
        console.warn(
            `🚦 [nykaa/API] Per-minute budget reached (${requestTimes.length}/${budgetPerMinute}) — ` +
            `pausing ${Math.ceil(waitMs / 1000)}s`
        );
        await sleep(Math.max(waitMs, 250));
    }

    lastRequestAt = Date.now();
    requestTimes.push(lastRequestAt);
}

// Retry-After may be seconds or an HTTP-date; honour either, fall back to our
// own escalating wait when the header is absent.
function rateLimitWaitMs(res, attempt) {
    const clamp = (ms) =>
        Math.min(Math.max(ms, RATE_LIMIT_MIN_WAIT_MS), RATE_LIMIT_MAX_WAIT_MS);

    const raw = res && res.headers && res.headers["retry-after"];
    if (raw != null && raw !== "") {
        const secs = Number(raw);
        // >= 0, not > 0: a literal 0 is honoured as "very soon", but clamped to
        // RATE_LIMIT_MIN_WAIT_MS so it cannot become a same-second retry.
        if (Number.isFinite(secs) && secs >= 0) return clamp(secs * 1000);
        const when = Date.parse(raw);
        if (!Number.isNaN(when)) return clamp(when - Date.now());
    }
    return clamp(RATE_LIMIT_FALLBACK_MS * attempt);
}

// -----------------------------------------------------------------------------
// 🔐 Login (Puppeteer bootstrap → cookie jar)
// -----------------------------------------------------------------------------
/**
 * Can a session the CALLER handed us stand in for signing in?
 *
 * Trackvid-CMS keeps its own copy of the credential's session and has no
 * database, so `getUsableSession` below — which reads Mongo — always answers
 * null there. Without this the desktop app opened Chrome and signed in for
 * EVERY claim while a perfectly good session sat in its local store.
 *
 * Two checks, and both matter:
 *
 *   1. The CSRF cookie. A jar without it authenticates every read and is
 *      refused on the first write, so reusing one would trade a slow claim for
 *      a claim that 401s after doing all the work. Checked BEFORE the probe,
 *      because the probe is a read and a read cannot tell the difference.
 *   2. The probe. /portal/api/me, the same one the cache path uses.
 *
 * Returns null for "sign in instead", never throws.
 */
async function usableSuppliedSession(session, email) {
    const jar = session && session.jar;

    if (!jar || typeof jar !== "object" || Object.keys(jar).length === 0) return null;

    if (!canWrite(jar)) {
        console.log(
            `↩️ [nykaa/API] Stored session for ${email} carries no CSRF cookie ` +
            `(tried ${CSRF_COOKIE_CANDIDATES.join(", ")}) — it could read but not raise a ticket, ` +
            "so it is not worth reusing. Signing in fresh."
        );
        return null;
    }

    const candidate = {
        jar,
        portalId: session.portalId || DEFAULT_PORTAL_ID,
        userId: session.userId ?? null,
    };

    if (!(await probeSession(candidate))) {
        console.log(`↩️ [nykaa/API] Stored session for ${email} did not pass the probe — signing in fresh.`);
        return null;
    }

    console.log(`♻️ [nykaa/API] Reusing the stored session for ${email} — no sign-in needed.`);

    return { ...candidate, reused: true };
}

/**
 * @param {object} credentials
 * @param {object} [options]
 * @param {boolean} [options.forceFresh] ignore every cached session and sign in
 * @param {{jar: object, portalId?: string, userId?: string}} [options.session]
 *        A session the caller already holds. Used when it can still write; see
 *        `usableSuppliedSession`. A caller that passes nothing behaves exactly
 *        as before.
 * @returns {Promise<{jar: object, portalId: string, userId: string|null, reused?: boolean}>}
 */
async function loginNykaaApi(credentials, { forceFresh = false, session = null } = {}) {
    const email = credentials.username || credentials.email;
    const cacheKey = { credentialId: credentials._id, username: email };
    const started = Date.now();

    if (!forceFresh) {
        const supplied = await usableSuppliedSession(session, email);
        if (supplied) return supplied;

        const cached = await getUsableSession(cacheKey);
        if (cached) return { ...cached, reused: true };
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    // Reuse the existing runner's Zoho iframe login helper — single source
    // of truth (blockers, session-cap popup, sign-in-limit interstitial).
    // Require lazily so this module doesn't launch Chrome on import.
    const { loginNykaa, dismissTerminateSessionsPopup } = require("../common/utils");

    let browser = null;
    let jar = {};
    let portalId = DEFAULT_PORTAL_ID;
    let userId = null;

    try {
        dbg(`🌐 Puppeteer login for ${email}...`);
        browser = await loadPuppeteer().launch({
            headless: isHeadless(),
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1920,1080",
                "--disable-features=PasswordManagerProvisionalAuthentication,PasswordLeakDetection",
            ],
            executablePath: resolveExecutablePath(
                process.env.NODE_ENV === "production" ? "/usr/bin/google-chrome" : undefined
            ),
            defaultViewport: null,
        });
        const page = await browser.newPage();
        await page.setUserAgent(UA);

        await loginNykaa(page, { email, password: credentials.password });
        // Handle the "Terminate all other sessions" popup that may appear
        // right after loginNykaa returns (before we harvest cookies).
        await dismissTerminateSessionsPopup(page).catch(() => { });

        // Take the WHOLE cookie store, not three named hosts.
        //
        // This used to call page.cookies() for dispute.nykaa.com,
        // accounts.zoho.in and desk.zoho.in — a list of guesses. Zoho federates
        // this login across hosts and moves them: land on a host that is not in
        // the list and its cookies are silently absent, which does not look
        // like a failure because every GET still works. Reads are not
        // CSRF-guarded, so the batch indexes hundreds of tickets happily and
        // only the first write comes back 401.
        //
        // Filtered to nykaa/zoho so unrelated cookies in the profile are not
        // sent to the portal, and the portal's own host is applied last so it
        // wins any name collision with an IAM host.
        const harvested = await harvestAllCookies(page, { logger: console });
        jar = toJar(harvested, {
            domains: ["nykaa", "zoho"],
            preferDomains: ["dispute.nykaa.com"],
        });

        dbg(`  ← ${Object.keys(jar).length} cookies from ${harvested.length} in the store: ${Object.keys(jar).join(", ")}`);

        // Say it HERE, at the login that produced the jar, rather than leaving
        // it to surface as a 401 an hour into a batch. The cookie name is
        // env-overridable precisely because Zoho has changed it before, and
        // this line is what tells an operator which name to set.
        const csrf = resolveCsrfCookie(jar);

        if (csrf) {
            console.log(`🔐 [nykaa/API] CSRF cookie resolved as "${csrf.name}" — writes can be signed.`);
        } else {
            console.warn(
                `⚠️ [nykaa/API] No CSRF cookie after login (tried ${CSRF_COOKIE_CANDIDATES.join(", ")}) — ` +
                "writes will be refused with HTTP 401 while reads keep working. Cookies actually present: " +
                `${Object.keys(jar).join(", ") || "none"}. If Zoho uses another name, set the env override.`
            );
        }

        // Discover userId + confirm portalId by hitting /portal/api/me from
        // inside the tab (session cookies stay put).
        try {
            const meResp = await page.evaluate(async (pid) => {
                const r = await fetch(`/portal/api/me?portalId=${encodeURIComponent(pid)}`, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                });
                if (!r.ok) return null;
                return r.json().catch(() => null);
            }, portalId);
            if (meResp) {
                userId = meResp.id || meResp.userId || null;
            }
        } catch (err) {
            dbg(`  /me probe failed (non-fatal): ${err.message}`);
        }
    } finally {
        if (browser) { try { await browser.close(); } catch (_) { /* already gone */ } }
    }

    if (Object.keys(jar).length === 0) {
        const err = new Error("Nykaa login: no cookies after Puppeteer bootstrap");
        err.code = "LOGIN_NO_COOKIES";
        throw err;
    }

    dbg(`✅ Login done in ${Date.now() - started}ms`);
    await saveSession({
        ...cacheKey, jar, portalId, userId,
        source: forceFresh ? "renew-endpoint" : "claim-api",
    });
    // `reused: false` tells a caller that keeps its own sessions — the desktop
    // app — that this one is new and worth storing. Without it every claim
    // signs in again and throws the result away.
    return { jar, portalId, userId, reused: false };
}

// -----------------------------------------------------------------------------
// 🧰 HTTP wrapper
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 🔒 Zoho CSRF
// -----------------------------------------------------------------------------
// Zoho guards STATE-CHANGING portal calls with a double-submit CSRF token: the
// value lives in a cookie, and the same value must be echoed in a header. Reads
// are not guarded.
//
// That asymmetry is exactly the failure this fixes. Cookie-only requests sail
// through every GET — /portal/api/me, the ticket list, ticket detail — and then
// POST /portal/api/tickets answers
//   401 { errorCode: "UNAUTHORIZED", message: "You are not authenticated to perform this operation." }
// which reads like a dead session but is not one. A fresh Puppeteer login
// produced a brand-new jar and the identical 401, because the missing thing was
// never in the jar to begin with.
//
// The header is `X-ZCSRF-TOKEN: <param>=<cookie value>`. Zoho names the param
// after the product; `crmcsrfparam` pairs with the `crmcsr` cookie that Desk
// issues. Both are overridable by env so a live capture can correct them
// without a code change, and a rejected write retries once with the alternate
// spelling (see httpCall) rather than stranding the batch.
// WHICH cookie carries the token is resolved from the jar at call time — see
// sessionStore.resolveCsrfCookie for why one hard-coded name was not enough.
// The PARAM name is separate and need not match it: a successful
// POST /portal/api/tickets sends `crmcsrfparam=<128 hex>`, while the IAM
// sign-in on the same host sends `iamcsrcoo=<uuid>`.
const CSRF_PARAM = process.env.NAYKAA_CSRF_PARAM || "crmcsrfparam";
// Tried only after the primary is refused on a write.
const CSRF_PARAM_ALT = process.env.NAYKAA_CSRF_PARAM_ALT || "deskcsrfparam";

const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

function csrfToken(jar, param = CSRF_PARAM) {
    const csrf = resolveCsrfCookie(jar);
    if (!csrf) return null;
    return `${param}=${csrf.value}`;
}

function apiHeaders(ctx, extra = {}) {
    const headers = {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: ORIGIN,
        Referer: `${ORIGIN}/portal/en/myarea`,
        cookie: cookieHeader(ctx.jar),
    };
    // Harmless on reads, required on writes — so it goes on everything rather
    // than depending on each call site to remember.
    const token = csrfToken(ctx.jar, ctx.csrfParam || CSRF_PARAM);
    if (token) {
        headers["X-ZCSRF-TOKEN"] = token;
        headers["X-Requested-With"] = "XMLHttpRequest";
        // Sent by the portal's own client on every guarded call — captured from
        // a successful POST /portal/api/tickets. Harmless on reads.
        headers["featureFlags"] = "apiName,multiLayout";
    }
    return { ...headers, ...extra };
}

// Is the cookie jar still good? Deliberately a RAW axios call rather than
// httpCall: httpCall calls this on a 401, and routing it back through httpCall
// would recurse.
async function isSessionLive(ctx) {
    try {
        const res = await axios.get(
            `${ORIGIN}/portal/api/me?portalId=${encodeURIComponent(ctx.portalId || DEFAULT_PORTAL_ID)}`,
            {
                headers: {
                    accept: "application/json, text/plain, */*",
                    Referer: `${ORIGIN}/portal/en/myarea`,
                    cookie: cookieHeader(ctx.jar),
                },
                maxRedirects: 0,
                validateStatus: () => true,
                timeout: REQ_TIMEOUT_MS,
            }
        );
        return res.status === 200 && !!res.data && typeof res.data === "object";
    } catch (_) {
        return false;
    }
}


// A write refused while /portal/api/me still answers 200. Calling that
// AUTH_EXPIRED cost a full Puppeteer re-login per batch and then failed the AWB
// anyway — a new cookie jar cannot supply a header we never sent. Tagged
// separately so the runner reports it instead of re-logging in.
function writeRejectedError(step, status, body, sentToken) {
    const err = new Error(
        `${step}: Nykaa refused the write while the session is still live (HTTP ${status}) ` +
        `${String(body || "").slice(0, 200)} ` +
        `[X-ZCSRF-TOKEN ${sentToken ? `sent as ${String(sentToken).split("=")[0]}` : "NOT sent — no CSRF cookie in the jar (tried " + CSRF_COOKIE_CANDIDATES.join(", ") + ")"}]`
    );
    err.code = "NAYKAA_WRITE_REJECTED";
    err.step = step;
    err.status = status;
    err.sentCsrfParam = sentToken ? String(sentToken).split("=")[0] : null;
    return err;
}
function nykaaApiError(step, status, body) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body || "");
    const err = new Error(`${step} failed: HTTP ${status} ${bodyStr.slice(0, 300)}`);
    // RATE_LIMITED is OUR problem, not the claim's. Callers use it to avoid
    // recording a portal-side rate limit as a per-row claim failure.
    err.code = status === 429 ? "RATE_LIMITED" : "NAYKAA_API_ERROR";
    err.step = step;
    err.status = status;
    return err;
}
async function httpCall(ctx, { method = "get", url, data, headers, step }) {
    let triedAltCsrf = false;
    for (let attempt = 1; ; attempt++) {
        await throttle();
        const res = await axios({
            method, url, data,
            headers: apiHeaders(ctx, headers || {}),
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: REQ_TIMEOUT_MS,
        });

        // 429 is transient by definition — the budget refills. Waiting is the
        // only thing that can fix it, so wait rather than surfacing a failure
        // that looks like something is wrong with the claim.
        if (res.status === 429) cutBudget(step);
        if (res.status === 429 && attempt <= RATE_LIMIT_MAX_RETRIES) {
            const waitMs = rateLimitWaitMs(res, attempt);
            console.warn(
                `⏳ [nykaa/API] Rate limited on "${step}" — waiting ${Math.round(waitMs / 1000)}s, ` +
                `then retry ${attempt}/${RATE_LIMIT_MAX_RETRIES}`
            );
            await sleep(waitMs);
            continue;
        }

        if (res.status >= 400) {
            logApiFailure({ platform: "nykaa", step, method, url, status: res.status, data: res.data, logger: ctx && ctx.logger });
        }
        if (res.status === 401 || res.status === 403) {
            const isWrite = WRITE_METHODS.has(String(method).toLowerCase());
            // A refused READ means the jar is dead — the old behaviour, unchanged.
            // A refused WRITE might mean that too, so ask before deciding.
            if (isWrite && (await isSessionLive(ctx))) {
                // Session is alive, so the request itself was rejected. The usual
                // cause is the CSRF param being spelled for a different Zoho
                // product; try the alternate once. Safe to retry: a 401 is
                // refused before processing, so nothing was created.
                const currentParam = ctx.csrfParam || CSRF_PARAM;
                if (!triedAltCsrf && csrfToken(ctx.jar) && currentParam !== CSRF_PARAM_ALT) {
                    triedAltCsrf = true;
                    ctx.csrfParam = CSRF_PARAM_ALT;
                    console.warn(
                        `🔒 [nykaa/API] "${step}" refused with X-ZCSRF-TOKEN ${currentParam}= — ` +
                        `session is live, retrying once as ${CSRF_PARAM_ALT}=`
                    );
                    continue;
                }
                if (triedAltCsrf) {
                    // Put the working spelling back for the next call in this batch.
                    ctx.csrfParam = CSRF_PARAM;
                }
                throw writeRejectedError(step, res.status, JSON.stringify(res.data || ""), csrfToken(ctx.jar, currentParam));
            }
            throw authError(step, res.status, JSON.stringify(res.data || ""));
        }
        if (res.status === 302 || res.status === 301) {
            const loc = res.headers?.location || "";
            if (/signin|login/i.test(loc)) throw authError(step, res.status, `redirect to ${loc}`);
        }
        if (res.status < 200 || res.status >= 300) throw nykaaApiError(step, res.status, res.data);
        // Proof the current pace is survivable — the only thing that earns budget back.
        okSinceRateLimit = true;
        if (triedAltCsrf) {
            console.log(
                `🔒 [nykaa/API] "${step}" accepted with X-ZCSRF-TOKEN ${CSRF_PARAM_ALT}= — ` +
                `set NAYKAA_CSRF_PARAM=${CSRF_PARAM_ALT} to skip the retry on every write`
            );
        }
        return res;
    }
}

// -----------------------------------------------------------------------------
// 👤 Session probe (also used by sessionStore.probeSession)
// -----------------------------------------------------------------------------
async function getMe(ctx) {
    const url = `${ORIGIN}/portal/api/me?portalId=${encodeURIComponent(ctx.portalId || DEFAULT_PORTAL_ID)}`;
    const res = await httpCall(ctx, { method: "get", url, step: "Get me" });
    return res.data;
}

// -----------------------------------------------------------------------------
// 🏷️ Vocabulary — Issue / Return Type dropdown values
// -----------------------------------------------------------------------------
// Nykaa's portal doesn't expose a "list allowed values" endpoint in the
// capture; the Zoho dropdowns are populated by /ticketsFields. Rather than
// coupling to that (large, brittle), we translate CMS labels → portal-exact
// values using a small alias map that mirrors NYKAA_OPTION_ALIASES in
// nykaaAutoClaim/utils.js. Keep the two lists in step.
const NAYKAA_ISSUE_ALIAS = {
    "Damaged / Defective Product Received": "Damaged / Defective Product Receieved",
    "Damaged / Defective Product Recieved": "Damaged / Defective Product Receieved",
};
function resolveIssue(cmsValue) {
    return NAYKAA_ISSUE_ALIAS[cmsValue] || cmsValue;
}

// -----------------------------------------------------------------------------
// ✅ createTicket (the submit)
// -----------------------------------------------------------------------------
/**
 * POST /portal/api/tickets?portalId=<PORTAL_ID>
 *
 * Body verified from the capture:
 *   {
 *     departmentId: "77727000009728717",
 *     layoutId:     "77727000009743998",
 *     subject:      "Wrong Product Returned - Same Brand",
 *     cf: {
 *       cf_vendor_code, cf_sku_id, cf_awb_dto_rto, cf_issue,
 *       cf_return_type, cf_evidence_url
 *     },
 *     description:  "<html-formatted body>"
 *   }
 *
 * Response includes `ticketNumber` directly — that's the "#6721437" the UI
 * shows. No readback round-trip needed.
 */
async function createTicket(ctx, {
    subject, vendorCode, skuId, reverseAwb, issue, returnType,
    description, evidenceUrl,
    departmentId = DEFAULT_DEPARTMENT_ID,
    layoutId = DEFAULT_LAYOUT_ID,
}) {
    assertClaimSubmitEnabled("nykaa", "create ticket");
    // Wait for our slot BEFORE building the request, so the pause sits between
    // claims rather than between a built payload and its send.
    await paceClaim();

    const resolvedIssue = resolveIssue(issue || subject);
    const body = {
        departmentId,
        layoutId,
        subject: subject || resolvedIssue,
        cf: {
            cf_vendor_code: vendorCode || "",
            cf_sku_id: skuId || "",
            cf_awb_dto_rto: reverseAwb || "",
            cf_issue: resolvedIssue,
            cf_return_type: returnType || "",
            cf_evidence_url: evidenceUrl || "",
        },
        description: description || "",
    };
    const res = await httpCall(ctx, {
        method: "post",
        url: `${ORIGIN}/portal/api/tickets?portalId=${encodeURIComponent(ctx.portalId || DEFAULT_PORTAL_ID)}`,
        data: body,
        headers: { "content-type": "application/json" },
        step: "Create ticket",
    });
    const data = res.data || {};
    return {
        ticketNumber: data.ticketNumber ? String(data.ticketNumber) : null,
        internalId: data.id || null,
        status: data.status || "Open",
        raw: data,
    };
}

// -----------------------------------------------------------------------------
// 🎫 Ticket list / detail (for status sync + dedupe)
// -----------------------------------------------------------------------------
async function listTickets(ctx, { from = 1, limit = 25 } = {}) {
    const url =
        `${ORIGIN}/portal/api/tickets?portalId=${encodeURIComponent(ctx.portalId || DEFAULT_PORTAL_ID)}` +
        `&from=${from}&limit=${limit}&include=assignee`;
    const res = await httpCall(ctx, { method: "get", url, step: "List tickets" });
    return res.data?.data || res.data?.tickets || res.data || [];
}

async function getTicketDetail(ctx, internalId) {
    if (!internalId) throw new Error("getTicketDetail: internalId is required");
    const url =
        `${ORIGIN}/portal/api/tickets/${internalId}` +
        `?portalId=${encodeURIComponent(ctx.portalId || DEFAULT_PORTAL_ID)}&include=products`;
    const res = await httpCall(ctx, { method: "get", url, step: "Get ticket detail" });
    return res.data;
}

function awbKey(value) {
    return String(value || "").trim().toLowerCase();
}

/**
 * Build (once per account) a reverseAwb -> ticket index.
 *
 * The list endpoint has NO per-AWB filter — the match on cf.cf_awb_dto_rto
 * happens client-side. So looking a ticket up "by AWB" means downloading the
 * account's ticket list, and doing that per AWB re-downloads the SAME pages
 * once per row: an orphan sweep of 66 rows fired 66 identical requests in ~5
 * seconds and tripped Zoho's per-minute cap on the very first one, which then
 * failed every subsequent probe AND the claim's own dedupe check.
 *
 * Fetching once and answering every lookup from memory turns that back into a
 * handful of requests, and it is the same data either way — the list is
 * account-wide, not per-AWB.
 *
 * Cached on `ctx`, which is per-credential, so accounts never share an index.
 */
async function loadTicketIndex(ctx, { force = false } = {}) {
    const cached = ctx && ctx.__ticketIndex;
    if (!force && cached && Date.now() - cached.builtAt < TICKET_INDEX_TTL_MS) return cached;

    const byAwb = new Map();
    let requests = 0;
    let tickets = 0;
    let truncated = false;

    for (let p = 0; p < TICKET_INDEX_PAGES; p++) {
        const from = 1 + p * TICKET_INDEX_LIMIT;
        const list = await listTickets(ctx, { from, limit: TICKET_INDEX_LIMIT });
        requests++;
        if (!Array.isArray(list) || list.length === 0) break;
        tickets += list.length;
        for (const t of list) {
            const key = awbKey(t && t.cf && t.cf.cf_awb_dto_rto);
            // First occurrence wins: the list is newest-first, so the most
            // recent ticket for an AWB is the one a caller should see.
            if (key && !byAwb.has(key)) byAwb.set(key, t);
        }
        if (list.length < TICKET_INDEX_LIMIT) break;
        if (p === TICKET_INDEX_PAGES - 1) truncated = true;
    }

    const index = { byAwb, builtAt: Date.now(), requests, tickets, truncated };
    if (ctx) ctx.__ticketIndex = index;

    console.log(
        `🗂️ [nykaa/API] Ticket index: ${byAwb.size} AWB(s) from ${tickets} ticket(s) in ${requests} request(s)`
    );
    if (truncated) {
        // Not cosmetic: an AWB whose ticket sits past the cap looks like "no
        // ticket exists", and the caller may then file a SECOND claim for it.
        console.warn(
            `⚠️ [nykaa/API] Ticket index stopped at the ${TICKET_INDEX_PAGES}-page cap — older tickets are NOT indexed, ` +
            `so a claim older than that could be filed twice. Raise NAYKAA_TICKET_INDEX_PAGES.`
        );
    }
    return index;
}

// Find a ticket by the CMS-side reverseAwb — Zoho stores it in cf.cf_awb_dto_rto.
// Served from the per-account index above; the first call builds it.
async function findTicketByReverseAwb(ctx, reverseAwb) {
    if (!reverseAwb) return null;
    const index = await loadTicketIndex(ctx);
    return index.byAwb.get(awbKey(reverseAwb)) || null;
}

/**
 * Find ONE ticket by its number, the way the portal's search box does.
 *
 *   GET /portal/api/tickets/search?portalId=…&searchStr=<number>&from=1&limit=10
 *       &type=Mytickets&sortBy=relevance&departmentId=…
 *   → { data: [{ ticketNumber, id, status, … }], numberOfRecords }
 *
 * One request per ticket, and no page cap: an old claim is found as easily as
 * a new one, which the reverse-AWB index cannot promise.
 *
 * `searchStr` is a full-text search, so a number can also hit a ticket that
 * merely MENTIONS it. Only an exact `ticketNumber` match is returned; anything
 * else is null, and the caller decides what null means.
 *
 * @param {object} ctx            a session from loginNykaaApi
 * @param {string|number} ticketNumber  the visible number, e.g. "7061852"
 * @param {{ departmentId?: string }} [options]
 * @returns {Promise<object|null>}
 */
async function findTicketByNumber(ctx, ticketNumber, { departmentId = DEFAULT_DEPARTMENT_ID } = {}) {
    const wanted = String(ticketNumber || "").trim();
    if (!wanted) return null;

    const url =
        `${ORIGIN}/portal/api/tickets/search?portalId=${encodeURIComponent(ctx.portalId || DEFAULT_PORTAL_ID)}` +
        `&searchStr=${encodeURIComponent(wanted)}&from=1&limit=10&type=Mytickets&sortBy=relevance` +
        `&departmentId=${encodeURIComponent(departmentId)}`;
    const res = await httpCall(ctx, { method: "get", url, step: "Search ticket" });
    const list = Array.isArray(res.data?.data) ? res.data.data : [];

    return list.find((t) => String(t && t.ticketNumber).trim() === wanted) || null;
}

// -----------------------------------------------------------------------------
// 🗂️ Status mapping
// -----------------------------------------------------------------------------
// Nykaa's disputes run on Zoho Desk, and Zoho lets each department name its own
// states: "Open", "In Progress", "Pending", "On Hold", "Resolved", "Closed",
// plus whatever Nykaa adds — an acceptance has been seen as both "Approved" and
// "Accepted", a refusal as both "Rejected" and "Declined". A table of exact
// keys turns every unseen spelling into "no status", so the WORD is matched
// instead and a synonym costs nothing.
//
// ORDER IS THE RULE, not a formality: the first pattern that matches wins, so a
// decision is read before a lifecycle state. "Closed - Rejected" is a refusal
// that happens to be closed, and reading it as CLOSED would file a lost claim
// under "finished".
const NAYKAA_STATUS_PATTERNS = [
    [/\b(reject|declin|deny|denied)/i, "Rejected"],
    [/\b(approv|accept)/i, "Approved"],
    [/\bresolv/i, "Resolved"],
    [/\bclos/i, "Closed"],
    [/\bon hold\b/i, "On Hold"],
    [/\b(in progress|escalat)/i, "In Progress"],
    [/\bpending\b/i, "Pending"],
    // "Reopened" is open again, and neither `\bopen\b` nor `\breopen\b` matches
    // it — the word ends in "ed".
    [/\bre ?opened?\b|\bopen\b/i, "Open"],
    // Zoho's own wording for "the ball is with the seller".
    [/\bawaiting (seller|response)/i, "Awaiting Seller Response"],
];

/**
 * Kept as a map for callers that want to see the mapping at a glance, built
 * from the patterns so the two cannot say different things.
 */
const NAYKAA_TO_CMS_STATUS = Object.fromEntries(
    [
        "Open", "In Progress", "Pending", "On Hold", "Resolved", "Closed",
        "Rejected", "Declined", "Approved", "Accepted", "Escalated",
        "Awaiting Response",
    ].map((status) => [status.toLowerCase(), mapNaykaaStatus(status)])
);

/**
 * Nykaa's ticket status → the CMS status, or null when it says nothing we
 * recognise. Null LEAVES THE ROW ALONE: a status nobody has taught this app is
 * not a reason to overwrite what the row already says.
 */
function mapNaykaaStatus(s) {
    if (!s) return null;

    // `closed_approved`, `on-hold`, `In  Progress` are all the same shapes with
    // different separators, and an underscore is a WORD character — so
    // `\bapprov` never matches `closed_approved` until the underscore is a
    // space. Normalised once here rather than in nine patterns.
    const text = String(s).replace(/[\s_-]+/g, " ").trim();

    if (!text) return null;

    for (const [pattern, status] of NAYKAA_STATUS_PATTERNS) {
        if (pattern.test(text)) return status;
    }

    return null;
}
function claimStatusToCmsStatus(s) { return mapNaykaaStatus(s) || "Success"; }

module.exports = {
    loginNykaaApi,
    getMe,
    createTicket,
    listTickets, getTicketDetail, findTicketByReverseAwb, findTicketByNumber, loadTicketIndex,
    mapNaykaaStatus, claimStatusToCmsStatus, NAYKAA_TO_CMS_STATUS,
    resolveIssue, NAYKAA_ISSUE_ALIAS,
    DEFAULT_PORTAL_ID, DEFAULT_DEPARTMENT_ID, DEFAULT_LAYOUT_ID,
    apiHeaders, httpCall, ORIGIN,
    csrfToken, isSessionLive, resolveCsrfCookie, CSRF_COOKIE_CANDIDATES, CSRF_PARAM, CSRF_PARAM_ALT,
    rateLimitWaitMs, throttle, RATE_LIMIT_MIN_WAIT_MS, RATE_LIMIT_MAX_WAIT_MS,
    paceClaim, humanClaimGapMs, CLAIMS_PER_MINUTE, CLAIM_JITTER,
};
