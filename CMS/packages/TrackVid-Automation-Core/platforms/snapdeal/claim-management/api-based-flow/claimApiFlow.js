/**
 * Snapdeal Seller Portal — direct-API claim flow.
 *
 * Replaces the Puppeteer UI navigation (Returns tab → Delivered Returns →
 * search AWB → Raise Dispute button → form fill → Submit → Disputed Returns
 * tab lookup) with the same JSON APIs the portal itself calls. Mirrors the
 * structure of flipkartAutoMation/flipkartAutoClaim/claimApiFlow.js so both
 * API flows read alike.
 *
 * Auth is HYBRID, exactly like the Flipkart / Myntra API flows: Puppeteer
 * performs the login (the seller-portal login is a two-step form — username
 * → "Login with Password" → password), then the session cookies are handed
 * to axios. The browser is torn down immediately afterwards; everything from
 * that point is HTTP.
 *
 * Verified against a full portal capture (api-network-records (4).json).
 * Chronological flow for one claim:
 *
 *   GET  /getLoggedInSeller                                     (session probe)
 *   GET  /returns/globalSearch?searchTerm=<awb>&searchType=AWBNUMBER
 *                                                → return line with suborderCode
 *        …and, when that search errors or matches nothing, the same call with
 *        searchTerm=<suborder>&searchType=SUBORDERCODE — the portal's second
 *        dropdown option, and the fallback the Puppeteer runner already has.
 *   GET  /returns/issueCategories?returnType=Courier_Return     (issue vocab)
 *   POST /returns/uploadAttachment (multipart)                  → { url: <S3> }
 *   POST /returns/uploadVideoAttachment (multipart)             → { url: <S3> }
 *   POST /returns/raiseDispute                                  → dispute id
 *   POST /returns/getDisputes                                   (id readback)
 *
 * OTP support is DELIBERATELY OMITTED — the user asked to comment it out for
 * now (will be re-enabled in a follow-up). The existing snapdealLogin util
 * already defaults handleOtp=false and throws "OTP_REQUIRED: ..." when the
 * portal shows the OTP page; we let that surface as a session-level failure
 * just like the Puppeteer runner does today.
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
// Shared >= 400 response logging (src/helper/apiResponseLogger.js) — same line shape
// on every claim platform, so one grep finds a failed call anywhere.
const { logApiFailure } = require("../../../../common/apiResponseLogger");
const FormData = require("form-data");

// Login reuses the existing Puppeteer launcher + login helpers. Single source
// of truth with the Puppeteer runner.
// Required lazily. A caller that supplies its own session never launches a
// browser, and a top-level require would force every consumer — including the
// Electron desktop app — to ship Chromium for a code path it never runs.
const {
    enableStealthMode,
    handleDialog,
    snapdealLogin,
} = require("../common/utils");

// Per-credential session cache (companies doc). Lets a run skip Puppeteer
// entirely when a previous session is still alive.
const {
    getUsableSession,
    saveSession,
    clearSession,
    cookieHeader,
    ORIGIN,
} = require("../../common/sessionStore");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");
const { normalizeLoose } = require("../../../../common/text");
const { loadPuppeteer, resolveExecutablePath } = require("../../../../common/browserRuntime.js");
const { isHeadless } = require("../../../../common/headless.js");

const REQ_TIMEOUT_MS = Number(process.env.SNAPDEAL_API_TIMEOUT_MS || 60000);

// A real Chrome UA — the portal's edge rejects obvious bots.
const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

// Client Hints copied from the capture. Snapdeal's edge inspects these.
const CLIENT_HINTS = {
    "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
};

const dbg = (...a) => {
    if (process.env.SNAPDEAL_API_DEBUG === "true") console.log("[snapdeal-api]", ...a);
};

// ---------------------------
// 🧰 Shared header builders
// ---------------------------
// Every authenticated call carries `X-Requested-With: XMLHttpRequest` (verified
// across all 285 seller.snapdeal.com captures). No CSRF token — the session
// cookie alone authorises mutating requests.
function apiHeaders(ctx, extra = {}) {
    return {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        "x-requested-with": "XMLHttpRequest",
        ...CLIENT_HINTS,
        cookie: cookieHeader(ctx.jar),
        ...extra,
    };
}

// 401/403 (or a redirect to /login) means the cookies died mid-batch. Tagged
// so the runner can re-login once and retry instead of failing every remaining
// AWB.


function snapdealApiError(step, status, body) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body || "");
    const err = new Error(`${step} failed: HTTP ${status} ${bodyStr.slice(0, 300)}`);
    err.code = "SNAPDEAL_API_ERROR";
    err.step = step;
    err.status = status;
    return err;
}

// A GET / POST wrapper that classifies AUTH_EXPIRED consistently.
async function httpCall(ctx, { method = "get", url, data, headers, step, responseType }) {
    const res = await axios({
        method,
        url,
        data,
        headers: apiHeaders(ctx, headers || {}),
        responseType,
        // Follow-redirect off: Snapdeal bounces expired sessions back to
        // /login, and axios would silently follow that into an HTML page.
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    if (res.status >= 400) {
        logApiFailure({ platform: "snapdeal", step, method, url, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    // 302 to /login means the same thing — session dead.
    if (res.status === 302 || res.status === 301) {
        const loc = res.headers?.location || "";
        if (/login|signin|auth/i.test(loc)) {
            throw authError(step, res.status, `redirect to ${loc}`);
        }
    }
    if (res.status < 200 || res.status >= 300) {
        throw snapdealApiError(step, res.status, res.data);
    }
    return res;
}

// ---------------------------
// 🔐 Login (Puppeteer bootstrap → cookie jar)
// ---------------------------
// Snapdeal doesn't publish a JSON login endpoint that we can call from Node
// (the capture shows `sellersweb.snapdeal.com/service/sellerOnboarding/login`,
// but the response body is not visible in the extension's silent capture, and
// the seller.snapdeal.com session cookie is set by a subsequent redirect that
// only a real browser executes). So the login uses Puppeteer — same helper the
// existing runner uses — and we harvest the cookies at the end.
//
// OTP: commented out for now per requirements. If Snapdeal shows the OTP page,
// snapdealLogin (with handleOtp: false) throws "OTP_REQUIRED: ..." — we let
// that surface as a session-level failure. A follow-up will wire OTP through
// the same extension channel the Puppeteer runner uses.
/**
 * @param credentials            the marketplace credential
 * @param opts.forceFresh        ignore any cached session and log in again
 * @param opts.session           a jar the caller already holds, e.g. one the
 *                               desktop app captured in its own browser window.
 *                               Used as-is: it skips both the session store and
 *                               Puppeteer, which is what lets this flow run
 *                               somewhere with no database access.
 * @param opts.fetchOtp          where an emailed code is read from, passed to
 *                               `snapdealLogin`. Omitted, it reads this
 *                               machine's mailbox as before; the desktop app
 *                               passes its own, having no IMAP environment.
 * @param opts.holdOnOtpFailureMs keep the browser open this long after an OTP
 *                               failure, so a person can see the page that
 *                               refused it. 0 (the default) closes at once.
 * @param opts.otpMailDelayMs    wait this long before reading the OTP mail.
 * @param opts.otpResends        on a refused code, "Resend OTP" up to this many
 *                               times. Both default 0: today's behaviour.
 */
