/**
 * Myntra Partners — SPF claim direct-API flow.
 *
 * Replaces the Selenium UI navigation (Services → SPF → Create New Claim →
 * modal search → Apply Claim → form fill → Submit → Confirm) with the same
 * JSON APIs the portal calls. Mirrors the structure of
 * myntraMasterData/utils/apiReportFlow.js so both API flows read the same.
 *
 * Auth is HYBRID, exactly like the master-data API flow: Selenium bootstraps
 * cookies (Akamai on accounts.myntra.com hard-blocks Node's TLS fingerprint),
 * then those cookies are handed to axios. partnersapi accepts axios fine once
 * a real session cookie is present.
 *
 * Flow (verified against captured portal traffic):
 *   loginMyntraApi(credentials)            → cookieJar
 *   fetchNewClaim(jar, trackingId)         → { row, ticketId }
 *        ticketId present  → claim already filed, just record it
 *        ticketId absent   → claim can be raised
 *   uploadProof(jar, { filePath, orderId })→ blob URL  (presign + PUT to Azure)
 *   updateClaim(jar, payload)              → { ticketId }
 *   getTickets(jar) / findTicketIdByTrackingId(jar, id)        (fallback lookup)
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

// Login reuses the existing Selenium launcher + form-fill + Network-Error
// retry + Bright Data proxy path. Single source of truth with the UI flow.
const { buildDriverAndLogin, destroyDriver } = require("../common/utils");

// Cached cookie jars, stored per credential on the companies doc. Lets a run
// skip the browser login entirely when a previous run's session is still alive.
const { getUsableSession, saveSession, clearSession } = require("../../common/sessionStore");

// Dumps the full response body of any >= 400 answer to the terminal. The
// branch logic below reduces each error to one short sentence for the CMS row;
// this is what lets you still see exactly what Myntra sent.
const { logHttpError, logHttpBody, readStatus } = require("../../common/httpLog");
// Dry-run guard (DESABLE_SAVE): throws before any request that actually files a
// claim, so a test run can exercise the whole flow without submitting to Myntra.
const { assertClaimSubmitEnabled } = require("@trackvid/automation-core/common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");

const API_BASE = "https://partnersapi.myntrainfo.com";

/*
 * WHO THESE CALLS SAY THEY ARE — and it must be who the BROWSER was.
 *
 * These headers were a fixed macOS Chrome 151 on every machine, while the jar
 * they carry was minted minutes earlier by a real Chrome on the operator's
 * Windows desktop. Akamai sees one session told in two voices; see
 * ../../common/browserIdentity.js. Resolved once at load: the host does not
 * change under a running process, and the Windows version read is a readdir.
 */
const { myntraBrowserIdentity } = require("../../common/browserIdentity.js");

const IDENTITY = myntraBrowserIdentity();

// A real Chrome UA is required — partnersapi trivially blocks obvious bots.
const UA = IDENTITY.userAgent;

// Chromium Client Hints — Akamai's bot layer inspects these.
const CLIENT_HINTS = {
    ...IDENTITY.headers,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site", // partners.myntrainfo.com → partnersapi.myntrainfo.com
    priority: "u=1, i",
};

const REQ_TIMEOUT_MS = Number(process.env.MYNTRA_SPF_TIMEOUT_MS || 60000);

const dbg = (...a) => {
    if (process.env.MYNTRA_API_DEBUG === "true") console.log("[myntra-spf]", ...a);
};

// ---------------------------
// 🏷️ Issue categories
// ---------------------------
// The API takes the enum key; the CMS row (cms.typeOfClaim) stores the portal's
// display text. Anything not in this map falls through to a generic normalizer
// (upper-snake-case) so an exact enum key stored on the row also works.
const ISSUE_CATEGORIES = [
    "DAMAGED_RETURN",
    "STAINED_RETURN",
    "BOX_DAMAGED",
    "SHORTAGE_IN_RETURN",
    "EMPTY_BOX",
    "FAKE_RETURN",
    "PARTIAL_RETURN",
    "WRONG_RETURNS_RECEIVED_OTHER_SELLERS_PRODUCT",
    "WRONG_RETURNS_RECEIVED_OWN_PRODUCT",
    "USED_RETURN",
];

