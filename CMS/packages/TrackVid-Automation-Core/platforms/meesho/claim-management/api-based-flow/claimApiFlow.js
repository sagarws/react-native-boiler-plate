/**
 * Meesho Supplier Panel — direct-API claim flow.
 *
 * Replaces the Puppeteer UI navigation (dashboard → Support → Add ticket →
 * form fill → submit → My Tickets lookup) with the JSON APIs the SPA calls.
 *
 * Auth is HYBRID: Puppeteer bootstraps the cookie jar via the two-step
 * email+password login (Meesho publishes no JSON login endpoint we could hit
 * from Node), then axios handles every subsequent call. sessionStore caches
 * the jar so subsequent runs skip the browser entirely.
 *
 * Verified against ApiDocs/meesho-master-import+cms (1).json — request AND
 * response bodies captured for createTicket, subcategorySchema, and every
 * ticket list/search endpoint.
 *
 * Chronological flow for one claim:
 *
 *   GET  /api/growth/home/password-exists                (session probe)
 *   POST /api/container/supplier/prefetch-supply-data     (supplierId + identifier)
 *   POST /api/experience/support/subcategorySchema       (form vocabulary)
 *   POST /api/experience/support/validateTicketField     (field validation, optional)
 *   POST /api/experience/support/api/v1/upload/supplier-support/input-attachment
 *        (multipart — one per attached file → GCS URL back)
 *   POST /api/experience/support/createTicket            (submit)
 *   POST /api/experience/support/searchTickets           (readback by sub_order_id)
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
// Shared >= 400 response logging (src/helper/apiResponseLogger.js) — same line shape
// on every claim platform, so one grep finds a failed call anywhere.
const { logApiFailure } = require("../../../../common/apiResponseLogger");
const FormData = require("form-data");
// Required lazily, not at module scope. Trackvid-CMS has no puppeteer: it
// captures its own session in an Electron BrowserWindow and hands the jar in,
// so it must be able to import this flow without the browser installed.
// See CLAUDE.md — "Never assume a consumer has your dependency".

const {
    getUsableSession, saveSession, clearSession, cookieHeader, ORIGIN,
} = require("../../common/sessionStore");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");
const { loadPuppeteer, resolveExecutablePath } = require("../../../../common/browserRuntime.js");
const {
    IDENTITY_PAGE_SCRIPT, fetchSupplierIdentity, identifierFromUrl, identityFromCookies,
} = require("../../common/supplierIdentity.js");
const { searchReturns, findReturn } = require("../../common/returnsSearch.js");
const { meeshoId } = require("../../common/identifiers.js");
const { browserIdHeader } = require("../../common/browserId.js");
const { isHeadless } = require("../../../../common/headless.js");

const REQ_TIMEOUT_MS = Number(process.env.MEESHO_API_TIMEOUT_MS || 60000);

/**
 * The browser this process claims to be, and the client hints that must agree
 * with it.
 *
 * ONE PAIR, declared together, because they are one statement: a user-agent
 * saying Chrome 153 beside a `sec-ch-ua` saying 152 is a combination no real
 * browser produces, and looking like no real browser is the thing to avoid on a
 * portal that has started checking. Both are from the 2026-09-19 capture of a
 * claim that was accepted.
 */
const CHROME_MAJOR = process.env.MEESHO_CHROME_MAJOR || "153";
const UA =
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Not_A Brand";v="8", "Chromium";v="${CHROME_MAJOR}"`;

const dbg = (...a) => {
    if (process.env.MEESHO_API_DEBUG === "true") console.log("[meesho-api]", ...a);
};

// -----------------------------------------------------------------------------
// 🔐 Login (Puppeteer bootstrap → cookie jar)
// -----------------------------------------------------------------------------
// Reuses the existing meeshoLogin util (utils.js:meeshoLogin) so login is
// byte-identical between the Puppeteer runner and the API runner. Bootstrap
// launches Chrome once per credential; every subsequent API call is HTTP.
async function loginMeeshoApi(credentials, { forceFresh = false } = {}) {
    const email = credentials.username;
    const cacheKey = { credentialId: credentials._id, username: email };
    const started = Date.now();

    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    // Require lazily so a module that only reads config doesn't launch Chrome.
    //
    // TWO modules, deliberately. `enableStealthMode` and `handleDialog` are
    // browser-level and shared with the master import, so they live in
    // platforms/meesho/common/. `handleAdvertisementPopup` is NOT shared: the
    // claim tree has its own, written against Meesho's older `Modal__…` markup.
    //
    // All three used to be destructured from ../common/utils, which exports
    // only the last one. JavaScript makes that silent — the two became
    // `undefined` and the login died on "enableStealthMode is not a function"
    // at the first page it opened.
    const { enableStealthMode, handleDialog } = require("../../common/browserHelpers");
    const { handleAdvertisementPopup } = require("../common/utils");

    let browser = null;
    let jar = {};
    let supplierId = null;
    let supplierIdentifier = null;

    try {
        dbg(`🌐 Puppeteer login for ${email}...`);
        browser = await loadPuppeteer().launch({
            headless: isHeadless(),
            args: [
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
                "--window-size=1920,1080",
            ],
            executablePath: resolveExecutablePath(
                process.env.NODE_ENV === "production" ? "/usr/bin/google-chrome" : undefined
            ),
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(UA);
        await enableStealthMode(page);
        await handleDialog(page);

        // Meesho's login mirrors what scriptNew.js does — reuse via the
        // exported helper would create a require cycle, so inline the same
        // two-step form here.
        await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle2" });
        await page.waitForSelector("a#loginbutton", { visible: true });
        await page.evaluate(() => document.querySelector("a#loginbutton")?.click());
        await new Promise((r) => setTimeout(r, 3000));
        await page.waitForSelector('input[name="emailOrPhone"]', { visible: true });
        await page.type('input[name="emailOrPhone"]', email, { delay: 50 });
        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', credentials.password, { delay: 50 });
        await page.click('button[type="submit"]');
        await new Promise((r) => setTimeout(r, 5000));

        // Detect login failure — Meesho keeps the user on /login if creds are bad.
        if (page.url().includes("/login")) {
            const errText = await page.evaluate(() => {
                const el = document.querySelector(".error-message, .Mui-error, [class*='error']");
                return el ? (el.innerText || "").trim() : "";
            }).catch(() => "");
            const err = new Error(`LOGIN_FAILED_${errText || "still on login page after submit"}`);
            err.code = "INVALID_CREDENTIALS";
            throw err;
        }
        await handleAdvertisementPopup(page).catch(() => { });

        // Harvest cookies for supplier.meesho.com.
        for (const c of await page.cookies(ORIGIN)) {
            if (c && c.name) jar[c.name] = c.value;
        }
        dbg(`  ← ${Object.keys(jar).length} cookies: ${Object.keys(jar).slice(0, 8).join(", ")}...`);

        // Who is this session? Read with the shared identity script, the same
        // one the desktop app's capture runs — see
        // platforms/meesho/common/supplierIdentity.js. It asks
        // prefetch-supply-data, NOT supplier/config: that response carries no
        // supplier id at all, which is why every stored session used to come
        // back incomplete and cost a second sign-in.
        try {
            const identity = await page.evaluate(`(${IDENTITY_PAGE_SCRIPT})`);
            if (identity && !identity.error) {
                supplierId = identity.supplierId;
                supplierIdentifier = identity.supplierIdentifier;
            } else if (identity && identity.error) {
                dbg(`  supplier identity unavailable (non-fatal): ${identity.error}`);
            }
        } catch (err) {
            dbg(`  supplier identity lookup failed (non-fatal): ${err.message}`);
        }

        // Last resort: the SPA lands on /panel/v3/new/<module>/<slug>/… so the
        // slug is in the URL even when the call above could not be made.
        if (!supplierIdentifier) {
            supplierIdentifier = identifierFromUrl(page.url());
            if (supplierIdentifier) dbg(`  supplier identifier read from the page URL`);
        }
    } finally {
        if (browser) { try { await browser.close(); } catch (_) { /* already gone */ } }
    }

    if (Object.keys(jar).length === 0) {
        const err = new Error("Meesho login: no cookies after Puppeteer bootstrap");
        err.code = "LOGIN_NO_COOKIES";
        throw err;
    }

    dbg(`✅ Login done in ${Date.now() - started}ms`);
    await saveSession({
        ...cacheKey, jar, supplierId, supplierIdentifier,
        source: forceFresh ? "renew-endpoint" : "claim-api",
    });
    return { jar, supplierId, supplierIdentifier };
}

// -----------------------------------------------------------------------------
// 🧰 HTTP wrapper
// -----------------------------------------------------------------------------
// Meesho routes on these, and answers before it ever looks at the session when
// they are missing. Verified against the live endpoint with no cookies:
//   no user-agent                  → 403 "Access Denied" from the CDN edge
//   user-agent, no client-type     → 400 "Bad Request. Invalid client type."
//   user-agent + client-type d-web → 463 "Unauthorized call. Token missing."
// Only the last is Meesho reading the request at all.
//
// `client-package-version` is the SPA's own build number and differs by area:
// the supplier-support APIs send 1.2.3, the fulfillment APIs 1.0.4. Both are
// from the 2026-09-16 capture.
const CLIENT_TYPE = "d-web";
// Overridable, because this is the SPA's build number and it moves: 1.2.3 in
// the 2026-09-16 capture, 1.2.4 in the 2026-09-19 one. Kept current rather than
// frozen — see Error_Case/MeeshoClaim.
const SUPPORT_CLIENT_VERSION = process.env.MEESHO_SUPPORT_CLIENT_VERSION || "1.2.4";
const FULFILLMENT_CLIENT_VERSION = process.env.MEESHO_FULFILLMENT_CLIENT_VERSION || "1.0.4";

/**
 * The headers the supplier panel sends, as closely as this process can.
 *
 * `browser-id` IS SENT NOW, and its absence is the most likely reason claims
 * that had been filing started answering a bare HTTP 500 while the same claim
 * filed by hand went through. It was left out deliberately, as a fingerprint
 * nothing here could honestly supply — but the session already carries it, in
 * the `browser_id` cookie, so forwarding it is not inventing anything. See
 * platforms/meesho/common/browserId.js and Error_Case/MeeshoClaim.
 *
 * The rest of this set is what the browser sends around it. A backend that has
 * started checking one header is a backend worth looking ordinary to.
 */
function apiHeaders(ctx, extra = {}) {
    return {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        "content-type": "application/json",
        "client-type": CLIENT_TYPE,
        "client-package-version": SUPPORT_CLIENT_VERSION,
        ...browserIdHeader(ctx && ctx.jar),
        "sec-ch-ua": SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        priority: "u=1, i",
        // The seller's own short identifier ("e18ek" in the capture). Sent on
        // every panel call; harmless when a session predates its discovery.
        ...(ctx.supplierIdentifier ? { identifier: ctx.supplierIdentifier } : {}),
        cookie: cookieHeader(ctx.jar),
        ...extra,
    };
}


// Meesho wraps a rejected body in its gateway's envelope and buries the useful
// line inside `options.backendData.errors[].defaultMessage`. Pull it out — the
// outer text ("Validation failed for object='…'. Error count: 1") says nothing.
function meeshoErrorDetail(body) {
    if (!body || typeof body !== "object") return null;

    const backend = (body.options && body.options.backendData) || {};
    const errors = Array.isArray(backend.errors) ? backend.errors : [];
    const messages = errors
        .map((e) => e && (e.defaultMessage || e.message))
        .filter((m) => typeof m === "string" && m.trim());

    return messages.length > 0 ? messages.join("; ") : null;
}

function meeshoApiError(step, status, body) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body || "");
    const detail = meeshoErrorDetail(body);
    const err = new Error(
        detail
            ? `${step} failed: HTTP ${status} ${detail}`
            : `${step} failed: HTTP ${status} ${bodyStr.slice(0, 300)}`
    );
    err.code = "MEESHO_API_ERROR";
    err.step = step;
    err.status = status;
    // Kept so a caller can ask what the gateway actually said — an empty
    // `backendData` is a different animal from a refusal with words in it.
    err.body = body;
    return err;
}
/**
 * Fill in supplierId / supplierIdentifier when the session arrived without them.
 *
 * A stored session is cookies plus these two ids. Cookies that still work but
 * no ids used to mean a full browser sign-in — for two numbers the panel will
 * hand over for a cookie. Now it asks over HTTP, once per context, and the
 * sign-in is only for cookies that are genuinely dead.
 *
 * Best effort: a failure here leaves the ids null, the call that follows 403s,
 * and the runner re-logs in exactly as it did before.
 */