async function loginSnapdealApi(
    credentials,
    {
        forceFresh = false,
        session = null,
        fetchOtp,
        holdOnOtpFailureMs = 0,
        otpMailDelayMs = 0,
        otpResends = 0,
    } = {}
) {
    const email = credentials.username;
    const cacheKey = { credentialId: credentials._id, username: email };
    const started = Date.now();

    // A caller-supplied session wins over everything. No probe: the caller is
    // asserting it has a live jar, and a probe here would need the store the
    // caller is deliberately avoiding.
    if (session && session.jar && Object.keys(session.jar).length > 0) {
        dbg(`🔑 Using a caller-supplied session for ${email}`);
        return { jar: session.jar, sellerId: session.sellerId ?? null };
    }

    // Reuse a stored session when one is present, unexpired and still accepted
    // by Snapdeal. Skips Puppeteer entirely.
    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    let browser = null;
    let jar = {};

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
        await enableStealthMode(page);
        handleDialog(page);

        // OTP disabled for API-based flow — see file header. Passing
        // handleOtp: false makes snapdealLogin throw OTP_REQUIRED if the
        // portal shows the OTP page, which the caller surfaces as a
        // session-level failure.
        // TODO(otp): thread jobId + cmsIds through here and set handleOtp:true
        // once the extension-side OTP channel is agreed for the API flow.
        try {
            await snapdealLogin(page, credentials, {
                handleOtp: false,
                otpMailDelayMs,
                otpResends,
                ...(fetchOtp !== undefined ? { fetchOtp } : {}),
            });
        } catch (err) {
            // Held BEFORE the finally below closes the browser — the page that
            // refused the code is the evidence.
            if (holdOnOtpFailureMs > 0 && /^OTP_/.test(String(err && err.message))) {
                console.log(
                    `   🔍 OTP failed — keeping the browser open ${Math.round(holdOnOtpFailureMs / 1000)}s to inspect (url: ${page.url()})`
                );
                await new Promise((r) => setTimeout(r, holdOnOtpFailureMs));
            }
            throw err;
        }

        // Harvest cookies for ALL Snapdeal domains — the session cookie for
        // seller.snapdeal.com is set here, plus subdomain cookies we may need.
        for (const c of await page.cookies("https://seller.snapdeal.com")) {
            if (c && c.name) jar[c.name] = c.value;
        }
        dbg(`  ← ${Object.keys(jar).length} cookies: ${Object.keys(jar).join(", ")}`);
    } finally {
        if (browser) {
            try { await browser.close(); } catch (_) { /* already gone */ }
        }
    }

    if (Object.keys(jar).length === 0) {
        const err = new Error("Snapdeal login: no cookies after Puppeteer bootstrap");
        err.code = "LOGIN_NO_COOKIES";
        throw err;
    }

    dbg(`✅ Login done in ${Date.now() - started}ms`);

    // Persist for the next run. Best-effort by design — see sessionStore.
    await saveSession({
        ...cacheKey,
        jar,
        source: forceFresh ? "renew-endpoint" : "claim-api",
    });

    return { jar, sellerId: null };
}

// ---------------------------
// 🔎 Step 1 — global search (replaces the AWB search input on Delivered Returns)
// ---------------------------
// A term is only worth sending if it is actually a value. A CMS row can carry
// an empty, "null" or "-" suborder, and Snapdeal answers such a searchTerm with
// the same HTTP 800 it answers a malformed AWB with — so an absent field would
// otherwise turn into a failed search instead of a skipped one.
function usableTerm(value) {
    const term = String(value ?? "").trim();
    if (!term) return null;
    return /^(null|undefined|-|n\/?a)$/i.test(term) ? null : term;
}

// The portal's search is TYPED: the dropdown beside the box ("AWB Number",
// "Suborder Id") picks `searchType`, it is not inferred from the term. These
// are those two options, and they are tried in this order. `step` is what the
// operator reads in the Script Error column, so the two searches are named
// apart — "Global search failed: HTTP 800" alone never said which one.
//
// Both spellings are CAPTURED from seller.snapdeal.com: AWBNUMBER from the
// original capture, SUBORDERCODE from a Sep 2026 request that returned the
// return row (`returnType.returnsList[].subOrderId`). `searchTypes` stays a list
// so an alternate spelling can be added without reshaping the loop; an
// alternate is only tried when the one before it never got an answer.
const SEARCH_MODES = {
    awb: {
        mode: "awb",
        searchTypes: ["AWBNUMBER"],
        matchOn: ["awbNumber"],
        step: "Global search",
    },
    suborder: {
        mode: "suborder",
        searchTypes: ["SUBORDERCODE"],
        matchOn: ["subOrderId", "suborderId", "subOrderCode", "suborderCode"],
        step: "Global search by suborder",
    },
};