const ISSUE_CATEGORY_BY_LABEL = {
    "damaged return": "DAMAGED_RETURN",
    "damaged returns": "DAMAGED_RETURN",
    "stained return": "STAINED_RETURN",
    "stained returns": "STAINED_RETURN",
    "box damaged": "BOX_DAMAGED",
    "shortage in return": "SHORTAGE_IN_RETURN",
    "shortage in returns": "SHORTAGE_IN_RETURN",
    "empty box": "EMPTY_BOX",
    "fake return": "FAKE_RETURN",
    "fake returns": "FAKE_RETURN",
    "partial return": "PARTIAL_RETURN",
    "partial returns": "PARTIAL_RETURN",
    "used return": "USED_RETURN",
    "used returns": "USED_RETURN",
    "wrong returns-received own product": "WRONG_RETURNS_RECEIVED_OWN_PRODUCT",
    "wrong returns received own product": "WRONG_RETURNS_RECEIVED_OWN_PRODUCT",
    "wrong returns-received other seller's product": "WRONG_RETURNS_RECEIVED_OTHER_SELLERS_PRODUCT",
    "wrong returns-received other sellers product": "WRONG_RETURNS_RECEIVED_OTHER_SELLERS_PRODUCT",
    "wrong returns received other seller's product": "WRONG_RETURNS_RECEIVED_OTHER_SELLERS_PRODUCT",
};

/**
 * CMS display text (or an already-correct enum key) → API issueCategory enum.
 * Throws when the value can't be resolved — filing under the wrong category
 * would produce a claim ops has to withdraw manually.
 */