async function ensureSupplierIdentity(ctx) {
    if (ctx.supplierId && ctx.supplierIdentifier) return ctx;

    // The session's own cookies name both ids — see identityFromCookies. Free,
    // and the only way out for a session missing its identifier, which the
    // identity endpoint will not answer without.
    const fromCookies = identityFromCookies(ctx.jar);
    if (!ctx.supplierId && fromCookies.supplierId) ctx.supplierId = fromCookies.supplierId;
    if (!ctx.supplierIdentifier && fromCookies.supplierIdentifier) ctx.supplierIdentifier = fromCookies.supplierIdentifier;
    if (ctx.supplierId && ctx.supplierIdentifier) return ctx;

    if (!ctx._identityPromise) {
        // No headers passed: the identity endpoint takes its OWN (client-type
        // `web`, no client-package-version). Sending the panel's set is answered
        // by the edge with 403 "Access Denied" — see supplierIdentity.js.
        ctx._identityPromise = fetchSupplierIdentity(ctx, { timeout: REQ_TIMEOUT_MS })
            .then((identity) => {
                if (identity.supplierId !== null) ctx.supplierId = identity.supplierId;
                if (identity.supplierIdentifier) ctx.supplierIdentifier = identity.supplierIdentifier;
                dbg(`  identity: supplierId=${ctx.supplierId} identifier=${ctx.supplierIdentifier}`);
                return ctx;
            })
            .catch((err) => {
                ctx._identityError = err;
                dbg(`  identity lookup failed: ${err.message}`);
                return ctx;
            });
    }

    return ctx._identityPromise;
}

/**
 * Refuse to call the panel without knowing who we are.
 *
 * Meesho answers a body carrying `supplier_id: ""` with a Spring validation
 * blob — `AssertTrue.supplierTicketValidationRequest.valid`, HTTP 400 — which
 * names nothing an operator can act on and reads like the claim was wrong.
 * The claim was fine; the session had no id. Say THAT instead.
 */
function assertIdentity(ctx, step) {
    if (ctx.supplierId && ctx.supplierIdentifier) return;

    const detail = ctx._identityError ? ` (${ctx._identityError.message})` : "";
    const err = new Error(
        `${step}: this Meesho session has no supplier id — it could not be read from the portal${detail}`
    );
    err.code = "MEESHO_NO_IDENTITY";
    err.step = step;
    throw err;
}

/**
 * The body, with the supplier ids the repair above has just found.
 *
 * EVERY CALLER BUILDS ITS BODY BEFORE CALLING httpCall — `supplier_id:
 * Number(ctx.supplierId || 0)` is evaluated at the call site, while the ids are
 * repaired in here. So a session stored without its numeric id (the capture
 * keeps `supplierIdentifier` but not always `supplierId`) sent `supplier_id: 0`
 * on its FIRST call, and Meesho answered HTTP 204 with nothing in it. A claim
 * never noticed: its first call is the Returns search, which repairs the ids
 * before anything else is built. Opening a ticket starts with fetchTicket, and
 * failed every time (observed 2026-10-30).
 *
 * Only top-level keys the caller already sent, and only when they went out
 * empty: nothing is added to a body that did not ask for it, and a value the
 * caller chose is never replaced.
 */
function withIdentity(data, ctx) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data instanceof FormData === true) return data;

    const patched = { ...data };
    const blank = (value) => value === undefined || value === null || value === "" || value === 0 || value === "0";

    if ("supplier_id" in patched && blank(patched.supplier_id) && ctx.supplierId) {
        // Kept in the caller's own type: some bodies send it as a string.
        patched.supplier_id = typeof data.supplier_id === "string" ? String(ctx.supplierId) : Number(ctx.supplierId);
    }
    if ("supplier_identifier" in patched && blank(patched.supplier_identifier) && ctx.supplierIdentifier) {
        patched.supplier_identifier = ctx.supplierIdentifier;
    }
    if ("identifier" in patched && blank(patched.identifier) && ctx.supplierIdentifier) {
        patched.identifier = ctx.supplierIdentifier;
    }

    return patched;
}