// One mode + one term → one attempt per candidate searchType.
function searchAttempts(mode, term) {
    return mode.searchTypes.map((searchType) => ({
        mode: mode.mode,
        matchOn: mode.matchOn,
        step: mode.step,
        searchType,
        term,
    }));
}

/**
 * awbNumber → the return line item to raise a dispute against.
 *
 * Returns:
 *   { found: false, item: null }                      — nothing on this account
 *   { found: true,  item, alreadyDisputed: false }    — claimable
 *   { found: true,  item, alreadyDisputed: true, disputeId } — already raised
 *
 * `matchedBy` on a hit says which search answered — "awb" or "suborder".
 *
 * Pass `subOrderId` to enable the FALLBACK. The AWB search is not always the
 * way in: Snapdeal answers a term its edge dislikes with an HTTP 800 rather
 * than an empty result (a whole Snapdeal batch failed this way with "Global
 * search failed: HTTP 800"), and a return whose AWB was blank or re-issued
 * never matches on it at all. The suborder is present on the CMS row in both
 * cases, and is the portal's own second dropdown option — the same fallback
 * the Puppeteer runner has in `searchBySuborderId`. It is only tried when the
 * AWB search errored or matched nothing, and only when the suborder is a real
 * value, so a caller that has no suborder behaves exactly as before.
 *
 * The capture doesn't include response bodies, so the shape is inferred from
 * the portal's UI (Delivered Returns table columns: suborderCode, awbNumber,
 * status). If the response shape differs at runtime, adjust `extractReturnRow`.
 */
async function globalSearchAwb(ctx, awbNumber, { subOrderId = null } = {}) {
    const awbTerm = usableTerm(awbNumber);
    const suborderTerm = usableTerm(subOrderId);
    if (!awbTerm && !suborderTerm) {
        throw new Error("globalSearchAwb: awbNumber or subOrderId is required");
    }

    const attempts = [];
    if (awbTerm) attempts.push(...searchAttempts(SEARCH_MODES.awb, awbTerm));
    if (suborderTerm) attempts.push(...searchAttempts(SEARCH_MODES.suborder, suborderTerm));

    let firstError = null;
    // The suborder search's own failure, kept apart from the AWB's. When both
    // error, the operator must be able to read that the fallback RAN — a Script
    // Error of just "Global search failed: HTTP 800" looks like it never did.
    let suborderError = null;
    // The modes Snapdeal has actually ANSWERED. Non-empty is what separates
    // "this account does not hold the packet" from "we never got to ask", and
    // those are different outcomes for the caller. It also stops an alternate
    // searchType spelling from re-running a search that already worked.
    const answered = new Set();

    for (const attempt of attempts) {
        if (answered.has(attempt.mode)) continue;

        const url =
            `${ORIGIN}/returns/globalSearch?searchTerm=${encodeURIComponent(attempt.term)}` +
            `&searchType=${attempt.searchType}`;

        let res;
        try {
            res = await httpCall(ctx, { method: "get", url, step: attempt.step });
        } catch (err) {
            // A dead session is not a bad search term: the caller re-logs in and
            // retries the whole claim, so the fallback must not be spent on it.
            if (err && err.code === "AUTH_EXPIRED") throw err;
            if (!firstError) firstError = err;
            if (attempt.mode === SEARCH_MODES.suborder.mode) suborderError = err;
            dbg(`  ⚠️ ${attempt.step} failed for ${attempt.term}: ${err.message}`);
            continue;
        }

        answered.add(attempt.mode);
        const item = extractReturnRow(res.data, attempt.term, attempt.matchOn);
        if (!item) {
            dbg(`  ∅ ${attempt.step} matched no row for ${attempt.term}`);
            continue;
        }

        // A return that has been disputed already carries a disputeId / caseId.
        // Different Snapdeal payloads spell it differently — probe all common keys.
        const disputeId =
            item.disputeId || item.caseId || item.ticketId ||
            (item.dispute && (item.dispute.id || item.dispute.disputeId)) ||
            null;

        const returnType = returnTypeOf(item, res.data);

        if (returnType) dbg(`  ↩️ ${attempt.term} is a ${returnType}`);

        return {
            found: true,
            item,
            alreadyDisputed: !!disputeId,
            disputeId,
            matchedBy: attempt.mode,
            // Null when Snapdeal did not say; the caller keeps its default.
            returnType,
        };
    }

    // Every attempt errored — nothing was ever answered, so reporting "not on
    // this account" would be inventing a business outcome out of a failed call.
    if (answered.size === 0 && firstError) {
        if (suborderError && suborderError !== firstError) {
            // Appended to, not replaced: `code`, `status` and `step` stay the
            // AWB search's, so anything classifying the failure is unaffected.
            firstError.message += ` | suborder ${suborderTerm} also failed: ${suborderError.message}`;
        }
        throw firstError;
    }

    return { found: false, item: null, matchedBy: null, returnType: null };
}