function mapIssueCategory(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("Missing issueCategory");

    const byLabel = ISSUE_CATEGORY_BY_LABEL[raw.toLowerCase()];
    if (byLabel) return byLabel;

    // Generic fallback: "Wrong Returns-Received own product" →
    // WRONG_RETURNS_RECEIVED_OWN_PRODUCT. Apostrophes are dropped rather than
    // turned into separators so "seller's" → "SELLERS".
    const generic = raw
        .replace(/['’]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    if (ISSUE_CATEGORIES.includes(generic)) return generic;

    throw new Error(
        `Unknown issueCategory "${raw}" — expected one of: ${ISSUE_CATEGORIES.join(", ")}`
    );
}

const isPartialReturn = (cat) => cat === "PARTIAL_RETURN";
const isWrongReturnsOwn = (cat) => cat === "WRONG_RETURNS_RECEIVED_OWN_PRODUCT";

// ---------------------------
// 🍪 Cookie jar (dumb {name:value} bag; single domain)
// ---------------------------
function cookieHeader(jar) {
    return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

function apiHeaders(jar, extra) {
    return {
        "user-agent": UA,
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://partners.myntrainfo.com",
        referer: "https://partners.myntrainfo.com/",
        "x-myntra-app-name": "partners",
        "x-requested-with": "XMLHttpRequest",
        ...CLIENT_HINTS,
        cookie: cookieHeader(jar),
        ...(extra || {}),
    };
}

// 401/403, or an HTTP 200 whose body carries { sessionExpired: true, statusCode:
// 101 }, means the session cookies died mid-batch. Tagged so the runner can
// re-login once and retry instead of failing every remaining AWB.


// Myntra appends the endpoint it choked on to the message
// ("... No valid orders found /api/spf/fetchNewClaim?fetchAccio=true&id=X").
// That part is noise in a CMS row — the URL says nothing an operator can act
// on, and the sentence before it says everything.
function cleanStatusMessage(message) {
    return String(message)
        .replace(/\s*\/api\/\S*$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Every partnersapi error response carries a human-readable reason in
 * `status.statusMessage`. Surface it verbatim as the error message so whoever
 * reads the failed CMS row sees what Myntra actually said, instead of an HTTP
 * code and a blob of JSON. Tagged MYNTRA_API_ERROR so the runner reports it
 * without wrapping it in "Step N (...) failed:".
 *
 * Falls back to HTTP status + body when the response has no statusMessage —
 * an unexpected shape must stay visible, not get flattened into a bare code.
 */
function apiError(step, res) {
    const statusMessage =
        res && res.data && res.data.status && res.data.status.statusMessage;

    if (statusMessage && String(statusMessage).trim()) {
        const err = new Error(cleanStatusMessage(statusMessage));
        err.code = "MYNTRA_API_ERROR";
        err.step = step;
        err.httpStatus = res.status;
        return err;
    }

    const body =
        typeof res.data === "string"
            ? res.data.slice(0, 300)
            : JSON.stringify(res.data || "").slice(0, 300);
    return new Error(`${step} failed: HTTP ${res.status} ${body}`);
}

// ---------------------------
// 🔐 Login (Selenium bootstrap → cookie jar)
// ---------------------------
async function loginMyntraApi(credentials, { forceFresh = false } = {}) {
    const email = credentials.username;
    const cacheKey = { credentialId: credentials._id, username: email };

    // Reuse a previously-stored jar when one is present, unexpired, and still
    // accepted by /api/boot/partners. That skips the whole visible-Chrome login
    // (~30-60s) and every failure mode attached to it. `forceFresh` is set by
    // the mid-batch relogin path, where we already know the cached jar is dead.
    //
    // No egress-IP gate here on purpose: only the browser login goes through
    // Bright Data — every axios call in this file (the probe included) already
    // leaves from the host IP. Myntra evidently doesn't bind the session to the
    // IP that minted it, or the existing API flow could never have worked. The
    // IP is still recorded on the cache record for debugging.
    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        // The caller hit a 401/403 with the jar we handed them — drop it before
        // logging in, so a crash between here and the save can't leave a known
        // dead session in the DB for the next run to trip over.
        await clearSession(cacheKey, "AUTH_EXPIRED — forcing fresh login");
    }

    dbg(`🌐 Selenium login for ${email}...`);
    const started = Date.now();

    const { driver, sessionId, ip } = await buildDriverAndLogin(credentials, {
        accountEmail: email,
        maxAttempts: 2,
        // Chrome exists here only to hand us `erp.at` + `session`; it's torn
        // down a few lines below and every claim step after that is HTTP. So
        // skip the dashboard gate outright, and don't let a wobbly
        // relationship-type modal (stale element reference on re-render) fail
        // an entire account's batch over a dialog we never needed.
        postLoginOptions: { dashboardGate: false, modalBestEffort: true },
    });

    const jar = {};
    try {
        const cookies = await driver.manage().getCookies();
        for (const c of cookies) {
            if (c && c.name) jar[c.name] = c.value;
        }
        dbg(`  ← ${Object.keys(jar).length} cookies: ${Object.keys(jar).join(", ")}`);

        if (!jar["erp.at"] || !jar["session"]) {
            // Cookies for partnersapi may be host-scoped rather than
            // domain-scoped — one hop makes Selenium surface them.
            dbg("  → hopping to partnersapi for host-scoped cookies...");
            await driver.get(`${API_BASE}/api/boot/partners`);
            await new Promise((r) => setTimeout(r, 1500));
            for (const c of await driver.manage().getCookies()) {
                if (c && c.name) jar[c.name] = c.value;
            }
        }
    } finally {
        try { await destroyDriver(driver); } catch (_) { /* already gone */ }
    }

    if (!jar["erp.at"] || !jar["session"]) {
        const err = new Error(
            `Myntra login: missing required cookies after Selenium bootstrap. Got: ${Object.keys(jar).join(", ") || "(none)"}`
        );
        err.code = "LOGIN_NO_COOKIES";
        throw err;
    }
    dbg(`✅ Login done in ${Date.now() - started}ms`);

    // Persist for the next run. Best-effort — a cache write must never fail a
    // login that just succeeded.
    await saveSession({ ...cacheKey, jar, ip, proxySession: sessionId, source: "claim-api" });

    return jar;
}

// ---------------------------
// 🔎 Step 2 — eligibility lookup (replaces the SPF modal search)
// ---------------------------
/**
 * GET /api/spf/fetchNewClaim?fetchAccio=true&id=<orderId|returnId|trackingId>
 *
 * Returns:
 *   { found: true,  row, ticketId: null }         — can raise a claim
 *   { found: true,  row, ticketId: <id> }         — already claimed; the caller
 *                                                   records the ticket instead
 *                                                   of filing again
 *
 * Throws (both mean "this id is not claimable on this account", by different
 * routes — Myntra reports the same verdict three ways, see below):
 *   NO_VALID_CLAIM "Invalid AWB Number"   — "No valid orders found", arriving
 *                                           either as a real 400 or as a 200
 *                                           carrying an ERROR envelope
 *   AWB_NOT_FOUND  "No AWB number found"  — 200 SUCCESS envelope, empty data[]
 *
 * `found` is therefore always true on return; it is kept so existing callers
 * and the orphan probe's three-way mapping still read naturally.
 */
async function fetchNewClaim(jar, searchId) {
    if (!searchId) throw new Error("fetchNewClaim: searchId is required");

    const url = `${API_BASE}/api/spf/fetchNewClaim?fetchAccio=true&id=${encodeURIComponent(searchId)}`;
    const res = await axios.get(url, {
        headers: apiHeaders(jar),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    logHttpError("fetchNewClaim", res);

    // Read the failure off BOTH the transport status and the body envelope.
    // partnersapi returns this exact "No valid orders found" answer as a real
    // HTTP 400 sometimes and as an HTTP 200 carrying { status: { statusCode:
    // 400, statusType: "ERROR" }, data: [] } other times — captured both for
    // the same AWB minutes apart. Branching on res.status alone read the second
    // shape as "call succeeded, zero rows" and reported it as "Claim is not
    // applicable", which is a DIFFERENT outcome (wrong seller account) than the
    // one Myntra was describing.
    const st = readStatus(res);

    if (st.isAuthExpired) {
        throw authError("fetchNewClaim", st.effective, JSON.stringify(res.data));
    }
    if (st.failed) {
        // A business outcome, not a failure of ours. Myntra's own wording
        // ("No valid orders found", plus the endpoint it choked on and a Node
        // stack trace from their server) means nothing to whoever opens the CMS
        // row — the actionable fact is that the AWB we searched isn't one this
        // account can claim against, so say exactly that.
        if (/no valid orders?\s+found/i.test(st.message)) {
            const err = new Error("Invalid AWB Number");
            err.code = "NO_VALID_CLAIM";
            throw err;
        }
        // Anything else: report Myntra's own statusMessage.
        throw apiError("fetchNewClaim", res);
    }

    const rows = (res.data && res.data.data) || [];
    if (rows.length === 0) {
        // Myntra's third way of saying "not claimable on this account" — and the
        // quietest. HTTP 200, `statusType: "SUCCESS"`, `statusCode: 200`, an
        // encouraging "Claim details fetched successfully"... and `data: []`:
        //   { status: { statusCode: 200, statusMessage: "Claim details fetched
        //     successfully", statusType: "SUCCESS", totalCount: 0 }, data: [] }
        // No error status is involved, so neither logHttpError above nor the
        // st.failed branch ever fires. Print the envelope: statusMessage
        // sometimes names the real reason, and when it doesn't, seeing that it
        // is genuinely empty is itself the answer.
        logHttpBody(
            "fetchNewClaim",
            res,
            `no rows for "${searchId}" — reported as "No AWB number found"`
        );
        // Then throw, rather than returning a `found: false` every caller had to
        // remember to test. Same verdict as the "no valid orders" branch above,
        // reached by a different route.
        const err = new Error("No AWB number found");
        err.code = "AWB_NOT_FOUND";
        err.searchId = String(searchId);
        throw err;
    }

    const row = rows[0];
    // A ticketId on the row means Myntra already has a claim for this line —
    // the UI renders "View Claim" instead of "Apply Claim" in that case.
    const ticketId = row.ticketId != null ? String(row.ticketId) : null;
    return { found: true, row, ticketId };
}

/**
 * GET /api/spf/fetchClaimByTicketId?fetchAccio=true&id=<ticketId>
 *
 * Reads back a claim we already filed, to learn Myntra's current decision on
 * it. Same auth/session as every other call here — the status-sync job runs
 * inside an already-open account session, so this costs one GET per open
 * claim and no extra login.
 *
 * Returns { found, status, originalStatus, validationReason, row }.
 *   status          — Myntra's live claim state (OPEN / ACCEPT / REJECT / …)
 *   originalStatus  — their pre-override value; kept for logging only
 *   validationReason— why it landed there (e.g. VMS_Footage_Not_Available_FWRD)
 *
 * A ticket Myntra no longer returns (deleted, wrong seller account, bad id)
 * comes back { found: false } rather than throwing — the caller treats that as
 * "nothing to update" and moves on to the next ticket.
 */
async function fetchClaimByTicketId(jar, ticketId) {
    if (!ticketId) throw new Error("fetchClaimByTicketId: ticketId is required");

    const url = `${API_BASE}/api/spf/fetchClaimByTicketId?fetchAccio=true&id=${encodeURIComponent(ticketId)}`;
    const res = await axios.get(url, {
        headers: apiHeaders(jar),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    logHttpError("fetchClaimByTicketId", res);

    const stfetchClaimByTicketId = readStatus(res);
    if (stfetchClaimByTicketId.isAuthExpired) {
        throw authError("fetchClaimByTicketId", stfetchClaimByTicketId.effective, JSON.stringify(res.data));
    }
    if (res.status === 400) {
        // Same shape as fetchNewClaim's "no valid orders" — a ticket this
        // account can't see is an answer, not a failure.
        return { found: false, status: null, originalStatus: null, validationReason: null, row: null };
    }
    if (res.status !== 200) throw apiError("fetchClaimByTicketId", res);

    const rows = (res.data && res.data.data) || [];
    if (rows.length === 0) {
        return { found: false, status: null, originalStatus: null, validationReason: null, row: null };
    }

    const row = rows[0];
    return {
        found: true,
        status: row.status != null ? String(row.status).trim().toUpperCase() : null,
        originalStatus: row.originalStatus != null ? String(row.originalStatus).trim().toUpperCase() : null,
        validationReason: row.validationReason || null,
        row,
    };
}

// ---------------------------
// 📤 Step 5 — proof upload (presign → PUT straight to Azure)
// ---------------------------
// The portal never posts the bytes to Myntra. Per file it does:
//   1. GET  /api/file-manager/getUploadToken/spfTest?fileNames=<orderId>_<epochMs>
//        → { "<fileName>": { sasUrl, fileNameWithPath } }
//        sasUrl is a write-only Azure SAS, valid ~15 min (st→se in the query).
//   2. PUT  <sasUrl>  with `x-ms-blob-type: BlockBlob` + the file's real
//        content-type, raw bytes as the body. No cookies — it's cross-site.
//   3. The value stored on the claim is the sasUrl WITHOUT its query string.
//        Verified against a real updateClaim body:
//        …/spf-claims/a4c7272c_100229635986_1785993646345

// Blob content-type mirrors what the browser reports for the picked file.
// Azure stores it verbatim; a wrong value would make the proof render as a
// download rather than an inline image for the reviewing agent.
const MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
};

function mimeForFile(filePath) {
    return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// Azure blob errors look like:
//   <?xml ...?><Error><Code>AuthenticationFailed</Code><Message>Server failed
//   to authenticate the request. …\nRequestId:…\nTime:…</Message></Error>
// Keep the code plus the first line of the message; the RequestId/Time tail is
// only useful to Microsoft support.
function azureErrorMessage(res) {
    const raw = Buffer.isBuffer(res.data)
        ? res.data.toString("utf8")
        : typeof res.data === "string"
            ? res.data
            : JSON.stringify(res.data || "");
    const code = (raw.match(/<Code>([^<]+)<\/Code>/) || [])[1];
    const message = (raw.match(/<Message>([^<]+)<\/Message>/) || [])[1];
    if (code || message) {
        const firstLine = String(message || "").split("\n")[0].trim();
        return [code, firstLine].filter(Boolean).join(" — ");
    }
    return `HTTP ${res.status} ${raw.slice(0, 200)}`;
}

// The portal names each upload `<orderId>_<epochMs>`; the server prefixes an
// 8-hex token of its own. Two files uploaded inside the same millisecond would
// request the same name, so keep the stamp strictly increasing per process.
let lastStamp = 0;
function nextStamp() {
    const now = Date.now();
    lastStamp = now > lastStamp ? now : lastStamp + 1;
    return lastStamp;
}

/**
 * GET /api/file-manager/getUploadToken/spfTest — ask for a write SAS.
 * The response is keyed by the requested file name.
 */
async function getUploadToken(jar, fileName) {
    const url =
        `${API_BASE}/api/file-manager/getUploadToken/spfTest?fileNames=${encodeURIComponent(fileName)}`;
    const res = await axios.get(url, {
        headers: apiHeaders(jar, { accept: "*/*" }),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    logHttpError("getUploadToken", res);

    const stgetUploadToken = readStatus(res);
    if (stgetUploadToken.isAuthExpired) {
        throw authError("getUploadToken", stgetUploadToken.effective, JSON.stringify(res.data));
    }
    if (res.status !== 200) throw apiError("getUploadToken", res);

    const entry = res.data && res.data[fileName];
    if (!entry || !entry.sasUrl) {
        throw new Error(
            `getUploadToken: no sasUrl for "${fileName}" — ${JSON.stringify(res.data).slice(0, 300)}`
        );
    }
    return { sasUrl: entry.sasUrl, fileNameWithPath: entry.fileNameWithPath };
}

/**
 * Uploads one proof file and returns the public blob URL for updateClaim.
 * Presign and PUT happen back to back because the SAS only lives ~15 minutes.
 */
async function uploadProof(jar, { filePath, orderId }) {
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`uploadProof: file not found -> ${filePath}`);
    }
    if (!orderId) throw new Error("uploadProof: orderId is required");

    const fileName = `${orderId}_${nextStamp()}`;
    const { sasUrl } = await getUploadToken(jar, fileName);

    const body = fs.readFileSync(filePath);
    const contentType = mimeForFile(filePath);

    // Azure blob storage — deliberately NOT apiHeaders(): sending Myntra
    // session cookies to a third-party host would leak them, and the SAS in
    // the URL is the only credential this request needs.
    const res = await axios.put(sasUrl, body, {
        headers: {
            "x-ms-blob-type": "BlockBlob",
            "content-type": contentType,
            "content-length": body.length,
            accept: "*/*",
            origin: "https://partners.myntrainfo.com",
            referer: "https://partners.myntrainfo.com/",
            "user-agent": UA,
            "sec-fetch-site": "cross-site",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS * 5, // videos are large
    });

    logHttpError("uploadProof(azure-put)", res);

    if (res.status < 200 || res.status >= 300) {
        // Azure answers with an XML error document, not Myntra's JSON envelope,
        // so pull <Code>/<Message> out of it for the same "say what actually
        // went wrong" reason.
        const err = new Error(
            `Proof upload failed for ${path.basename(filePath)}: ${azureErrorMessage(res)}`
        );
        err.code = "MYNTRA_API_ERROR";
        err.step = "uploadProof";
        err.httpStatus = res.status;
        throw err;
    }

    // Strip the SAS: the claim stores the plain blob URL.
    const blobUrl = sasUrl.split("?")[0];
    console.log(`    ⬆️  Uploaded ${path.basename(filePath)} (${body.length}B, ${contentType})`);
    dbg(`       → ${blobUrl}`);
    return blobUrl;
}

// ---------------------------
// 🧾 Step 7 — build the updateClaim body
// ---------------------------
/**
 * The PUT body is the fetchNewClaim row (sans server-only decoration like
 * styleInfo / sellerId) plus the claim fields the form collects.
 *
 * `attachments` repeats every image/video URL — the portal sends both the
 * per-section arrays and a flat attachments list.
 */
function buildUpdateClaimPayload({
    row,
    issueCategory,
    description,
    shippingLabelProofUrls = [],
    productProofUrls = [],
    videoProofUrls = [],
    disputedAmount,
    physicalReceivedSku,
}) {
    const {
        orderId, returnId, trackingId, returnTrackingId, skuId, orderLineId,
        returnCreatedDate, rejectionReason, styleId, orderCreatedOn, orderStatus,
        orderCancelDate, warehouseId, orderPackedDate, orderShippedDate,
        orderDeliveredDate, isRefunded, orderCreatedBy, returnMode, returnReason,
        finalAmount, meta,
    } = row;

    const attachments = [...shippingLabelProofUrls, ...productProofUrls, ...videoProofUrls];

    const payload = {
        orderId, returnId, trackingId, returnTrackingId, skuId, orderLineId,
        returnCreatedDate, rejectionReason, styleId, orderCreatedOn, orderStatus,
        orderCancelDate, warehouseId, orderPackedDate, orderShippedDate,
        orderDeliveredDate, isRefunded, orderCreatedBy, returnMode, returnReason,
        finalAmount, meta,
        // OCR verification is decided by the portal when the shipping label is
        // attached. We carry through whatever fetchNewClaim reported and default
        // to false — claiming `true` without the OCR round-trip would assert
        // something we haven't verified.
        isOCRVerified: row.isOCRVerified === true,
        issueCategory,
        status: "OPEN",
        description: description || "",
        shippingLabelProofUrl: shippingLabelProofUrls.length ? shippingLabelProofUrls : null,
        productProofUrl: productProofUrls.length ? productProofUrls : null,
        videoProofUrl: videoProofUrls.length ? videoProofUrls : null,
        replyComment: "",
        attachments,
    };

    // Category-conditional fields, mirroring the two extra inputs the form
    // renders. `physicalReceivedSku` is confirmed by the claim schema;
    // `sellerNotifiedAmount` is the best match for the form's "Disputed Amount"
    // but has NOT been confirmed against a captured PARTIAL_RETURN submit —
    // verify on the first live partial-return claim.
    if (isWrongReturnsOwn(issueCategory)) {
        if (!physicalReceivedSku || !String(physicalReceivedSku).trim()) {
            throw new Error(
                "Missing physicalReceivedSku for 'Wrong Returns-Received own product' claim — set it on the CMS row and retry"
            );
        }
        payload.physicalReceivedSku = String(physicalReceivedSku).trim();
    }
    if (isPartialReturn(issueCategory)) {
        if (disputedAmount === undefined || disputedAmount === null || disputedAmount === "") {
            throw new Error(
                "Missing disputedAmount for 'Partial Return' claim — set it on the CMS row and retry"
            );
        }
        payload.sellerNotifiedAmount = Number(disputedAmount);
    }

    return payload;
}

/**
 * PUT /api/spf/updateClaim — files the claim. Returns the created ticket id.
 * Success is `status.statusCode` 200/201 with `data[0].ticketId`.
 */
async function updateClaim(jar, payload) {
    assertClaimSubmitEnabled("Myntra", "updateClaim (PUT /api/spf/updateClaim)");
    const res = await axios.put(`${API_BASE}/api/spf/updateClaim`, payload, {
        headers: apiHeaders(jar, { "content-type": "application/json" }),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    logHttpError("updateClaim", res);

    const auth = readStatus(res);
    if (auth.isAuthExpired) {
        // Must stay AUTH_EXPIRED even when the 401 is only in the body — that
        // code is what makes the runner re-login once and retry the claim.
        throw authError("updateClaim", auth.effective, JSON.stringify(res.data));
    }

    const st = (res.data && res.data.status) || {};
    const row = res.data && res.data.data && res.data.data[0];
    const ok =
        res.status >= 200 && res.status < 300 &&
        st.statusType === "SUCCESS" &&
        row && row.ticketId != null;

    // On success statusMessage is "Ticket Created with id 8474261"; on failure
    // it's the reason the claim was rejected. Either way it's the one line
    // worth reporting.
    if (!ok) throw apiError("updateClaim", res);

    return { ticketId: String(row.ticketId), row };
}

// ---------------------------
// 🎫 Step 8 — ticket lookup fallback
// ---------------------------
const TICKET_STATUSES = [
    "OPEN", "IN_REVIEW", "ACCEPT", "REJECT", "MANUAL", "INVOICE_CREATED",
    "INVOICE_INITIATED", "PAYMENT_INITIATED", "PAYMENT_COMPLETED",
    "AWAITING_SELLER_RESPONSE", "AWAITING_AGENT_RESPONSE", "CLOSED", "DISPUTED",
];

/** GET /api/spf/getTickets — one page of this seller's SPF tickets. */
async function getTickets(jar, { page = 1, pageSize = 50, statuses = TICKET_STATUSES } = {}) {
    const qs =
        `fetchAccio=true&page=${page}&pageSize=${pageSize}` +
        statuses.map((s) => `&status=${encodeURIComponent(s)}`).join("");

    const res = await axios.get(`${API_BASE}/api/spf/getTickets?${qs}`, {
        headers: apiHeaders(jar),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    logHttpError("getTickets", res);

    // Envelope-aware for the same reason as fetchNewClaim: an error delivered
    // inside an HTTP 200 would otherwise fall through as an EMPTY ticket list.
    // That is the dangerous direction — findTicketIdByTrackingId would conclude
    // "no ticket exists for this AWB" and the caller could file a second claim.
    const st = readStatus(res);
    if (st.isAuthExpired) {
        throw authError("getTickets", st.effective, JSON.stringify(res.data));
    }
    if (st.failed) throw apiError("getTickets", res);
    return (res.data && res.data.data) || [];
}

/**
 * Find an existing ticket id for an AWB / order id / return id. Used when
 * updateClaim's response didn't carry one (shouldn't happen) and as a
 * best-effort re-check. Pages until a match or `maxPages` is exhausted.
 */
async function findTicketIdByTrackingId(jar, searchId, { pageSize = 50, maxPages = 4 } = {}) {
    if (!searchId) return null;
    const needle = String(searchId).trim();

    for (let page = 1; page <= maxPages; page++) {
        const rows = await getTickets(jar, { page, pageSize });
        const hit = rows.find(
            (r) =>
                String(r.trackingId || "") === needle ||
                String(r.returnTrackingId || "") === needle ||
                String(r.orderId || "") === needle ||
                String(r.returnId || "") === needle
        );
        if (hit && hit.ticketId != null) return String(hit.ticketId);
        if (rows.length < pageSize) break; // last page
    }
    return null;
}

// -----------------------------------------------------------------------------
// 🗂️ Myntra claim state → CMS status
// -----------------------------------------------------------------------------
// Myntra's lifecycle, as observed:
//   OPEN → AWAITING_SELLER_RESPONSE ⇄ AWAITING_AGENT_RESPONSE → ACCEPT/REJECT
//        → PAYMENT_COMPLETED
//
// The two "awaiting" states are kept apart on purpose: one is blocked on US and
// one is Myntra working the payout. Collapsing either into "In Review" throws
// away exactly the bit an operator acts on.
//
// Anything not listed (MANUAL, INVOICE_CREATED, PAYMENT_INITIATED, CLOSED,
// DISPUTED, or a state Myntra adds later) maps to null and leaves the CMS
// status untouched. Guessing at an unknown state is how a claim silently lands
// in the wrong bucket.
//
// HERE rather than in a runner because three callers need the same answer: the
// server's status sync, the desktop's Refill Data, and anything that reads a
// claim back after filing it. Three copies of a table like this is how two of
// them end up disagreeing about what ACCEPT means.
const MYNTRA_TO_CMS_STATUS = {
    OPEN: "In Review",
    IN_REVIEW: "In Review",
    AWAITING_SELLER_RESPONSE: "Awaiting Seller Response",
    ACCEPT: "Approved",
    AWAITING_AGENT_RESPONSE: "Awaiting Agent Response",
    REJECT: "Rejected",
    PAYMENT_COMPLETED: "Paid",
};

function mapMyntraStatus(myntraStatus) {
    if (!myntraStatus) return null;

    return MYNTRA_TO_CMS_STATUS[String(myntraStatus).trim().toUpperCase()] || null;
}

/**
 * The payout Myntra settled, and only once it has.
 * @param {{ status?: string|null, compensationAmount?: number|null }|null} row
 * @returns {number|null}
 */
function myntraCompensation(row) {
    if (!row) return null;

    const status = String(row.status || "").trim().toUpperCase();

    if (status !== "PAYMENT_COMPLETED" && status !== "ACCEPT") return null;

    const amount = Number(row.compensationAmount);

    return Number.isFinite(amount) ? amount : null;
}

module.exports = {
    MYNTRA_TO_CMS_STATUS, mapMyntraStatus, myntraCompensation,
    // constants
    API_BASE,
    ISSUE_CATEGORIES,
    TICKET_STATUSES,
    // helpers
    mapIssueCategory,
    buildUpdateClaimPayload,
    // flow
    loginMyntraApi,
    fetchNewClaim,
    fetchClaimByTicketId,
    getUploadToken,
    uploadProof,
    updateClaim,
    getTickets,
    findTicketIdByTrackingId,
    // internals (exported for testing)
    _cookieHeader: cookieHeader,
    _apiHeaders: apiHeaders,
    _mimeForFile: mimeForFile,
};