async function httpCall(ctx, { method = "post", url, data, headers, step }) {
    // Every panel call needs the identifier header and most need the numeric id
    // in the body, so this is the one place that guarantees both — and the one
    // place that refuses to call without them.
    await ensureSupplierIdentity(ctx);
    assertIdentity(ctx, step);

    const res = await axios({
        method, url, data: withIdentity(data, ctx),
        headers: apiHeaders(ctx, headers || {}),
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });
    if (res.status >= 400) {
        logApiFailure({ platform: "meesho", step, method, url, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) throw authError(step, res.status, JSON.stringify(res.data || ""));
    if (res.status === 301 || res.status === 302) {
        const loc = res.headers?.location || "";
        if (/login|signin|auth/i.test(loc)) throw authError(step, res.status, `redirect to ${loc}`);
    }
    if (res.status < 200 || res.status >= 300) throw meeshoApiError(step, res.status, res.data);
    return res;
}

// -----------------------------------------------------------------------------
// 🏷️ Form vocabulary — subcategory schema
// -----------------------------------------------------------------------------
/**
 * POST /api/experience/support/subcategorySchema
 * Body: { supplier_id, identifier, sub_category_id: "1", is_pre_tp_enabled: false,
 *         faq_classification_info: { faq_classification_id: "", misc: {} } }
 * Response: schema for the ticket form (fields + accepted values).
 *
 * `sub_category_id` is Meesho's internal id for the claim type. Common ones:
 *   "1" = wrong return / damaged / RTO issue (the "typeOfClaim" bucket in CMS)
 *
 * The CMS-side typeOfClaim → Meesho sub_category_id mapping isn't in the
 * capture; we send sub_category_id="1" by default (matches the observed
 * capture) and log the response so ops can extend the mapping.
 */
async function getSubCategorySchema(ctx, subCategoryId = "1") {
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/experience/support/subcategorySchema`,
        data: {
            supplier_id: Number(ctx.supplierId || 0),
            identifier: ctx.supplierIdentifier || "",
            sub_category_id: String(subCategoryId),
            is_pre_tp_enabled: false,
            faq_classification_info: { faq_classification_id: "", misc: {} },
        },
        step: "Subcategory schema",
    });
    return res.data;
}

// Meesho's category / sub_category ids, as the CMS names the claim.
//
// VERIFIED from the 2026-09-16 capture: a filed ticket comes back from
// searchTickets with supplier_support_sub_category_id 1 under the title "I have
// received wrong return"; fetchSubCategory lists 2 as "Item/s are missing in my
// return"; and the damaged-return form is served at /support/1/3/create.
// Everything else in DefaultClaimsMeesho (BE common.ts) has no confirmed id yet
// and falls back to 1, which is what this did for every type before.
//
// `getSubCategoryList` reads the live list, so a mapping that goes stale can be
// corrected without a release — see resolveSubCategoryIdLive.
const MEESHO_SUBCATEGORY_IDS = {
    "I have received wrong return": "1",
    "Item/s are missing in my return": "2",
    "I have received damaged return": "3",
    // BE's own claim type for the RTO form (DefaultClaimsMeesho,
    // key `wrong_barcoded_package`). An operator who picks it has already said
    // "RTO", so it goes straight to 139 — before this it fell back to "1" and
    // Meesho refused it with "This is an RTO shipment" (2026-11-04).
    "I have received a wrong barcoded package in RTO": "139",
};
function resolveSubCategoryId(typeOfClaim) {
    return MEESHO_SUBCATEGORY_IDS[String(typeOfClaim || "").trim()] || "1";
}

/**
 * The same claim, on an RTO shipment: Meesho files it on a DIFFERENT form.
 *
 * A return-to-origin (the Returns search's `type: "RTO"` — a forward parcel
 * that came back undelivered) is not a customer return, and form 1 ("I have
 * received wrong return") is for customer returns only. Filed there, Meesho
 * looks for a delivered RETURN ORDER, finds none, and refuses with "You can
 * create this ticket only if your return order has been delivered" — on a
 * parcel its own Returns search says is Delivered. Verified 2026-10-30: five
 * Delivered RTOs refused on form 1, and the same kind of claim accepted by
 * hand on form 139.
 *
 * Keyed by the claim type, valued by the RTO form's id and the title Meesho
 * gives it, which the live check below confirms before use.
 */
const MEESHO_RTO_SUBCATEGORIES = {
    "I have received wrong return": { id: "139", title: "I have received a wrong barcoded package in RTO" },
    "I have received a wrong barcoded package in RTO": { id: "139", title: "I have received a wrong barcoded package in RTO" },
};

/**
 * The sub-category whose list holds the RTO forms. `fetchSubCategory` answers
 * the siblings of the id it is asked about, and form 1's siblings are the
 * customer-return forms — so an RTO form's title is looked for here too.
 */
const MEESHO_RTO_LIST_ANCHOR = "139";

/** The RTO form for a CMS claim type, or null when the type has none. */
function rtoSubCategoryFor(typeOfClaim) {
    return MEESHO_RTO_SUBCATEGORIES[String(typeOfClaim || "").trim()] || null;
}

/** Whether a sub-category id is one of the RTO forms above. */
function isRtoSubCategory(subCategoryId) {
    const id = String(subCategoryId || "");

    return Object.values(MEESHO_RTO_SUBCATEGORIES).some((form) => form.id === id);
}

/**
 * POST /api/experience/support/fetchSubCategory — every sub-category under this
 * category, with its id, title and TAT.
 *
 * The TAT here is the SUPPORT tat (hours until an agent replies, 168 in the
 * capture), not the claim window. The claim window is prose in `description`
 * ("…claim the dispute within 7 days of return delivery") and is enforced by
 * createTicket.
 *
 * @returns {Promise<import("./meeshoApiTypes").MeeshoSubCategory[]>}
 */
async function getSubCategoryList(ctx, { subCategoryId = "1" } = {}) {
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/experience/support/fetchSubCategory`,
        data: {
            supplier_id: Number(ctx.supplierId || 0),
            identifier: ctx.supplierIdentifier || "",
            sub_category_id: String(subCategoryId),
            is_pre_tp_enabled: false,
        },
        step: "Sub-category list",
    });
    const list = (res.data && res.data.sub_categories) || [];
    return Array.isArray(list) ? list.filter(Boolean) : [];
}

/**
 * The sub-category id for a CMS claim type, asking Meesho rather than trusting
 * the table above. Falls back to the table (and then to "1") whenever the live
 * list cannot be read or holds no matching title, so a lookup failure never
 * stops a claim.
 */
async function resolveSubCategoryIdLive(ctx, typeOfClaim, { shipmentType = null } = {}) {
    const wanted = String(typeOfClaim || "").trim().toLowerCase();
    if (!wanted) return resolveSubCategoryId(typeOfClaim);

    // An RTO shipment goes on the claim type's RTO form, when it has one. Asked
    // of Meesho by id so a renumbered form is noticed; the id is still used when
    // the check cannot be made, because form 1 is known to refuse every RTO.
    const rto = String(shipmentType || "").trim().toUpperCase() === "RTO"
        ? MEESHO_RTO_SUBCATEGORIES[String(typeOfClaim || "").trim()]
        : null;

    if (rto) {
        try {
            const list = await getSubCategoryList(ctx, { subCategoryId: rto.id });
            const hit = list.find((s) => String(s.sub_category_id) === rto.id);

            if (hit && !/\bRTO\b/i.test(String(hit.sub_category_title || ""))) {
                dbg(`  form ${rto.id} is now "${hit.sub_category_title}", not an RTO form — using it anyway`);
            }
        } catch (err) {
            dbg(`  RTO form ${rto.id} could not be checked (${err.message}) — using it`);
        }
        return rto.id;
    }

    /*
     * Form 1's list first (as before), then the RTO forms' list — so a claim
     * type that IS an RTO form ("I have received an RTO in a non-barcoded
     * package") is found by its title even though the static map has no id for
     * it. A type found in the first list never reaches the second request.
     */
    for (const anchor of ["1", MEESHO_RTO_LIST_ANCHOR]) {
        try {
            const list = await getSubCategoryList(ctx, { subCategoryId: anchor });
            const hit = list.find(
                (s) => String(s.sub_category_title || "").trim().toLowerCase() === wanted
            );
            if (hit && (hit.sub_category_id || hit.sub_category_id === 0)) {
                return String(hit.sub_category_id);
            }
        } catch (err) {
            dbg(`  sub-category list ${anchor} failed (${err.message})`);
        }
    }
    dbg(`  no live sub-category titled "${typeOfClaim}" — using the static map`);
    return resolveSubCategoryId(typeOfClaim);
}

// -----------------------------------------------------------------------------
// 🌐 Global AWB search — is this return on this account?
// -----------------------------------------------------------------------------
/**
 * POST /api/fulfillment/returnRto/fetchReturnClaims — the Returns page's own
 * search box, filtered to the returns tab. The session IS the account, so a
 * return that comes back here is on this login and one that does not is not.
 *
 * Note this endpoint is in the fulfillment area, which runs its own SPA build —
 * hence the different client-package-version.
 *
 * ASKED BY AWB, THEN BY SUB-ORDER NUMBER. A CMS row's AWB can be stale — a
 * re-booked return gets a new waybill, a scanned row can carry the forward leg's
 * — and the search then answers empty, which reads as "not on this account" and
 * fails the claim. The sub-order number is the identifier Meesho keys on and it
 * does not change, so it is the second question. See `findReturn`.
 *
 * `matchedBy` names which identifier answered, and the row's `awb` is Meesho's
 * current waybill — the caller should file with THAT, not with what it asked.
 *
 * @returns {Promise<{ found: boolean, matchedBy: string|null, tried: string[],
 *                     returns: import("./meeshoApiTypes").AccountReturn[] }>}
 */
async function searchReturnClaims(ctx, awbNumber, { pageSize = 50, subOrderNumber = null, orderNumber = null, logger = null } = {}) {
    if (!awbNumber && !subOrderNumber && !orderNumber) {
        throw new Error("searchReturnClaims: an awb or a sub-order number is required");
    }

    // ONE implementation, shared with the account-mapping probe — see
    // platforms/meesho/common/returnsSearch.js for why that matters, and for
    // why the sub-order number is asked SECOND rather than not at all.
    const { found, row, raw, matchedBy, tried } = await findReturn(
        ctx,
        { awb: awbNumber, subOrderNumber, orderNumber },
        { pageSize, step: "Global AWB search", logger: logger || (ctx && ctx.logger) }
    );

    if (!found || !row) return { found: false, returns: [], matchedBy: null, tried };

    return {
        found: true,
        matchedBy,
        tried,
        returns: [
            {
                // Meesho's OWN waybill for this return, which is not always the
                // one the CMS row was carrying — see `matchedBy`.
                awb: row.awbNumber,
                orderNumber: row.orderNumber,
                subOrderNumber: row.subOrderNumber,
                subOrderIdentifier: (raw && raw.sub_order_identifier) || null,
                type: row.returnType,
                subType: (raw && raw.sub_type) || null,
                shipmentStatus: row.status,
                createdDate: (raw && raw.created_date_iso) || null,
                deliveredDate: (raw && raw.delivered_date_iso) || null,
                carrierName: row.carrier,
                returnReason: (raw && raw.return_reason_details && raw.return_reason_details.return_reason) || null,
                detailedReason: (raw && raw.return_reason_details && raw.return_reason_details.detailed_reason) || null,
                product: (raw && raw.product) || null,
                raw,
            },
        ],
    };
}

// -----------------------------------------------------------------------------
// ⏳ validateTicketField — Meesho's own answer on whether a claim is still open
// -----------------------------------------------------------------------------
// The form calls this as the operator types, and it is where the claim window
// shows up: "The dispute can only be claimed within 7 days of return delivery".
//
// NOT part of filing. createTicket enforces the same rule itself, and asking
// twice would double the calls a batch makes. It exists for the TAT check an
// operator runs over selected claims — see MEESHO_API.md.
const TAT_ERROR_PATTERNS = [
    /within\s+\d+\s+days?/i,
    /\bTAT\b/i,
    /claim(ed)?\s+(window|period)/i,
    /too\s+late/i,
    /expired/i,
];