// Extracts the return line matching `wanted` from the globalSearch response.
//
// VERIFIED shape (seller.snapdeal.com, Aug 2026) — the rows live two levels
// down, under a key spelled returnsLIST (plural "returns"):
//   { returnType: { delivered: ["Courier_Return"], returnsList: [ { awbNumber,
//                   subOrderId, statusOfItem, ... } ], status: {...} } }
// The older speculative paths below are kept as fallbacks for shapes we have
// not captured; only the returnType.returnsList one is confirmed.
//
// Rows are matched on the field the search was TYPED with (`matchOn`) rather
// than taken positionally: a multi-row response would otherwise file the
// dispute against whichever packet happened to sort first. `matchOn` is a list
// because the suborder is spelled four ways across Snapdeal's payloads; the
// first field a row actually carries is the one compared.
function extractReturnRow(data, wanted, matchOn = ["awbNumber"]) {
    if (!data) return null;

    const fields = Array.isArray(matchOn) ? matchOn : [matchOn];
    const wantedKey = String(wanted || "").trim().toUpperCase();

    // The row's value for whichever of `fields` it carries. "" when it carries
    // none of them, which is what makes a shape without the field fall through
    // to the next candidate list instead of matching nothing forever.
    const keyOf = (row) => {
        for (const field of fields) {
            const value = row ? row[field] : null;
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return String(value).trim().toUpperCase();
            }
        }
        return "";
    };

    const listCandidates = [
        data.returnType && data.returnType.returnsList,   // verified shape
        data.returnsList,
        data.returns,
        data.returnList,
        data.data && data.data.returnType && data.data.returnType.returnsList,
        data.data && data.data.returnsList,
        data.data && data.data.returns,
        data.data && data.data.returnList,
        data.data,
        Array.isArray(data) ? data : null,
    ].filter(Array.isArray);

    for (const list of listCandidates) {
        if (list.length === 0) continue;

        if (wantedKey) {
            const exact = list.find((r) => keyOf(r) === wantedKey);
            if (exact) return exact;
            // Rows that carry the searched field but none of them ours means this
            // account genuinely does not hold the packet — fall through to the
            // next candidate rather than disputing someone else's return.
            if (list.some((r) => keyOf(r))) continue;
        }

        return list[0];
    }

    // Single-object response
    if (data.suborderCode || data.subOrderCode || data.awbNumber) return data;
    if (data.data && (data.data.suborderCode || data.data.subOrderCode)) return data.data;
    return null;
}

/**
 * WHICH KIND OF RETURN THIS IS — and it is not always the same kind.
 *
 * `Courier_Return` was hard-coded here, in the issue-category lookup and in the
 * dispute itself, from the one capture we had. The portal sends the return's
 * OWN type: a manual claim that Snapdeal accepted carried `Buyer_Return`, and
 * every automated claim sending `Courier_Return` for the same kind of packet
 * came back HTTP 502 — a gateway error rather than a refusal, which is what a
 * backend does when the pair (returnType, issueType) does not resolve to
 * anything it can build a case from.
 *
 * It also decides the ISSUE VOCABULARY: `issueCategories` is fetched per return
 * type, so "Wrong Product Received" is not necessarily id 1 in both. Asking for
 * the wrong list means filing under the wrong id even when the request is
 * accepted, which is worse than a 502.
 *
 * Read from the row first, then from the response's own grouping (the capture
 * shows `returnType: { delivered: ["Courier_Return"], returnsList: [...] }` —
 * the arrays of STRINGS are the types, the array of objects is the rows), and
 * null when neither says. Null means the caller keeps today's default rather
 * than inventing one.
 */
function returnTypeOf(item, data) {
    const looksLikeType = (value) =>
        typeof value === "string" && /_return$/i.test(value.trim());

    for (const key of ["returnType", "returnMode", "type", "returnCategory", "returnFlow"]) {
        const value = item ? item[key] : null;

        if (looksLikeType(value)) return value.trim();
    }

    const grouped = data && data.returnType;

    if (grouped && typeof grouped === "object" && !Array.isArray(grouped)) {
        for (const value of Object.values(grouped)) {
            if (!Array.isArray(value)) continue;

            const hit = value.find(looksLikeType);

            if (hit) return hit.trim();
        }
    }

    return null;
}

// The suborderCode is what /returns/raiseDispute takes as `suborderCode`. The
// capture proves the field name; the extractor probes common spellings.
function getSuborderCode(item) {
    if (!item) return null;
    return (
        item.suborderCode ||
        item.subOrderCode ||
        item.subOrderId ||
        item.suborderId ||
        null
    );
}

// ---------------------------
// 🏷️ Issue categories
// ---------------------------
/**
 * GET /returns/issueCategories?returnType=Courier_Return
 *
 * VERIFIED response (seller.snapdeal.com, Aug 2026) — rows are under `list`,
 * and the label key is `category`, not label/name:
 *   { list: [ { id: 1, category: "Wrong Product Received" },
 *             { id: 6, category: "Package Not Received" },
 *             { id: 4, category: "Empty Package Received" },
 *             { id: 2, category: "Damaged Product Received" },
 *             { id: 3, category: "Partial Package Received" } ] }
 * `id` is what raiseDispute takes as `issueType` (int).
 */
async function getIssueCategories(ctx, returnType = "Courier_Return") {
    const url = `${ORIGIN}/returns/issueCategories?returnType=${encodeURIComponent(returnType)}`;
    const res = await httpCall(ctx, { method: "get", url, step: "Issue categories" });
    const list =
        res.data?.list ||                 // verified
        res.data?.issueCategories ||
        res.data?.data?.list ||
        res.data?.data ||
        res.data ||
        [];
    if (!Array.isArray(list)) return [];
    return list
        .map((c) => ({
            id: c.id != null ? Number(c.id) : (c.issueType != null ? Number(c.issueType) : null),
            label:
                c.category ||             // verified
                c.label ||
                c.name ||
                c.displayName ||
                c.issueType_desc ||
                c.issueTypeDesc ||
                null,
        }))
        .filter((c) => c.id != null && c.label);
}

// The CMS stores the portal's display text ("Empty Package" etc.); compare
// case- and punctuation-insensitively so a stray capital or hyphen doesn't
// reject an otherwise valid category.


function resolveIssueCategory(cmsValue, vocabulary) {
    const raw = String(cmsValue || "").trim();
    if (!raw) throw new Error("Missing issueCategory (typeOfClaim)");
    if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
        // Fall back to sending the label alone — raiseDispute may accept it
        // by name, and the server error we get if not is actionable.
        return { id: null, label: raw };
    }
    const exact = vocabulary.find((v) => v.label === raw);
    if (exact) return exact;
    const loose = vocabulary.find((v) => normalizeLoose(v.label) === normalizeLoose(raw));
    if (loose) return loose;
    throw new Error(
        `Unknown issueCategory "${raw}" — Snapdeal accepts: ${vocabulary.map((v) => v.label).join(" | ")}`
    );
}

// ---------------------------
// 📎 Attachment upload
// ---------------------------
/**
 * POST multipart to /returns/uploadAttachment or /returns/uploadVideoAttachment.
 * Response is presumed to return an S3 URL of the shape
 *   https://snapdeal-sf-prod-mum.s3.ap-south-1.amazonaws.com/sfRCAttachments/...
 * (seen verbatim inside a raiseDispute payload in the capture).
 *
 * The multipart body captured only the boundary, not the field name — "file"
 * is the overwhelming convention; override with SNAPDEAL_UPLOAD_FIELD if the
 * server rejects it.
 */