/**
 * @returns {Promise<import("./meeshoApiTypes").TicketFieldValidation>}
 */
async function validateTicketField(ctx, {
    subOrderNumber, awbNumber, categoryId = "1", subCategoryId = "1",
}) {
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/experience/support/validateTicketField`,
        data: {
            supplier_id: String(ctx.supplierId || ""),
            category_id: String(categoryId),
            sub_category_id: String(subCategoryId),
            ticket_details: [
                { key: "sub_order_number", type: "action_single_text_box", label: "Sub Order Number", value: meeshoId(subOrderNumber) },
                { key: "awb_number", type: "action_single_text_box", label: "AWB Number", value: meeshoId(awbNumber) },
            ],
            supplier_identifier: ctx.supplierIdentifier || "",
        },
        headers: {
            "content-type": "application/json;charset=UTF-8",
            Referer: `${ORIGIN}/panel/v3/new/experience/${ctx.supplierIdentifier || ""}/support/${categoryId}/${subCategoryId}/create`,
        },
        step: "Validate ticket field",
    });

    const body = res.data || {};
    const errors = Array.isArray(body.errors) ? body.errors.filter(Boolean) : [];

    return {
        isValid: body.is_valid === true,
        errors: errors.map((e) => ({
            message: String(e.error_message || ""),
            field: e.field_name || null,
        })),
        raw: body,
    };
}

/**
 * Ask about the SUB-ORDER NUMBER on its own.
 *
 * The same endpoint, with only that field in `ticket_details` — which is what
 * the panel sends while somebody is still typing, before an AWB exists. It
 * matters because the two questions do not always give the same answer: a form
 * carrying both fields can come back valid, or refused for the window, while
 * the number by itself is one Meesho does not recognise at all. That is the
 * case behind a `createTicket` that answers 500 with nothing in it.
 *
 * Verified 2026-09-18 against a claim whose number was wrong:
 *   → { is_valid: false, errors: [{ field_name: "sub_order_number",
 *       error_message: "Please enter a valid sub order number." }] }
 *
 * @returns {Promise<import("./meeshoApiTypes").TicketFieldValidation>}
 */
async function validateSubOrderNumber(ctx, {
    subOrderNumber, categoryId = "1", subCategoryId = "1",
}) {
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/experience/support/validateTicketField`,
        data: {
            supplier_id: String(ctx.supplierId || ""),
            category_id: String(categoryId),
            sub_category_id: String(subCategoryId),
            ticket_details: [
                { key: "sub_order_number", type: "action_single_text_box", label: "Sub Order Number", value: meeshoId(subOrderNumber) },
            ],
            supplier_identifier: ctx.supplierIdentifier || "",
        },
        headers: {
            "content-type": "application/json;charset=UTF-8",
            Referer: `${ORIGIN}/panel/v3/new/experience/${ctx.supplierIdentifier || ""}/support/${categoryId}/${subCategoryId}/create`,
        },
        step: "Validate sub-order number",
    });

    const body = res.data || {};
    const errors = Array.isArray(body.errors) ? body.errors.filter(Boolean) : [];

    return {
        isValid: body.is_valid === true,
        errors: errors.map((e) => ({
            message: String(e.error_message || ""),
            field: e.field_name || null,
        })),
        raw: body,
    };
}

/** Meesho's wording for a number it does not know. */
const INVALID_SUB_ORDER_RE = /valid\s+sub[\s-]?order\s+number/i;

/**
 * Does this validation say the sub-order number itself is wrong?
 *
 * As narrow as `tatVerdict`, and for the same reason: everything else Meesho
 * can refuse is a different problem, and filing it under a code that points at
 * the sub-order number sends somebody to correct a number that was right.
 *
 * @param {import("./meeshoApiTypes").TicketFieldValidation} validation
 * @returns {{ invalid: boolean, message: string|null }}
 */
function subOrderVerdict(validation) {
    if (!validation || validation.isValid) return { invalid: false, message: null };

    const hit = (validation.errors || []).find(
        (e) => INVALID_SUB_ORDER_RE.test(e.message || "") ||
            (e.field === "sub_order_number" && /invalid|not\s+found/i.test(e.message || ""))
    );

    return hit ? { invalid: true, message: hit.message } : { invalid: false, message: null };
}

/**
 * Does this validation say the claim window has closed?
 *
 * Deliberately narrow: only a message that talks about a window, a day count or
 * an expiry counts. Every other validation failure (a wrong AWB, a sub-order
 * that is not this seller's) is a different problem and must not be filed away
 * as "TAT Expired".
 *
 * @param {import("./meeshoApiTypes").TicketFieldValidation} validation
 * @returns {{ expired: boolean, message: string|null }}
 */
function tatVerdict(validation) {
    if (!validation || validation.isValid) return { expired: false, message: null };

    const hit = (validation.errors || []).find((e) =>
        TAT_ERROR_PATTERNS.some((re) => re.test(e.message || ""))
    );

    return hit ? { expired: true, message: hit.message } : { expired: false, message: null };
}

// -----------------------------------------------------------------------------
// 📎 Attachment upload (multipart → GCS URL)
// -----------------------------------------------------------------------------
/**
 * POST /api/experience/support/api/v1/upload/supplier-support/input-attachment
 * Multipart → { url, is_valid, errors } where `url` is a GCS link of the form
 *   https://gcs-supl-…/TicketInputAttachments/<supplierId>/<epochMs>/<filename>
 *
 * FOUR form fields, not one. Verified from a capture that recorded the
 * multipart body (2026-09-16, a claim filed by hand):
 *
 *   { entity_id: "4645181", entity_type: "SUPPLIER",
 *     file: <the file>, is_validation_required: "false" }
 *
 * The earlier capture dropped multipart bodies entirely, which is why this
 * shipped with the file alone and every claim died on its first attachment:
 *   400 {"error":"Required SupportEntityType parameter 'entity_type' is not present"}
 * `entity_id` is the supplier id, so the upload is addressed as explicitly as
 * every other call. Override the two names with MEESHO_UPLOAD_FIELD and
 * MEESHO_UPLOAD_ENTITY_TYPE if Meesho renames them.
 */
/**
 * What to add to an upload refusal, so the sentence names something actionable.
 *
 * A rejected FORM FIELD is fixable without a release, which is why the hint
 * exists — but only when the field is what Meesho objected to. The test used to
 * be /file|multipart|part/, and "File too large. Maximum size: 25MB" contains
 * the word "File". So a size refusal came back as
 *
 *     HTTP 400 File too large. Maximum size: 25MB
 *     — set MEESHO_UPLOAD_FIELD (currently "file")
 *
 * pointing an operator at a form field that was never wrong, about a video that
 * was several megabytes over. A hint that fires on the wrong failure is worse
 * than no hint: it is a wrong answer in the place the right one belongs.
 *
 * So the refusals Meesho states plainly are recognised first, and a size
 * refusal answers the question its own message leaves open — how big was the
 * file we sent? Meesho names only its limit.
 *
 * Pure and exported for tests: the regexes are the whole behaviour.
 *
 * @returns {{hint: string, tooLarge: boolean}}
 */
function uploadFailureHint({ detail, sentBytes = 0, field = "file", entityType = "SUPPLIER" }) {
    const text = String(detail || "");
    const tooLarge = /too large|file size|maximum size|LIMIT_FILE_SIZE/i.test(text);

    if (tooLarge) {
        // Millions, matching how Meesho states its own limit and how
        // common/videoCompress prints every size beside it.
        return { hint: sentBytes ? ` — sent ${(sentBytes / 1_000_000).toFixed(1)}MB` : "", tooLarge };
    }

    if (/entity_type|SupportEntityType/i.test(text)) {
        return { hint: ` — set MEESHO_UPLOAD_ENTITY_TYPE (currently "${entityType}")`, tooLarge };
    }

    // Multer's own vocabulary for "the field name is not the one I expect".
    if (/unexpected field|unknown field|LIMIT_UNEXPECTED_FILE|no file (was )?(uploaded|provided)|missing file/i.test(text)) {
        return { hint: ` — set MEESHO_UPLOAD_FIELD (currently "${field}")`, tooLarge };
    }

    // Anything else — a rejected type, a plain 500 — says enough on its own.
    return { hint: "", tooLarge };
}