async function uploadAttachmentInner(ctx, filePath, endpointPath, step, uploadAs) {
    if (!filePath || !(await fs.pathExists(filePath))) {
        throw new Error(`${step}: file not found: ${filePath}`);
    }
    const field = process.env.SNAPDEAL_UPLOAD_FIELD || "file";
    /**
     * The name Snapdeal stores the attachment under, and therefore the name in
     * the URL the dispute carries.
     *
     * The images are named for their role by the download step
     * (outer_packaging_packslip_image1.png …), which is exactly what the portal
     * sends. The video kept whatever the source file was called — a 100-plus
     * character string of uuids and timestamps — where the portal sends a plain
     * `video.mp4`. Not proven to be what a 502 chokes on, but there is no
     * reason for our name to be different from the portal's.
     */
    const uploadFilename = uploadAs
        ? `${uploadAs}${path.extname(filePath) || ""}`
        : path.basename(filePath);

    const form = new FormData();
    form.append(field, fs.createReadStream(filePath), { filename: uploadFilename });

    const res = await axios.post(`${ORIGIN}${endpointPath}`, form, {
        headers: {
            ...form.getHeaders(),
            "user-agent": UA,
            Accept: "application/json, text/plain, */*",
            Referer: `${ORIGIN}/`,
            "x-requested-with": "XMLHttpRequest",
            ...CLIENT_HINTS,
            cookie: cookieHeader(ctx.jar),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    // Own request, so it does not pass through httpCall — log it here too.
    if (res.status >= 400) {
        logApiFailure({ platform: "snapdeal", step: `${step} (${uploadFilename})`, method: "POST", url: `${ORIGIN}${endpointPath}`, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(
            `${step} failed (${uploadFilename}): HTTP ${res.status} ${JSON.stringify(res.data || "").slice(0, 300)}`
        );
    }
    // VERIFIED shape (seller.snapdeal.com, Aug 2026):
    //   { success: true, errorCode: null, errorMessage: null,
    //     uploadedFileURL: "https://snapdeal-sf-prod-mum.s3.../sfRCAttachments/..." }
    // The URL key is uploadedFileURL (capital URL); the other spellings below
    // are unverified fallbacks kept for shapes we have not captured.
    const body = res.data || {};

    // HTTP 200 with success:false is Snapdeal's way of rejecting the file
    // (size, type, expired session). Surface its own message rather than the
    // generic "no url" one.
    if (body.success === false) {
        throw new Error(
            `${step} rejected ${uploadFilename}: ` +
            `${body.errorMessage || body.errorCode || JSON.stringify(body).slice(0, 200)}`
        );
    }

    const url =
        body.uploadedFileURL ||   // verified
        body.uploadedFileUrl ||
        body.url ||
        body.imageUrl ||
        body.videoUrl ||
        body.fileUrl ||
        body.location ||
        (body.data && (body.data.uploadedFileURL || body.data.url || body.data.imageUrl || body.data.videoUrl)) ||
        null;
    if (!url) {
        throw new Error(
            `${step} returned no url for ${uploadFilename}: ${JSON.stringify(body).slice(0, 300)}`
        );
    }
    dbg(`  📎 uploaded ${uploadFilename} → ${String(url).slice(0, 60)}...`);
    return String(url);
}

async function uploadAttachment(ctx, filePath) {
    return uploadAttachmentInner(ctx, filePath, "/returns/uploadAttachment", "Attachment upload");
}

async function uploadVideoAttachment(ctx, filePath) {
    return uploadAttachmentInner(ctx, filePath, "/returns/uploadVideoAttachment", "Video upload", "video");
}

// ---------------------------
// 💬 Queries — a filed claim's case thread
// ---------------------------
// The panel's Queries pane: read a case, attach files to it, comment on it.
// Captured 2026-10-26 from case 7793019767038 — a dispute raised by
// raiseDispute is a case here, under the caseId the claim recorded.

/**
 * The query uploads answer `uploadedFileURL` with a token in front of the
 * link ("/N2CQLDnOc0= - https://snapdeal-sf-prod-mum…"); the comment carries
 * the link alone, as the panel sends it.
 */
function queryUploadUrl(raw) {
    const text = String(raw || "");
    const at = text.indexOf("https://");
    return at >= 0 ? text.slice(at).trim() : text.trim();
}

/**
 * GET /queries/caseDetail?caseNumber=&pageNumber=&pageSize=
 * → { success, tktCase, lstCaseComments, lstCaseAttachments, noOfReopens, caseReopened }
 */
async function getCaseDetail(ctx, caseNumber, { pageNumber = 1, pageSize = 20 } = {}) {
    const step = `Case detail (${caseNumber})`;
    const query = `caseNumber=${encodeURIComponent(caseNumber)}&pageNumber=${pageNumber}&pageSize=${pageSize}`;
    const res = await httpCall(ctx, { method: "get", url: `${ORIGIN}/queries/caseDetail?${query}`, step });
    const body = res.data || {};
    if (body.success === false || !body.tktCase) {
        throw snapdealApiError(step, res.status, body.errorMessage || body);
    }
    return body;
}

/** POST multipart /queries/uploadAttachment — images and documents. Returns the link. */
async function uploadQueryAttachment(ctx, filePath) {
    return queryUploadUrl(await uploadAttachmentInner(ctx, filePath, "/queries/uploadAttachment", "Query attachment upload"));
}

/** POST multipart /queries/uploadVideoAttachment — one video per comment. Returns the link. */
async function uploadQueryVideo(ctx, filePath) {
    return queryUploadUrl(await uploadAttachmentInner(ctx, filePath, "/queries/uploadVideoAttachment", "Query video upload", "video"));
}

/**
 * POST /queries/addComment
 * Body: { caseNumber, comment, attachments: [{ name, url }], videoLink }
 * A comment on a closed case reopens it — the answer says so (caseReopened).
 */
async function addCaseComment(ctx, { caseNumber, comment = "", attachments = [], videoLink }) {
    const step = `Case comment (${caseNumber})`;
    const data = { caseNumber: String(caseNumber), comment: String(comment), attachments };
    if (videoLink) data.videoLink = videoLink;
    const res = await httpCall(ctx, {
        method: "post",
        url: `${ORIGIN}/queries/addComment`,
        data,
        headers: { "content-type": "application/json;charset=UTF-8" },
        step,
    });
    const body = res.data || {};
    if (body.success !== true) throw snapdealApiError(step, res.status, body.errorMessage || body);
    return body;
}

// ---------------------------
// ✅ Raise dispute (the claim itself)
// ---------------------------
/**
 * POST /returns/raiseDispute
 *
 * Body shape verified from the capture:
 *   {
 *     suborderCode:    "SDLC1077502060...",
 *     statusToBeMarked:"DISPUTE",
 *     returnType:      "Courier_Return",
 *     issueType:       <int, from issueCategories>,
 *     issueType_desc:  <string, the human label>,
 *     description:     <string>,
 *     imageUrls:       [ "<S3 url>", ... ],
 *     videoUrl:        "<S3 url or empty string>"
 *   }
 *
 * Response body isn't in the capture; the dispute id is looked up afterwards
 * via /returns/getDisputes (see getDisputeIdBySuborder).
 */
async function raiseDispute(ctx, {
    suborderCode,
    issueType,
    issueType_desc,
    description,
    imageUrls,
    videoUrl,
    returnType = "Courier_Return",
}) {
    // DESABLE_SAVE=true → attachments still upload, the dispute POST doesn't fire.
    assertClaimSubmitEnabled("Snapdeal", "raiseDispute (POST /returns/raiseDispute)");

    if (!suborderCode) throw new Error("raiseDispute: suborderCode is required");
    if (!issueType && !issueType_desc) {
        throw new Error("raiseDispute: issueType or issueType_desc is required");
    }
    // Key order is the portal's own, from a manual claim that Snapdeal accepted
    // (Sep 2026 capture). JSON order should not matter to a parser; matching the
    // one request known to work removes it from the list of suspects.
    const body = {
        suborderCode,
        statusToBeMarked: "DISPUTE",
        returnType,
        issueType: issueType != null ? Number(issueType) : null,
        description: description || "",
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
        issueType_desc: issueType_desc || "",
        videoUrl: videoUrl || "",
    };
    let res;
    try {
        res = await httpCall(ctx, {
            method: "post",
            url: `${ORIGIN}/returns/raiseDispute`,
            data: body,
            headers: { "content-type": "application/json;charset=UTF-8" },
            step: "Raise dispute",
        });
    } catch (err) {
        logRaiseDisputeBody(ctx, body);
        throw err;
    }

    // VERIFIED response (seller.snapdeal.com, Aug 2026):
    //   { success: true, errorCode: null, errorMessage: null, code: null,
    //     message: null, caseId: "787722597084", resultAgainstSuborders: [] }
    // A rejected dispute comes back as HTTP 200 with success:false, so the
    // status check inside httpCall never sees it — without this guard the
    // caller logs "Dispute submitted" for a claim that was never filed.
    const body_ = res.data || {};
    if (body_.success === false) {
        throw new Error(
            `Raise dispute rejected for suborder ${suborderCode}: ` +
            `${body_.errorMessage || body_.message || body_.errorCode || JSON.stringify(body_).slice(0, 200)}`
        );
    }
    return body_;
}

/**
 * One line describing what a FAILED raiseDispute sent — never the text itself.
 *
 * A 5xx from this endpoint comes back with an empty body, so the response says
 * nothing and the request is the only evidence. This prints its shape: lengths,
 * counts and the Snapdeal-side attachment names, which is what gets compared
 * against a manual claim that worked. The description is customer-facing text,
 * so only its size and the characters most likely to upset a parser are shown.
 */
function logRaiseDisputeBody(ctx, body) {
    try {
        const out = (ctx && ctx.logger) || console;
        const desc = String(body.description || "");
        const nonAscii = (desc.match(/[^\x00-\x7F]/g) || []).length;
        const htmlLeft = /<[a-z!/][^>]*>|&[a-z#0-9]+;/i.test(desc);
        const name = (url) => {
            try { return decodeURIComponent(path.basename(new URL(url).pathname)); } catch (_) { return "?"; }
        };
        const images = (body.imageUrls || []).map(name);
        const line =
            `🧾 [Raise dispute] request that failed: suborderCode=${body.suborderCode} ` +
            `issueType=${body.issueType} (${body.issueType_desc || "-"}) ` +
            `description=${desc.length} chars (non-ASCII ${nonAscii}, html left ${htmlLeft ? "YES" : "no"}) ` +
            `images=${images.length} [${images.join(", ")}] ` +
            `video=${body.videoUrl ? name(body.videoUrl) : "none"} ` +
            `body=${Buffer.byteLength(JSON.stringify(body))} bytes`;
        (out.warn || out.log).call(out, line);
    } catch (_) {
        // Diagnostics must never replace the real error.
    }
}

// ---------------------------
// 🎫 Dispute id lookup (readback)
// ---------------------------
/**
 * POST /returns/getDisputes
 *
 * Body shape (verified):
 *   { caseId: null, subOrderId: "<sub>", status: null,
 *     dateRange: { start, end }, pageNumber: 1, pageSize: 10 }
 *
 * Returns the disputes for that suborder. We take the newest one's id as the
 * ticket id (the run we just filed created it).
 */
async function getDisputes(ctx, { subOrderId, pageSize = 10 }) {
    if (!subOrderId) throw new Error("getDisputes: subOrderId is required");
    // A very wide window — the dispute we just filed is same-day, but the
    // portal itself uses a start-of-time-ish window on the returns page.
    // VERIFIED body — the portal sends a NULL dateRange when filtering by
    // suborder, not a computed window:
    //   { caseId: null, subOrderId: "73571611184", status: null,
    //     dateRange: { start: null, end: null }, pageNumber: 1, pageSize: 10 }
    const body = {
        caseId: null,
        subOrderId: String(subOrderId),
        status: null,
        dateRange: { start: null, end: null },
        pageNumber: 1,
        pageSize,
    };
    const res = await httpCall(ctx, {
        method: "post",
        url: `${ORIGIN}/returns/getDisputes`,
        data: body,
        headers: { "content-type": "application/json;charset=UTF-8" },
        step: "Get disputes",
    });
    // VERIFIED response (seller.snapdeal.com, Sep 2026):
    //   { cases: [ { caseId: "7789361346834", reason: "Wrong Product Received",
    //                status: "US", createdDate: 1789361340000,
    //                subOrderIds: ["74098296398"], products: [...] } ],
    //     recordCount: 1 }
    // Until `cases` was read first this function returned [] for EVERY
    // suborder — the ticket readback and the status sweep never saw a dispute.
    const list =
        res.data?.cases ||              // verified
        res.data?.list ||
        res.data?.disputes ||
        res.data?.data?.list ||
        res.data?.data ||
        (Array.isArray(res.data) ? res.data : []);
    return Array.isArray(list) ? list : [];
}

/**
 * The disputes list carries the ticket id under different key names across
 * Snapdeal responses (caseId, ticketId, disputeId, id). Probe them all.
 */
/** A dispute's creation time in ms. `createdDate` (epoch ms) is the verified key. */
function disputeTime(d) {
    const raw = d && (d.createdDate ?? d.createdAt ?? d.updatedAt);
    const t = typeof raw === "number" ? raw : new Date(raw || 0).getTime();
    return Number.isFinite(t) ? t : 0;
}

/**
 * The newest dispute for `subOrderId`, or null.
 *
 * Filtered on the suborder as well as sorted: the endpoint is queried by
 * suborder, but a case carries `subOrderIds` (a list), and reporting another
 * packet's case as this claim's ticket would mark the wrong claim filed. A case
 * that lists no suborders at all is kept — the query already scoped it.
 */
function newestDispute(disputes, subOrderId) {
    if (!Array.isArray(disputes) || disputes.length === 0) return null;
    const wanted = String(subOrderId || "").trim();
    const mine = disputes.filter((d) => {
        const ids = [
            ...(Array.isArray(d && d.subOrderIds) ? d.subOrderIds : []),
            ...(Array.isArray(d && d.products) ? d.products.map((p) => p && p.subOrderId) : []),
        ].filter(Boolean).map(String);
        return !wanted || ids.length === 0 || ids.includes(wanted);
    });
    if (mine.length === 0) return null;
    return mine.slice().sort((a, b) => disputeTime(b) - disputeTime(a))[0];
}

async function getDisputeIdBySuborder(ctx, subOrderId) {
    const disputes = await getDisputes(ctx, { subOrderId });
    if (!Array.isArray(disputes) || disputes.length === 0) return null;

    // The newest dispute is what we just raised. The list is usually already
    // newest-first; sort defensively by createdAt / updatedAt if present.
    const top = newestDispute(disputes, subOrderId);
    if (!top) return null;
    return (
        top.caseId ||
        top.ticketId ||
        top.disputeId ||
        top.id ||
        null
    );
}

// ---------------------------
// 💰 Settled returns — where a claim ended up, and what was paid
// ---------------------------
/**
 * GET /returns/returnsList?returnStatus=COMPLETED&searchTerm=AWBNUMBER&searchValue=<awb>
 *
 * VERIFIED (seller.snapdeal.com, 2026-09-18). The returns list is where a
 * finished claim's MONEY is, which the disputes list never carries:
 *
 *   { returnsList: [ { awbNumber: "SF3859035649SDM", subOrderId: "74033491184",
 *       statusOfItem: "COMPLETED",
 *       paymentDetail: { amount: -616.22, date: …, settled: true, onHold: false } } ] }
 *
 * THE AMOUNT IS THE VERDICT. A completed return that was paid for carries a
 * `paymentDetail.amount`; one that was not carries none. That is the only
 * statement Snapdeal makes about the outcome here — there is no "approved"
 * field to read — so the rule is the plain one: money means approved, a
 * completed return with no money means rejected, and NO RECORD AT ALL means
 * nothing is known and nothing should be written.
 *
 * The amount is NEGATIVE because it is a debit against the seller's account.
 * What a claim is worth is its size, so the sign is dropped.
 *
 * Asked per return type, because the endpoint takes one: the type that is known
 * first, then the other, since a caller repairing an old row often has neither
 * the type nor a reason to care which it was.
 */
const SETTLED_RETURN_TYPES = ["Courier_Return", "Buyer_Return"];

function paidAmountOf(row) {
    const amount = row && row.paymentDetail ? Number(row.paymentDetail.amount) : NaN;

    if (!Number.isFinite(amount) || amount === 0) return null;

    // A debit against the seller: the claim is worth its size, not its sign.
    return Math.abs(amount);
}

/**
 * The completed return for this AWB, and what it says about the claim.
 *
 * @returns {Promise<{found: boolean, row: object|null, status: string|null,
 *   amount: number|null, returnType: string|null}>}
 */
async function fetchSettledReturn(ctx, { awbNumber, subOrderNumber = null, returnType = null, pageSize = 50 }) {
    if (!awbNumber) throw new Error("fetchSettledReturn: awbNumber is required");

    // The known type first; the other as the fallback. Deduplicated so a known
    // type is not asked for twice.
    const types = [...new Set([returnType, ...SETTLED_RETURN_TYPES].filter(Boolean))];

    for (const type of types) {
        const url =
            `${ORIGIN}/returns/returnsList?pageSize=${pageSize}&returnStatus=COMPLETED` +
            `&returnType=${encodeURIComponent(type)}&searchTerm=AWBNUMBER` +
            `&searchValue=${encodeURIComponent(awbNumber)}&startRecord=0`;

        const res = await httpCall(ctx, { url, step: `Settled returns (${type})` });
        const list = Array.isArray(res.data && res.data.returnsList) ? res.data.returnsList : [];

        if (list.length === 0) continue;

        /**
         * The row for THIS claim.
         *
         * Matched on the AWB and the sub-order together where the claim knows
         * both — one AWB can carry several sub-orders, and paying the wrong one
         * into the wrong row is worse than not paying it at all. Where nothing
         * matches, the first row stands: the search was BY this AWB, so a
         * single-row answer is about it whatever the sub-order says.
         */
        const wantedAwb = String(awbNumber).trim().toUpperCase();
        const wantedSub = String(subOrderNumber || "").trim().toUpperCase();
        const matched =
            list.find(
                (row) =>
                    String(row.awbNumber || "").trim().toUpperCase() === wantedAwb &&
                    (!wantedSub || String(row.subOrderId || "").trim().toUpperCase() === wantedSub)
            ) || list[0];

        const amount = paidAmountOf(matched);

        return {
            found: true,
            row: matched,
            // Money means approved; a completed return with none means rejected.
            status: amount !== null ? "Approved" : "Rejected",
            amount,
            returnType: type,
        };
    }

    // Nothing on either type. NOT a verdict — the return may simply not be
    // completed yet, and writing a status here would be inventing one.
    return { found: false, row: null, status: null, amount: null, returnType: null };
}

// ---------------------------
// 🗂️ Dispute status → CMS status
// ---------------------------
// Snapdeal returns disputes in a small set of states through /returns/getDisputes
// (status field). VERIFIED spellings from portal traffic: OPEN, PROCESSING,
// RESOLVED, REJECTED. Anything unrecognised maps to null and deliberately
// leaves the CMS status untouched — see the Flipkart mapping for the same
// rationale.
const SNAPDEAL_TO_CMS_STATUS = {
    OPEN: "In Review",
    PROCESSING: "In Review",
    IN_REVIEW: "In Review",
    IN_PROGRESS: "In Review",
    PENDING: "In Review",
    // Blocked on US — someone has to act, must not hide inside "In Review".
    AWAITING_SELLER_RESPONSE: "Awaiting Seller Response",
    SELLER_ACTION_REQUIRED: "Awaiting Seller Response",
    APPROVED: "Approved",
    RESOLVED: "Approved",
    CLOSED_APPROVED: "Approved",
    REJECTED: "Rejected",
    CLOSED_REJECTED: "Rejected",
    DENIED: "Rejected",
};

function mapSnapdealStatus(snapdealStatus) {
    if (!snapdealStatus) return null;
    const key = String(snapdealStatus).trim().toUpperCase().replace(/[\s-]+/g, "_");
    return SNAPDEAL_TO_CMS_STATUS[key] || null;
}

function claimStatusToCmsStatus(snapdealStatus) {
    // Used at filing time for a pre-existing dispute: default to "Success"
    // (in-progress) when the state string isn't in our map, mirroring how the
    // Puppeteer flow's salvage path never demotes a claim below Success.
    return mapSnapdealStatus(snapdealStatus) || "Success";
}

module.exports = {
    // login + context
    loginSnapdealApi,
    // primary API steps
    globalSearchAwb, returnTypeOf,
    getSuborderCode,
    getIssueCategories,
    resolveIssueCategory,
    uploadAttachment,
    uploadVideoAttachment,
    raiseDispute,
    // queries — a filed claim's case thread
    getCaseDetail, uploadQueryAttachment, uploadQueryVideo, addCaseComment, queryUploadUrl,
    getDisputes,
    getDisputeIdBySuborder,
    fetchSettledReturn, paidAmountOf,
    newestDispute,
    // status mapping
    mapSnapdealStatus,
    claimStatusToCmsStatus,
    SNAPDEAL_TO_CMS_STATUS,
    // exported for tests / reuse
    extractReturnRow,
    apiHeaders,
    httpCall,
    ORIGIN,
};