async function uploadAttachment(ctx, filePath) {
    if (!filePath || !(await fs.pathExists(filePath))) {
        throw new Error(`uploadAttachment: file not found: ${filePath}`);
    }
    // Own request, so it does not pass through httpCall's identity guard.
    await ensureSupplierIdentity(ctx);
    assertIdentity(ctx, "Attachment upload");

    const field = process.env.MEESHO_UPLOAD_FIELD || "file";
    const entityType = process.env.MEESHO_UPLOAD_ENTITY_TYPE || "SUPPLIER";
    const fileName = path.basename(filePath);
    // How big the thing we are sending is. Meesho's size refusal names its own
    // limit and not what it received, so without this the log said a file was
    // too large and never said how large.
    const sentBytes = (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
    const form = new FormData();
    form.append(field, fs.createReadStream(filePath), { filename: fileName });
    form.append("entity_type", entityType);
    // Who the attachment belongs to. `ensureSupplierIdentity` above guarantees
    // it is known, so this is never the empty string.
    form.append("entity_id", String(ctx.supplierId));
    // The portal sends "false" here — the ticket form validates the file
    // itself. Sending nothing at all is what a missing-parameter 400 is made of.
    form.append("is_validation_required", "false");

    const res = await axios.post(
        `${ORIGIN}/api/experience/support/api/v1/upload/supplier-support/input-attachment`,
        form,
        {
            headers: {
                ...form.getHeaders(),
                "user-agent": UA,
                accept: "application/json, text/plain, */*",
                // The page the portal uploads from. Meesho's edge reads it.
                Referer: `${ORIGIN}/panel/v3/new/experience/${ctx.supplierIdentifier || ""}/support`,
                origin: ORIGIN,
                // Same routing headers as every other panel call — this request
                // builds its own headers, so it does not get them from apiHeaders.
                "client-type": CLIENT_TYPE,
                "client-package-version": SUPPORT_CLIENT_VERSION,
                ...browserIdHeader(ctx && ctx.jar),
                "sec-ch-ua": SEC_CH_UA,
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"macOS"',
                ...(ctx.supplierIdentifier ? { identifier: ctx.supplierIdentifier } : {}),
                cookie: cookieHeader(ctx.jar),
            },
            maxBodyLength: Infinity, maxContentLength: Infinity,
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: REQ_TIMEOUT_MS * 5,
        }
    );
    // Own request, so it does not pass through httpCall — log it here too.
    if (res.status >= 400) {
        logApiFailure({ platform: "meesho", step: `Attachment upload (${fileName})`, method: "POST", url: `${ORIGIN}/api/experience/support/api/v1/upload/supplier-support/input-attachment`, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) {
        throw authError("Attachment upload", res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        const detail = String(
            meeshoErrorDetail(res.data) ||
                (res.data && res.data.error) ||
                JSON.stringify(res.data || "").slice(0, 300)
        );

        /**
         * A rejected FORM FIELD is fixable without a release, so say which knob
         * — but only when the field is actually what Meesho objected to.
         *
         * The test used to be /file|multipart|part/, which matches the word
         * "File" in "File too large. Maximum size: 25MB". So a size refusal
         * came back as "set MEESHO_UPLOAD_FIELD (currently "file")", pointing
         * an operator at a form field that was never wrong, for a video that
         * was 5MB over. A hint that fires on the wrong failure is worse than no
         * hint: it is a wrong answer in the place the right one belongs.
         *
         * So the refusals Meesho states plainly are recognised first, and each
         * says the thing that can actually be acted on.
         */
        const saysSize = /too large|file size|maximum size|LIMIT_FILE_SIZE/i.test(detail);
        const saysType = /file type|extension|mime|unsupported media/i.test(detail);
        const saysEntity = /entity_type|SupportEntityType/i.test(detail);
        // Multer's own vocabulary for "the field name is not the one I expect".
        const saysField = /unexpected field|unknown field|LIMIT_UNEXPECTED_FILE|no file (was )?(uploaded|provided)|missing file/i.test(detail);

        const hint = saysSize
            // Millions, matching how Meesho states its own limit and how
            // videoCompress prints every size beside it.
            ? ` — sent ${(sentBytes / 1_000_000).toFixed(1)}MB`
            : saysEntity
                ? ` — set MEESHO_UPLOAD_ENTITY_TYPE (currently "${entityType}")`
                : saysField
                    ? ` — set MEESHO_UPLOAD_FIELD (currently "${field}")`
                    : saysType
                        ? ""
                        : "";

        const err = new Error(`Attachment upload failed (${fileName}): HTTP ${res.status} ${detail}${hint}`);

        // Carried so a caller can tell a size refusal from anything else
        // without reading the sentence back.
        if (saysSize) err.code = "UPLOAD_TOO_LARGE";
        err.status = res.status;
        throw err;
    }
    // The upload answers with the same {is_valid, errors} envelope the ticket
    // calls use — a rejected file is a 200 too.
    if (res.data && res.data.is_valid === false) {
        const why = (Array.isArray(res.data.errors) ? res.data.errors : [])
            .map((e) => (e && (e.error_message || e.message)) || "")
            .filter(Boolean)
            .join("; ");
        throw new Error(`Attachment upload rejected (${fileName})${why ? `: ${why}` : ""}`);
    }
    const url = extractUploadedUrl(res.data);
    if (!url) throw new Error(`Attachment upload returned no URL for ${fileName}: ${JSON.stringify(res.data || "").slice(0, 300)}`);
    dbg(`  📎 uploaded ${fileName} → ${url.slice(0, 80)}...`);
    return url;
}
function extractUploadedUrl(body) {
    if (!body) return null;
    if (typeof body === "string" && body.startsWith("http")) return body;
    return body.url || body.imageUrl || body.videoUrl || body.fileUrl || body.location ||
           body.data?.url || body.data?.imageUrl || body.data?.videoUrl ||
           (Array.isArray(body.urls) && body.urls[0]) || null;
}

// -----------------------------------------------------------------------------
// ✅ createTicket (the submit)
// -----------------------------------------------------------------------------
/**
 * Verified from the capture. Body shape:
 *   {
 *     category_id: "1", sub_category_id: "1",
 *     supplier_id, supplier_identifier, supplier_email_id,
 *     ticket_details: [ {key, type, label, value, selectedLabel?}, ... ],
 *     faq_classification_info: {...}
 *   }
 * ticket_details keys observed:
 *   sub_order_number, awb_number, packet_state (drop_down),
 *   barcode_id, barcode_image_link, product_image_link,
 *   product_reverse_way_bill_link, product_openingvideo_link,
 *   ticket_desc, attachments, callback_number
 *
 * THE RESPONSE IS NOT A STATUS CODE. Verified from the 2026-09-16 capture: a
 * refused claim answers HTTP 200 with
 *   { ticket_id: null, is_valid: false,
 *     errors: [{ field_name: "awb_number",
 *                error_message: "The dispute can only be claimed within 7 days
 *                                of return delivery" }] }
 * — the same shape validateTicketField uses. Reading only the status treats
 * that as a filed claim, and the ticket readback then finds nothing, which
 * reports "verify manually" for a claim Meesho openly refused. So the body is
 * checked here and the refusal is thrown with Meesho's own words.
 *
 * A successful submit returns `ticket_id` (a 12-digit number), so the readback
 * through /searchTickets is a fallback rather than the only route.
 */
// The claim window, as Meesho words it. Tagged so a runner can tell "this can
// never be filed" from "this failed today" — the row is finished either way,
// but only one of them is worth retrying.
const TAT_MESSAGE_RE = /within\s+\d+\s+days?|claim(ed)?\s+(window|period)|\bTAT\b|expired/i;

/**
 * The return has not reached the seller yet.
 *
 * Meesho: "You can create this ticket only if your return order has been
 * delivered. Please collect your return delivery and then create this ticket.
 * If you have already collected your return, please try again in 1 hour."
 *
 * NARROW ON PURPOSE, like every other classifier here. It must not catch a
 * closed window — which also talks about return DELIVERY ("within 7 days of
 * return delivery") — so it keys on the thing only this refusal says: that the
 * order has NOT been delivered, or that the seller should collect it first.
 * Reading a closed window as "not delivered yet" would leave a dead claim
 * being retried for ever.
 */
const NOT_DELIVERED_RE =
    /only if your return order has been delivered|collect your return delivery|return (order |is )?not (yet )?delivered/i;

/**
 * Meesho's wording for a Packet ID it will not take.
 *
 * Deliberately just the FIELD NAME. Meesho has more than one sentence about
 * this box — the long "you are filling the AWB number in the Packet ID field"
 * one, and shorter complaints about the value — and every one of them is the
 * same fact for the same person to fix. Matching the sentence would classify
 * today's wording and drop the next.
 *
 * Narrow enough to be safe: no other refusal this flow has seen mentions the
 * packet id at all, and the branch that uses it runs after the ones that name
 * a return, a sub-order number or an existing ticket.
 */
const INVALID_PACKET_ID_RE = /packet\s*id/i;

/**
 * The reverse AWB on the row is not this sub-order's reverse AWB.
 *
 * Meesho's words: "This AWB number doesn't match the return shipment for the
 * sub order. Please enter the correct reverse AWB." It reached the column as
 * `CLAIM_REFUSED: This AWB number doesn't match…`, wrapping over the row behind
 * a machine tag — the same generic bucket every unread refusal lands in.
 *
 * ME3, the code this system already uses for "the AWB is wrong": `fileClaim`
 * raises it when a sweep finds the number on no account at all. Same fact,
 * reached from the other end — there the AWB matches nothing, here it matches
 * something that is not this sub-order — and one code for it keeps the two
 * queues together.
 *
 * BOTH HALVES OF THE SENTENCE are matched, so a rewording of either still
 * lands: the complaint ("doesn't match") and the instruction ("correct reverse
 * AWB"). Narrow enough to be safe — no other refusal seen here mentions an AWB
 * not matching.
 */
const AWB_MISMATCH_RE = /awb\s+number\s+does(?:n['\u2019]?t|\s+not)\s+match|correct\s+reverse\s+awb/i;

/**
 * The claim was filed on a customer-return form, and Meesho says the parcel is
 * an RTO.
 *
 * Meesho's words (2026-11-04, three claims on one account): "This is an RTO
 * shipment. Please select the correct FAQ to raise a claim on an RTO shipment:
 * "I have received a wrong barcoded package in RTO" or "I have received an RTO
 * in a non-barcoded package"." The same claims were accepted by hand on form
 * 139.
 *
 * `resolveSubCategoryIdLive` already routes an RTO to its form \u2014 but only when
 * the Returns search said `type: "RTO"`. When the search did not (not found,
 * or answered without a type), the claim went on form 1 and died here. This
 * refusal is Meesho telling us the type itself, so `fileMeeshoClaim` refiles
 * on the RTO form instead of reporting it.
 */
const RTO_SHIPMENT_RE = /this\s+is\s+an\s+rto\s+shipment|claim\s+on\s+an\s+rto\s+shipment/i;

function createTicketError(body) {
    const errors = Array.isArray(body && body.errors) ? body.errors.filter(Boolean) : [];
    const message = errors.map((e) => e.error_message).filter(Boolean).join("; ") ||
        "Meesho refused the ticket without saying why";

    /*
     * FIRST, because the answer is to refile, not to report. The column text is
     * left exactly as it was (`CLAIM_REFUSED: \u2026`) for the case nothing can be
     * refiled \u2014 a claim type with no RTO form \u2014 so only the code is new.
     */
    if (RTO_SHIPMENT_RE.test(message)) {
        const rto = new Error(`CLAIM_REFUSED: ${message}`);

        rto.code = "MEESHO_RTO_SHIPMENT";
        rto.detail = message;
        rto.fields = errors.map((e) => e.field_name).filter(Boolean);

        return rto;
    }

    /*
     * CHECKED BEFORE THE WINDOW, because Meesho's wording overlaps.
     *
     * "...only if your return order has been delivered" contains "delivered",
     * and a closed window is worded "within 7 days of return delivery" — so
     * whichever is tested first wins the ones that read like both. This one is
     * the narrower claim (it names a return that has NOT arrived), and getting
     * it the wrong way round writes off a claim that only needed waiting.
     */
    if (NOT_DELIVERED_RE.test(message)) {
        // The CODE is the whole message: it is what an operator reads in a
        // narrow column, and Meesho's three sentences wrapped over the row and
        // said nothing at a glance. Their words ride on `.detail`, for the log.
        const waiting = new Error(MEESHO_RETURN_NOT_DELIVERED);

        waiting.code = "MEESHO_RETURN_NOT_DELIVERED";
        waiting.detail = message;
        waiting.fields = errors.map((e) => e.field_name).filter(Boolean);

        return waiting;
    }

    /*
     * THE REVERSE AWB — ME3, and a row one person can fix.
     *
     * CHECKED BEFORE THE SUB-ORDER BRANCH even though `INVALID_SUB_ORDER_RE`
     * does not match this today. Meesho's sentence names the sub-order ("…for
     * the sub order"), so the day that pattern is loosened by a word it would
     * take this message too — and the claim would be refiled with a different
     * sub-order number, which is not what is wrong with it. Order is the guard.
     */
    if (AWB_MISMATCH_RE.test(message)) {
        const awb = new Error(MEESHO_INVALID_AWB);

        awb.code = "MEESHO_INVALID_AWB";
        // Meesho's own words, off the narrow column and onto the log, where
        // "enter the correct reverse AWB" is the useful half.
        awb.detail = message;
        awb.fields = errors.map((e) => e.field_name).filter(Boolean);

        return awb;
    }

    /*
     * THE SUB-ORDER NUMBER, which is RECOVERABLE and so must be recognisable.
     *
     * This reached the column as `CLAIM_REFUSED: Please enter a valid sub order
     * number.` — the same generic bucket as every refusal nobody has read yet.
     * Two things were wrong with that: an operator saw a machine tag instead of
     * the code the rest of the system uses for this exact fact (ME2), and the
     * FLOW could not tell it apart either, so it could not do the one thing
     * that fixes it — refile with the number Meesho's own search returned.
     *
     * `INVALID_SUB_ORDER_RE` is the same pattern `subOrderVerdict` uses on the
     * validation path, so the two routes to this fact agree.
     */
    if (INVALID_SUB_ORDER_RE.test(message)) {
        const wrong = new Error(INVALID_SUB_ORDER_MESSAGE);

        wrong.code = "INVALID_SUB_ORDER";
        wrong.detail = message;
        wrong.fields = errors.map((e) => e.field_name).filter(Boolean);

        return wrong;
    }

    /*
     * "Ticket {{ticket_id}} has already been raised for this issue."
     *
     * THE CLAIM EXISTS. That is not a failure — it is the answer the row
     * wanted, arriving as a refusal. Reported as one, the row sat on Failed to
     * Proceed with a ticket live at Meesho that nobody was tracking, and each
     * retry asked the same question again.
     *
     * THE ID IS NOT IN THE SENTENCE. Meesho's API sends the template
     * unrendered — `{{ticket_id}}`, literally — so there is nothing to parse
     * out of it, unlike the script flow where the portal interpolates a real
     * number. The caller has to go and FIND the ticket; this only says that
     * there is one.
     *
     * Same `code` the script flow raises for the same fact, so a consumer
     * matching on it behaves the same whichever flow filed.
     */
    if (/has already been raised for this issue/i.test(message)) {
        const raised = new Error("Meesho already has a ticket for this issue");

        raised.code = "MEESHO_ALREADY_RAISED";
        raised.detail = message;

        return raised;
    }

    /*
     * THE PACKET ID — ME6, and a row one person can fix.
     *
     * "Looks like you are filling the AWB number in the Packet ID field…" is
     * three sentences long and reached the column as `CLAIM_REFUSED: Looks like
     * you are filling the AWB…`, wrapped over the row. Nothing about it needs
     * the marketplace: the Packet ID is either the portal's own label or the
     * literal "NA", and both are typed on the row.
     *
     * LAST OF THE NAMED BRANCHES, because it is the broadest pattern here — it
     * matches a field name rather than a sentence. Anything that is really
     * about a return, a sub-order number or an existing ticket has already been
     * claimed by the branches above.
     *
     * `field_name` is checked too: Meesho tags these errors `barcode_id` (the
     * portal's internal name for the Packet ID box), so a rewording we have
     * never seen still lands here rather than in the catch-all.
     */
    const packetFields = errors.map((e) => e.field_name).filter(Boolean);

    if (INVALID_PACKET_ID_RE.test(message) || packetFields.includes("barcode_id")) {
        const packet = new Error(MEESHO_INVALID_PACKET_ID);

        packet.code = "INVALID_PACKET_ID";
        // Meesho's own three sentences, off the narrow column and onto the log,
        // where the instruction ("if you don't have a packet id, fill NA") is
        // the useful half.
        packet.detail = message;
        packet.fields = packetFields;

        return packet;
    }

    const err = new Error(
        TAT_MESSAGE_RE.test(message) ? `TAT_EXPIRED: ${message}` : `CLAIM_REFUSED: ${message}`
    );
    err.code = TAT_MESSAGE_RE.test(message) ? "TAT_EXPIRED" : "MEESHO_CLAIM_REFUSED";
    err.fields = errors.map((e) => e.field_name).filter(Boolean);
    return err;
}
/**
 * What this app calls an opaque server error.
 *
 * Meesho's gateway answers a claim it cannot process with a bare 500 and
 * `{"error":"Request failed with status code 500","options":{"backendData":{"error":""}}}`
 * — no field, no message, nothing to show an operator. Exported because the
 * shape is the whole test: a 500 that DOES carry a backend message is a
 * different problem and must not be relabelled.
 */
function isOpaqueServerError(error) {
    return Boolean(
        error &&
            error.code === "MEESHO_API_ERROR" &&
            Number(error.status) >= 500 &&
            !meeshoErrorDetail(error.body)
    );
}

/**
 * The claim window, in the words this app files against.
 *
 * From common/claimErrors so the Check TAT sweep and this submit path cannot
 * word the same fact differently — the column is matched on, not just read.
 */
const {
    TAT_EXPIRED: TAT_EXPIRED_MESSAGE,
    INVALID_SUB_ORDER: INVALID_SUB_ORDER_MESSAGE,
    MEESHO_RETURN_NOT_DELIVERED,
    MEESHO_INVALID_AWB,
    MEESHO_INVALID_PACKET_ID,
    MEESHO_TECHNICAL,
    meeshoTechnicalError,
} = require("../../../../common/claimErrors");
const { saveClaimFailure } = require("../../../../common/claimFailureStore");

function invalidSubOrderError(detail) {
    const err = new Error(INVALID_SUB_ORDER_MESSAGE);

    err.code = "INVALID_SUB_ORDER";
    err.detail = detail || null;
    err.verified = true;

    return err;
}

function tatExpiredError(detail, verified) {
    const err = new Error(TAT_EXPIRED_MESSAGE);

    err.code = "TAT_EXPIRED";
    // Meesho's own sentence, where there is one. Kept off the message because
    // the message is matched on downstream; this is for the log and the report.
    err.detail = detail || null;
    // False when the window could not be confirmed — see below.
    err.verified = verified === true;

    return err;
}

/**
 * The shape of a submitted payload, for a failure to be diagnosed from.
 *
 * One line, keys in the order they were sent, each with what it carried: a
 * count for a file slot, a length for text, the value itself only where it is
 * an identifier the portal shows on screen anyway (the sub-order, the AWB, the
 * packet id, the state). No signed URLs, no description text.
 */
/**
 * The same description as data, for the failure case written to disk.
 *
 * ONE RULE, TWO DESTINATIONS. The terminal line and the saved case must agree
 * about what is safe to keep — signed URLs and the seller's own prose are not —
 * so the decision lives here and both read it.
 */
function describeSubmittedPayload(body) {
    const shown = new Set(["sub_order_number", "awb_number", "barcode_id", "packet_state"]);

    return {
        category: `${body.category_id}/${body.sub_category_id}`,
        supplier: body.supplier_identifier,
        // Keys in the order they went, which is the thing a diff against the
        // portal's own payload actually turns on.
        fields: (body.ticket_details || []).map((detail) => ({
            key: detail.key,
            type: detail.type,
            value: Array.isArray(detail.value)
                ? `[${detail.value.length}]`
                : shown.has(detail.key)
                    ? String(detail.value ?? "")
                    : `${String(detail.value ?? "").length} chars`,
        })),
    };
}

function logSubmittedShape(body, logger) {
    try {
        const described = describeSubmittedPayload(body);
        const fields = described.fields.map(
            (field) =>
                `${field.key}:${field.type}=` +
                (field.value.startsWith("[") || field.value.endsWith("chars")
                    ? field.value
                    : JSON.stringify(field.value))
        );

        const line =
            `📤 MEESHO createTicket payload — category=${body.category_id}/${body.sub_category_id} ` +
            `supplier=${body.supplier_identifier} fields: ${fields.join(" ")}`;

        (logger && typeof logger.warn === "function" ? logger.warn : console.warn).call(
            logger || console,
            line
        );
    } catch (_) {
        /* logging must never break a claim */
    }
}

/** Extensions the `attachments` slot — an `img_file` — can hold. */
const ATTACHMENT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".heic", ".gif"];

/**
 * Only the images out of whatever TrackVid put in `attachments`.
 *
 * A URL with NO extension is kept: an S3 key often has none, and dropping one
 * would quietly file a claim with less evidence than the row carries. Only a
 * recognisably non-image extension is removed.
 */
function imageAttachments(urls) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];

    return list.filter((url) => {
        const clean = String(url).split("?")[0] || "";
        const dot = clean.lastIndexOf(".");
        const ext = dot > -1 ? clean.slice(dot).toLowerCase() : "";

        return !ext || ATTACHMENT_IMAGE_EXTENSIONS.includes(ext);
    });
}

async function createTicket(ctx, {
    subCategoryId = "1", categoryId = "1",
    supplierEmail,
    subOrderNumber, awbNumber,
    stateOfPacket, packetId,
    barcodeImageUrl, productImageUrls = [], reverseWaybillUrls = [], videoUrl,
    description, attachments = [], callbackNumber,
}) {
    assertClaimSubmitEnabled("meesho", "create ticket");

    const details = [
        { key: "sub_order_number", type: "action_single_text_box", label: "Sub Order Number", value: meeshoId(subOrderNumber) },
        { key: "awb_number", type: "action_single_text_box", label: "AWB Number", value: meeshoId(awbNumber) },
    ];
    /**
     * ALWAYS SENT, EMPTY OR NOT — the same rule as the file slots below.
     *
     * THESE TWO WERE LEFT CONDITIONAL when that rule was applied to the four
     * file slots, and they are the same bug. The portal's own createTicket
     * sends `packet_state` and `barcode_id` on every filing, so a claim whose
     * row carries neither submitted a payload with two keys the portal has
     * never omitted — against a backend that answers a shape it dislikes with
     * HTTP 500 and an empty body, which is the least diagnosable failure this
     * flow has.
     *
     * It also explains the report this came from: the same claim filed by hand
     * in the portal went through, because the form supplies both.
     *
     * An empty value, not a missing key. That is how this form says "nothing
     * here" — `ticket_desc` and `attachments` are sent empty for the same
     * reason.
     */
    const packetState = stateOfPacket === null || stateOfPacket === undefined
        ? ""
        : String(stateOfPacket).trim();

    details.push({
        key: "packet_state", type: "drop_down", label: "State of the packet",
        // The capture shows both `value` (lowercase) + `selectedLabel` (Title Case).
        value: packetState.toLowerCase(),
        selectedLabel: packetState
            ? packetState.charAt(0).toUpperCase() + packetState.slice(1).toLowerCase()
            : "",
    });
    details.push({
        key: "barcode_id", type: "action_single_text_box", label: "Packet ID",
        // Coerced rather than refused: a packet id is the portal's own label
        // (DLVPCP017051342) and carries no precision to lose, unlike the
        // identifiers meeshoId guards.
        value: packetId === null || packetId === undefined ? "" : String(packetId),
    });
    /**
     * THE FILE SLOTS ARE ALWAYS SENT, EMPTY OR NOT.
     *
     * The portal's own createTicket — captured from a filing that succeeded
     * (ticket 789744526971, 2026-09-18) — sends all four, and sends
     *
     *     {"key":"attachments","type":"img_file","label":"Attachments","value":[]}
     *
     * with nothing in it. An empty array is how this form says "nothing here";
     * a MISSING key is a different thing, and the shape the portal never sends.
     * These were conditional, so a claim without a barcode image or a video
     * submitted a payload the portal has never produced — against a backend
     * that answers a shape it dislikes with HTTP 500 and an empty body.
     */
    /**
     * THE RTO FORM IS A DIFFERENT SHAPE.
     *
     * Captured from a filing accepted by hand on form 139 (ticket 793769199476,
     * 2026-11-04): it has NO `barcode_image_link` slot, and its two image slots
     * are `img_file`, not `action_img_file`. Sent form 1's shape, it carries a
     * key the RTO form has never produced — against the backend that answers
     * an unexpected shape with a bare 500.
     *
     * The barcode image is not dropped: it goes into `attachments`, the form's
     * general image slot, so the evidence still reaches the reviewer.
     */
    const rtoForm = isRtoSubCategory(subCategoryId);
    const imageSlotType = rtoForm ? "img_file" : "action_img_file";

    if (!rtoForm) {
        details.push({ key: "barcode_image_link", type: "img_file", label: "Barcode Image", value: barcodeImageUrl ? [barcodeImageUrl] : [] });
    } else if (barcodeImageUrl) {
        attachments = [barcodeImageUrl, ...(Array.isArray(attachments) ? attachments : [])];
    }
    details.push({ key: "product_image_link", type: imageSlotType, label: "Image of product received", value: productImageUrls });
    details.push({ key: "product_reverse_way_bill_link", type: imageSlotType, label: "Reverse Waybill", value: reverseWaybillUrls });
    details.push({ key: "product_openingvideo_link", type: "video_file", label: "Unpacking Video", value: videoUrl ? [videoUrl] : [] });
    details.push({ key: "ticket_desc", type: "text_area", label: "Description", value: description || "" });
    /**
     * `attachments` IS AN IMAGE SLOT — `img_file`, exactly like the barcode.
     *
     * TrackVid fills it from the row's FORWARD video, so a claim with one put
     * an .mp4 URL into a field the portal only ever puts images in (and only
     * ever leaves empty). Images pass through; anything else is dropped and
     * named, because the alternative is a payload the portal cannot produce.
     */
    const keptAttachments = imageAttachments(attachments);
    const droppedAttachments = (Array.isArray(attachments) ? attachments.filter(Boolean) : []).filter(
        (url) => !keptAttachments.includes(url)
    );

    if (droppedAttachments.length > 0) {
        // Named, not dropped in silence: this is evidence somebody attached to
        // the row, and "the portal has no slot for it" is the operator's to
        // know. `attachments` is the only image slot that can receive
        // something that is not an image, because TrackVid fills it from a
        // video field.
        (ctx?.logger?.warn || console.warn).call(
            ctx?.logger || console,
            `   ⚠️ ${droppedAttachments.length} attachment(s) left out of the ticket — Meesho's ` +
            `Attachments slot takes images only: ${droppedAttachments
                .map((url) => String(url).split("?")[0].split("/").pop())
                .join(", ")}`
        );
    }

    details.push({ key: "attachments", type: "img_file", label: "Attachments", value: keptAttachments });
    // The third of the same kind, and the portal sends it on every filing too.
    details.push({
        key: "callback_number", type: "text_box", label: "Callback Number",
        value: callbackNumber === null || callbackNumber === undefined ? "" : String(callbackNumber),
    });

    const body = {
        category_id: String(categoryId),
        sub_category_id: String(subCategoryId),
        supplier_id: String(ctx.supplierId || ""),
        supplier_identifier: ctx.supplierIdentifier || "",
        supplier_email_id: supplierEmail || "",
        ticket_details: details,
        faq_classification_info: {
            faq_classification_id: "",
            supplier_selected_sub_category_id: Number(subCategoryId),
            supplier_selected_category_id: Number(categoryId),
            misc: {},
        },
    };
    let res;

    try {
        res = await httpCall(ctx, {
            url: `${ORIGIN}/api/experience/support/createTicket`,
            data: body,
            headers: {
                "content-type": "application/json;charset=UTF-8",
                Referer: `${ORIGIN}/panel/v3/new/experience/${ctx.supplierIdentifier || ""}/support/${categoryId}/${subCategoryId}/create`,
            },
            step: "Create ticket",
        });
    } catch (error) {
        /**
         * WHAT WE SENT, on the way out.
         *
         * Meesho answers a payload it dislikes with HTTP 500 and
         * `{"backendData":{"error":""}}` — no field, no message — and this code
         * logged only that response. So the one thing needed to diagnose it,
         * the request, existed nowhere: a claim that failed twice could only be
         * understood by filing it again by hand in the portal and diffing the
         * browser's payload against the source. That is not a debugging step
         * anybody should have to take twice.
         *
         * Keys and value SHAPES, never the values: the attachment URLs are
         * signed and the description is a seller's own words. What a diff needs
         * is which fields went, in which order, with how much in them.
         */
        logSubmittedShape(body, ctx && ctx.logger);

        /**
         * A BARE 500 IS USUALLY A CLOSED CLAIM WINDOW.
         *
         * Meesho refuses a claim it can still reason about with HTTP 200 and a
         * sentence. What it does with one that is out of time is answer 500
         * with an empty `backendData` — no field, no message — which reached
         * the operator as three lines of JSON that say nothing and read like an
         * outage.
         *
         * So the window is ASKED about rather than assumed: the same
         * validateTicketField the TAT button uses, for the same sub-order and
         * AWB. Only its verdict turns this into "TAT expired"; a 500 with the
         * window still open is rethrown as itself, because then it really is
         * Meesho having a bad day and a retry is the right answer.
         */
        if (!isOpaqueServerError(error)) throw error;

        try {
            const validation = await validateTicketField(ctx, {
                subOrderNumber, awbNumber, categoryId, subCategoryId,
            });
            const verdict = tatVerdict(validation);

            if (verdict.expired) throw tatExpiredError(verdict.message, true);

            /**
             * NOT THE WINDOW, SO ASK ABOUT THE NUMBER.
             *
             * The form carrying both fields can answer valid — or refuse for
             * something else — while the sub-order number ON ITS OWN is one
             * Meesho does not recognise. That is the other thing behind a bare
             * 500, and it is the fixable one: Refill Data reads the right
             * number off the Returns search and the claim then files.
             */
            const single = await validateSubOrderNumber(ctx, {
                subOrderNumber, categoryId, subCategoryId,
            });
            const numberVerdict = subOrderVerdict(single);

            if (numberVerdict.invalid) throw invalidSubOrderError(numberVerdict.message);
        } catch (checkError) {
            if (checkError && (checkError.code === "TAT_EXPIRED" || checkError.code === "INVALID_SUB_ORDER")) {
                throw checkError;
            }

            // The check itself failed. The 500 is still what it is, and this is
            // the reading that fits every capture of it — reported as unverified
            // so nobody takes it for Meesho's own words.
            ctx?.logger?.warn?.(
                `[meesho] could not confirm the claim window after a bare 500: ${checkError?.message || checkError}`
            );

            throw tatExpiredError(null, false);
        }

        /**
         * EVERY QUESTION ASKED, AND NOTHING IS WRONG WITH THE ROW.
         *
         * The window is open and Meesho recognises the sub-order number, and it
         * still refused with a 500 that says nothing. That combination points at
         * the REQUEST, not the row — which is exactly what it was last time:
         * three `ticket_details` keys the portal always sends were conditional
         * here, so a claim whose row carried none of them submitted a shape the
         * portal never produces.
         *
         * The raw 500 used to be rethrown here, and it reached the column as
         * three lines of JSON that say nothing. MR1 says the one true thing —
         * this needs a code change, not a retry — and the case goes to disk so
         * the next one is READ rather than reproduced by filing the same claim
         * by hand in the portal.
         */
        saveClaimFailure(
            "meesho",
            {
                code: MEESHO_TECHNICAL,
                reason:
                    "Meesho refused with an empty 5xx; the claim window is open and the " +
                    "sub-order number validates, so the payload is the remaining difference",
                awbNumber: meeshoId(awbNumber),
                subOrderNumber: meeshoId(subOrderNumber),
                account: ctx && ctx.supplierIdentifier,
                status: error && error.status,
                request: describeSubmittedPayload(body),
                response: error && error.body,
            },
            ctx && ctx.logger
        );

        throw meeshoTechnicalError(error && error.message);
    }

    const answer = res.data || {};
    // A refusal arrives as a 200. Anything that is explicitly not valid, or
    // that carries errors, is a claim Meesho did NOT take.
    if (answer.is_valid === false || (Array.isArray(answer.errors) && answer.errors.length > 0)) {
        throw createTicketError(answer);
    }

    return {
        ticketId: answer.ticket_id ? String(answer.ticket_id) : null,
        // Spelled both ways across builds: `ticket_creation_message` in one
        // capture, `ticketcreationmessage` in the next.
        message: answer.ticket_creation_message || answer.ticketcreationmessage || null,
        ticketType: answer.ticket_type || null,
        raw: answer,
    };
}

// -----------------------------------------------------------------------------
// 🎫 Ticket readback — /searchTickets by sub_order_id
// -----------------------------------------------------------------------------
/**
 * POST /api/experience/support/searchTickets
 * Body: { supplier_id, page_num: 0, page_size: 10, search_ids: ["<sub_order_number>_1"] }
 * The suffix "_1" is the split index — the capture used it verbatim. Response
 * body isn't visible in the capture; probe common shapes to pull the ticket id.
 */
async function searchTicketsBySubOrder(ctx, subOrderNumber) {
    // Meesho pads the search id with a "_<num>" split index. The capture
    // used _1; some builds omit it. Try both.
    //
    // Upper-cased like every other identifier sent to Meesho. It matters most
    // HERE: this is the dedupe check, so a spelling that fails to match an
    // existing ticket does not merely fail to find it — it files a SECOND
    // ticket for a return that already has one.
    const id = meeshoId(subOrderNumber);
    const candidates = [id, `${id}_1`];
    for (const searchId of candidates) {
        try {
            const res = await httpCall(ctx, {
                url: `${ORIGIN}/api/experience/support/searchTickets`,
                data: {
                    supplier_id: Number(ctx.supplierId || 0),
                    page_num: 0, page_size: 10,
                    search_ids: [searchId],
                },
                step: `Search tickets (${searchId})`,
            });
            const list = extractTicketList(res.data);
            if (list.length > 0) return list;
        } catch (err) {
            dbg(`  searchTickets(${searchId}) failed: ${err.message}`);
        }
    }
    return [];
}
/**
 * READ one ticket in full — what the panel's ticket page shows: title,
 * description, the claim's own form fields (with the evidence links), the
 * update thread, status and whether it takes a reply.
 *
 * POST /api/experience/support/fetchTicket
 * Body: { ticket_id, supplier_id, identifier } — captured 2026-10-26.
 *
 * @returns {Promise<object>} the `data` object as Meesho sends it
 */
async function fetchTicket(ctx, ticketId) {
    const step = `Fetch ticket (${ticketId})`;
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/experience/support/fetchTicket`,
        data: {
            ticket_id: String(ticketId),
            supplier_id: Number(ctx.supplierId || 0),
            identifier: ctx.supplierIdentifier,
        },
        step,
    });
    const data = res.data && res.data.data;
    if (!data || typeof data !== "object") throw meeshoApiError(step, res.status, res.data);
    return data;
}

/**
 * REPLY on a ticket — text, attachments, or both. The attachments are URLs
 * already returned by `uploadAttachment`, exactly as the panel sends them.
 *
 * POST /api/experience/support/replyTicket
 * Body: { ticket_reply, ticket_id: <number>, s3_attachment_urls: [], supplier_id }
 * Success is meta.status === "SUCCESS" — captured 2026-10-26.
 */
async function replyTicket(ctx, { ticketId, reply = "", attachmentUrls = [] }) {
    const step = `Reply on ticket (${ticketId})`;
    const res = await httpCall(ctx, {
        url: `${ORIGIN}/api/experience/support/replyTicket`,
        data: {
            ticket_reply: String(reply),
            ticket_id: Number(ticketId),
            s3_attachment_urls: attachmentUrls,
            supplier_id: Number(ctx.supplierId || 0),
        },
        step,
    });
    if (!res.data || !res.data.meta || res.data.meta.status !== "SUCCESS") {
        throw meeshoApiError(step, res.status, res.data);
    }
    return res.data;
}
function extractTicketList(body) {
    if (!body) return [];
    if (Array.isArray(body)) return body;
    return body.tickets || body.data?.tickets || body.results || body.data || [];
}
function extractTicketId(ticket) {
    if (!ticket || typeof ticket !== "object") return null;
    return ticket.ticket_id || ticket.ticketId || ticket.id ||
           ticket.jira_key || ticket.ticket_number || null;
}
function extractTicketStatus(ticket) {
    if (!ticket || typeof ticket !== "object") return null;
    return ticket.status || ticket.ticket_status || ticket.state || null;
}

// -----------------------------------------------------------------------------
// 🗂️ Status mapping
// -----------------------------------------------------------------------------
// Meesho ticket lifecycle spellings vary across versions. Verified statuses
// aren't in the capture — probe common ones; unknowns map to null so the CMS
// status is left untouched (mirrors flipkart/snapdeal's rationale).
const MEESHO_TO_CMS_STATUS = {
    open: "In Review",
    in_progress: "In Review",
    in_review: "In Review",
    pending: "In Review",
    resolved: "Approved",
    approved: "Approved",
    closed: "Approved",
    rejected: "Rejected",
    denied: "Rejected",
    awaiting_response: "Awaiting Seller Response",
    seller_action_required: "Awaiting Seller Response",
};
function mapMeeshoStatus(s) {
    if (!s) return null;
    const k = String(s).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return MEESHO_TO_CMS_STATUS[k] || null;
}
function claimStatusToCmsStatus(s) { return mapMeeshoStatus(s) || "Success"; }

module.exports = {
    uploadFailureHint,
    imageAttachments,
    loginMeeshoApi,
    getSubCategorySchema, resolveSubCategoryId, MEESHO_SUBCATEGORY_IDS,
    getSubCategoryList, resolveSubCategoryIdLive, MEESHO_RTO_SUBCATEGORIES,
    rtoSubCategoryFor, isRtoSubCategory,
    ensureSupplierIdentity, meeshoErrorDetail,
    isOpaqueServerError, TAT_EXPIRED_MESSAGE, INVALID_SUB_ORDER_MESSAGE, MEESHO_INVALID_PACKET_ID,
    searchReturnClaims,
    validateTicketField, tatVerdict,
    validateSubOrderNumber, subOrderVerdict,
    uploadAttachment,
    createTicket,
    searchTicketsBySubOrder, extractTicketId, extractTicketStatus,
    fetchTicket, replyTicket,
    mapMeeshoStatus, claimStatusToCmsStatus, MEESHO_TO_CMS_STATUS,
    apiHeaders, httpCall, ORIGIN,
};
