/**
 * Xbees (ExpressBees) — direct-API dispute flow.
 *
 * Verified end-to-end against ApiDocs/Express bees claim.json (request AND
 * response bodies captured for every step).
 *
 * Chronological flow for one dispute:
 *
 *   POST {AUTH_HOST}/realms/xpressbees/protocol/openid-connect/token
 *        (grant_type=authorization_code + PKCE, Puppeteer bootstrap)
 *   GET  {AUTH_SERVICE_HOST}/token?clients=b2cxpress,fms-service   (probe)
 *   POST {CLIENT_SHIP_HOST}/dispute/genericData                    (context)
 *   POST {CLIENT_SHIP_HOST}/disputeReasonSubReason                 (vocab)
 *   POST {CLIENT_SHIP_HOST}/getPresignedUrl                        (per file)
 *   PUT  <presigned S3 URL>                                        (direct)
 *   POST {CLIENT_SHIP_HOST}/saveUploadedMedia                      (→ tempMediaId)
 *   POST {CLIENT_SHIP_HOST}/raisedDispute                          (submit)
 *   POST {CLIENT_SHIP_HOST}/disputeSummary                         (status readback)
 *   POST {CLIENT_SHIP_HOST}/viewDisputeDetails                     (detail)
 *
 * Response envelope for every clientshipupdatesapi call:
 *   { ReturnCode: 100, ReturnMessage: "Success", ReturnResult: <payload> }
 *   Non-100 codes are treated as API errors.
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
    getUsableSession, saveSession, clearSession,
    AUTH_HOST, AUTH_SERVICE_HOST, CLIENT_SHIP_HOST, XBM_MASTER_HOST,
    DEFAULT_REALM, DEFAULT_CLIENT_ID,
} = require("../../common/sessionStore");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { authError } = require("../../../../common/apiError");
const { normalizeLoose } = require("../../../../common/text");
const { loadPuppeteer, resolveExecutablePath } = require("../../../../common/browserRuntime.js");
const { isHeadless } = require("../../../../common/headless.js");

const REQ_TIMEOUT_MS = Number(process.env.XBEES_API_TIMEOUT_MS || 60000);
const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const dbg = (...a) => {
    if (process.env.XBEES_API_DEBUG === "true") console.log("[xbees-api]", ...a);
};

// -----------------------------------------------------------------------------
// 🔐 Login (Puppeteer bootstrap → refresh_token in Mongo)
// -----------------------------------------------------------------------------
async function loginXbeesApi(credentials, { forceFresh = false } = {}) {
    const email = credentials.username;
    const cacheKey = { credentialId: credentials._id, username: email };
    const started = Date.now();

    if (!forceFresh) {
        const cached = await getUsableSession(cacheKey);
        if (cached) return cached;
    } else {
        await clearSession(cacheKey, "forced fresh login");
    }

    let browser = null;
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

        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setUserAgent(UA);

        // Intercept the Keycloak token exchange — that's how we grab a copy
        // of the access_token + refresh_token regardless of where the SPA
        // subsequently stashes them.
        const capturedToken = { promise: null, resolve: null };
        capturedToken.promise = new Promise((r) => { capturedToken.resolve = r; });

        page.on("response", async (res) => {
            const url = res.url();
            if (!url.includes("/protocol/openid-connect/token")) return;
            try {
                if (res.status() !== 200) return;
                const json = await res.json().catch(() => null);
                if (!json?.access_token) return;
                const realmMatch = url.match(/\/realms\/([^/]+)\//);
                const realm = realmMatch ? realmMatch[1] : DEFAULT_REALM;
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

        const landing = process.env.XBEES_LOGIN_URL || "https://clientportal.xbees.in/";
        await page.goto(landing, { waitUntil: "domcontentloaded", timeout: 60000 });

        // Xbees's client portal bounces to Keycloak SSO. The proven selectors
        // (from the existing Selenium runner utils.js:150-174) are the
        // Keycloak defaults: #username, #password, #kc-login. A "Sign in"
        // button on the client-portal landing sometimes bounces to Keycloak
        // — click it first if present.
        try {
            await page.waitForSelector("#username", { visible: true, timeout: 8000 });
        } catch (_) {
            // Landing may need a "Sign in" bounce to reach the Keycloak form.
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll("button"));
                const btn = btns.find((b) => (b.textContent || "").trim() === "Sign in");
                if (btn) btn.click();
            });
            await page.waitForSelector("#username", { visible: true, timeout: 45000 });
        }

        // Username + password (Keycloak IDs are stable).
        await page.type("#username", email, { delay: 60 });
        await page.waitForSelector("#password", { visible: true, timeout: 15000 });
        await page.type("#password", credentials.password, { delay: 60 });

        // Keycloak submit — id is #kc-login on every Keycloak realm.
        await page.evaluate(() => {
            const el = document.querySelector("#kc-login");
            if (el && !el.disabled) el.click();
        });

        const tokenBundle = await Promise.race([
            capturedToken.promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error("LOGIN_TIMEOUT: token endpoint never fired")), 60000)),
        ]);
        ctx = tokenBundle;

        if (!ctx?.accessToken || !ctx?.refreshToken) {
            const err = new Error("LOGIN_NO_TOKEN: token endpoint fired but response missing access/refresh token");
            err.code = "LOGIN_NO_TOKEN";
            throw err;
        }
    } catch (err) {
        try {
            if (browser) {
                const page = (await browser.pages())[0];
                const invalidHint = await page.evaluate(() => {
                    const t = document.body?.innerText || "";
                    return /invalid.*(username|password|credentials)|kc-feedback-text.*error/i.test(t);
                }).catch(() => false);
                if (invalidHint) {
                    const e = new Error("INVALID_CREDENTIALS: Xbees rejected the login (invalid username or password)");
                    e.code = "INVALID_CREDENTIALS";
                    throw e;
                }
            }
        } catch (_) { /* ignore */ }
        throw err;
    } finally {
        if (browser) { try { await browser.close(); } catch (_) { /* already gone */ } }
    }

    dbg(`✅ Login done in ${Date.now() - started}ms`);
    await saveSession({
        ...cacheKey,
        accessToken: ctx.accessToken,
        refreshToken: ctx.refreshToken,
        accessExpiresIn: ctx.accessExpiresIn,
        idToken: ctx.idToken,
        tokenType: ctx.tokenType,
        realm: ctx.realm,
        clientId: DEFAULT_CLIENT_ID,
        source: forceFresh ? "renew-endpoint" : "claim-api",
    });
    return {
        accessToken: ctx.accessToken,
        refreshToken: ctx.refreshToken,
        tokenType: ctx.tokenType,
        realm: ctx.realm,
        clientId: DEFAULT_CLIENT_ID,
        idToken: ctx.idToken,
    };
}

// -----------------------------------------------------------------------------
// 🧰 HTTP wrapper — Xbees envelope { ReturnCode, ReturnMessage, ReturnResult }
// -----------------------------------------------------------------------------
function apiHeaders(ctx, extra = {}) {
    return {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        authorization: `${ctx.tokenType || "Bearer"} ${ctx.accessToken}`,
        "content-type": "application/json",
        origin: "https://clientportal.xbees.in",
        referer: "https://clientportal.xbees.in/",
        ...extra,
    };
}


function xbeesApiError(step, msg) {
    const err = new Error(`${step} failed: ${msg}`);
    err.code = "XBEES_API_ERROR";
    err.step = step;
    return err;
}

// ---------------------------------------------------------------------------
// 🧾 Business outcomes that arrive as errors
// ---------------------------------------------------------------------------
// Xbees reports business failures as HTTP 200 with a non-100 ReturnCode. Some of
// those are an ANSWER, not a fault of ours — the claim simply cannot be raised.
// Their raw wording reads like a bug report and, wrapped by xbeesApiError, lands
// in the CMS row as:
//
//   Raise dispute failed: 103 Invalid! Shipment can not be mark as dispute after 216 hours
//
// The "Raise dispute failed: 103" prefix and the "Invalid!" mean nothing to whoever
// reads that row. Rewrite these to the plain sentence; the raw envelope is still in
// the terminal on the logApiFailure line above, so nothing is lost for debugging.
const XBEES_BUSINESS_OUTCOMES = [
    {
        returnCode: 103,
        // The window is whatever Xbees reports (it varies by account/config), so capture
        // the number rather than hard-coding 216.
        match: /can\s*not\s*be\s*mark(?:ed)?\s*as\s*dispute\s*after\s*(\d+)\s*hours?/i,
        // The operator-facing code, like Flipkart's "FE2: TAT expired of 14 days".
        message: (m) => `EE1: TAT expired of ${m[1]} hours`,
        // Used when the ReturnCode matches but Xbees reworded the message.
        fallback: "EE1: TAT expired",
        code: "DISPUTE_WINDOW_EXPIRED",
        // FINAL: the window has closed, so a retry can only fail the same way.
        // The desktop runner reads `terminal` and moves the row straight to
        // "Failed to Proceed"; the server matches on `code`, which is unchanged.
        terminal: true,
    },
];

/**
 * Map a non-100 Xbees envelope to a clean, operator-readable Error.
 * Returns null when the envelope is not a known business outcome, so the caller
 * falls back to the generic xbeesApiError with the full raw text.
 */
function xbeesBusinessError(data) {
    const returnCode = Number(data && data.ReturnCode);
    const raw = String((data && data.ReturnMessage) || "");
    for (const rule of XBEES_BUSINESS_OUTCOMES) {
        if (rule.returnCode != null && returnCode !== rule.returnCode) continue;
        const m = raw.match(rule.match);
        const err = new Error(m ? rule.message(m) : rule.fallback);
        err.code = rule.code;
        if (rule.terminal) err.terminal = true;
        err.xbeesReturnCode = returnCode;
        err.xbeesReturnMessage = raw;
        return err;
    }
    return null;
}

async function xbeesPost(ctx, urlPath, body, step, host = CLIENT_SHIP_HOST) {
    const res = await axios.post(`${host}${urlPath}`, body, {
        headers: apiHeaders(ctx),
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });
    if (res.status >= 400) {
        logApiFailure({ platform: "xbees", step, method: "POST", url: `${host}${urlPath}`, status: res.status, data: res.data, logger: ctx && ctx.logger });
    }
    if (res.status === 401 || res.status === 403) {
        throw authError(step, res.status, JSON.stringify(res.data || ""));
    }
    if (res.status < 200 || res.status >= 300) {
        throw xbeesApiError(step, `HTTP ${res.status} ${String(JSON.stringify(res.data || "")).slice(0, 300)}`);
    }
    const data = res.data;
    // Xbees answers 200 with a non-100 ReturnCode for business failures, so this is an
    // API error the same way a 4xx is — log it with the rest.
    if (data && typeof data === "object" && "ReturnCode" in data && data.ReturnCode !== 100) {
        logApiFailure({ platform: "xbees", step, method: "POST", url: `${host}${urlPath}`, status: `200/ReturnCode ${data.ReturnCode}`, data, logger: ctx && ctx.logger });
        // A known business outcome gets the plain sentence; anything else keeps the raw
        // "<step> failed: <code> <message>" so an unexpected envelope stays visible.
        throw xbeesBusinessError(data) || xbeesApiError(step, `${data.ReturnCode} ${data.ReturnMessage || ""}`);
    }
    return data?.ReturnResult ?? data;
}

// -----------------------------------------------------------------------------
// 🏷️ Vocabulary — dispute reason / sub-reason
// -----------------------------------------------------------------------------
/**
 * POST /disputeReasonSubReason
 * Request: { taskType: "DTO" | "DTA", disputeRaisedType: "Client" }
 * Response: [ { reason, subReason: [{ subReason, disputereasonid, isimage, isvideo }] } ]
 *
 * The "taskType" varies per shipment. Verified shape is DTO (Domestic To
 * Origin — returns). The runner picks DTO for return shipments; extend as
 * new task types come in.
 */
async function getDisputeReasons(ctx, taskType = "DTO") {
    return xbeesPost(ctx, "/disputeReasonSubReason", {
        taskType, disputeRaisedType: "Client",
    }, "Dispute reasons");
}


function resolveDisputeReason(cmsReason, cmsSubReason, vocabulary) {
    const wantedReason = String(cmsReason || "").trim();
    const wantedSub = String(cmsSubReason || "").trim();
    if (!wantedReason || !wantedSub) {
        throw new Error("Missing disputeReason / disputeSubReason");
    }
    if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
        // Fall back to sending labels only. Xbees's error will be actionable.
        return { reason: wantedReason, subReason: wantedSub, disputereasonid: null, isimage: false, isvideo: false };
    }
    const rGroup =
        vocabulary.find((v) => v.reason === wantedReason) ||
        vocabulary.find((v) => normalizeLoose(v.reason) === normalizeLoose(wantedReason));
    if (!rGroup) {
        throw new Error(
            `Unknown disputeReason "${wantedReason}" — Xbees accepts: ${vocabulary.map((v) => v.reason).join(" | ")}`
        );
    }
    const subs = Array.isArray(rGroup.subReason) ? rGroup.subReason : [];
    const s =
        subs.find((x) => x.subReason === wantedSub) ||
        subs.find((x) => normalizeLoose(x.subReason) === normalizeLoose(wantedSub));
    if (!s) {
        throw new Error(
            `Unknown disputeSubReason "${wantedSub}" — Xbees accepts under "${rGroup.reason}": ${subs.map((x) => x.subReason).join(" | ")}`
        );
    }
    return {
        reason: rGroup.reason,
        subReason: s.subReason,
        disputereasonid: s.disputereasonid,
        isimage: !!s.isimage,
        isvideo: !!s.isvideo,
    };
}

// -----------------------------------------------------------------------------
// 📎 Presigned URL → S3 PUT → saveUploadedMedia (→ tempMediaId)
// -----------------------------------------------------------------------------
/**
 * Slot positions verified from the capture. Photo-side positions are
 * PhotoProof1_Front / PhotoProof2_Back / PhotoProof3_RightSide /
 * PhotoProof4_LeftSide. Video positions are UnboxingVideoProof1 /
 * PackagingVideoProof1.
 */
const PHOTO_SLOTS = ["PhotoProof1_Front", "PhotoProof2_Back", "PhotoProof3_RightSide", "PhotoProof4_LeftSide"];
const VIDEO_SLOTS = ["UnboxingVideoProof1", "PackagingVideoProof1"];

async function getPresignedUrl(ctx, { fileName, shippingid, contentType, type, position }) {
    const result = await xbeesPost(ctx, "/getPresignedUrl", {
        fileName, shippingid: String(shippingid), contentType, type, position,
    }, "Get presigned URL");
    if (!result?.uploadUrl || !result?.key) {
        throw xbeesApiError("Get presigned URL", "response missing uploadUrl / key");
    }
    return { uploadUrl: result.uploadUrl, s3Key: result.key };
}

async function putToS3(uploadUrl, filePath, contentType) {
    const stream = fs.createReadStream(filePath);
    const stat = fs.statSync(filePath);
    const res = await axios.put(uploadUrl, stream, {
        headers: {
            "content-type": contentType,
            "content-length": stat.size,
            // The presigned URL bakes in x-amz-acl=bucket-owner-full-control
            // — sending it back explicitly is safe and required by AWS's
            // strict validation of PUT headers vs the signed request.
            "x-amz-acl": "bucket-owner-full-control",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS * 5,
    });
    // Own request, so it does not pass through xbeesPost — log it here too.
    if (res.status >= 400) {
        logApiFailure({ platform: "xbees", step: "S3 PUT", method: "PUT", url: uploadUrl, status: res.status, data: res.data });
    }
    if (res.status < 200 || res.status >= 300) {
        throw xbeesApiError("S3 PUT", `HTTP ${res.status} ${String(res.data || "").slice(0, 200)}`);
    }
}

/**
 * POST /saveUploadedMedia
 * Body: { s3Key, type, position, shippingid, uploaderId }
 * Response: { tempMediaId, tinyURL }
 * The `tempMediaId` is what goes into raisedDispute's DisputeProdcutImageURL /
 * DisputeProductVideoURL arrays.
 */
async function saveUploadedMedia(ctx, { s3Key, type, position, shippingid, uploaderId }) {
    const result = await xbeesPost(ctx, "/saveUploadedMedia", {
        s3Key, type, position, shippingid: String(shippingid), uploaderId,
    }, "Save uploaded media");
    if (!result?.tempMediaId) {
        throw xbeesApiError("Save uploaded media", "response missing tempMediaId");
    }
    return { tempMediaId: result.tempMediaId, tinyURL: result.tinyURL || null };
}

/**
 * End-to-end upload for one file: presigned URL → S3 PUT → saveUploadedMedia.
 * Returns the tempMediaId.
 */
async function uploadOneMedia(ctx, { filePath, fileName, contentType, type, position, shippingid, uploaderId }) {
    const { uploadUrl, s3Key } = await getPresignedUrl(ctx, {
        fileName, shippingid, contentType, type, position,
    });
    await putToS3(uploadUrl, filePath, contentType);
    const { tempMediaId } = await saveUploadedMedia(ctx, {
        s3Key, type, position, shippingid, uploaderId,
    });
    return tempMediaId;
}

// -----------------------------------------------------------------------------
// ✅ Raise dispute (the submit)
// -----------------------------------------------------------------------------
/**
 * POST /raisedDispute
 * Body verified from the capture:
 *   {
 *     AWBNumber, ShipmentType: "DTO Shipment", DisputeAmount, DisputeReason,
 *     DisputeSubReason, Comments,
 *     DisputeProdcutImageURL: [{ PhotoProof1_Front, PhotoProof2_Back,
 *       PhotoProof3_RightSide, PhotoProof4_LeftSide }],
 *     DisputeProductVideoURL: [{ UnboxingVideoProof1, PackagingVideoProof1 }],
 *     SourceType: "ClientAPI", OtherProofs1, OtherProofs2, actionStatus: null
 *   }
 * Each *Proof value is a tempMediaId string (or null when the slot is empty).
 */
async function raiseDispute(ctx, {
    awbNumber, disputeAmount, disputeReason, disputeSubReason, comments,
    photoTempIds = {}, videoTempIds = {}, shipmentType = "DTO Shipment",
    otherProofs1 = "", otherProofs2 = "",
}) {
    assertClaimSubmitEnabled("xbees", "raise dispute");
    const body = {
        AWBNumber: String(awbNumber),
        ShipmentType: shipmentType,
        DisputeAmount: disputeAmount != null ? String(disputeAmount) : "",
        DisputeReason: disputeReason,
        DisputeSubReason: disputeSubReason,
        Comments: comments || "",
        DisputeProdcutImageURL: [{
            PhotoProof1_Front: photoTempIds.PhotoProof1_Front ?? null,
            PhotoProof2_Back: photoTempIds.PhotoProof2_Back ?? null,
            PhotoProof3_RightSide: photoTempIds.PhotoProof3_RightSide ?? null,
            PhotoProof4_LeftSide: photoTempIds.PhotoProof4_LeftSide ?? null,
        }],
        DisputeProductVideoURL: [{
            UnboxingVideoProof1: videoTempIds.UnboxingVideoProof1 ?? null,
            PackagingVideoProof1: videoTempIds.PackagingVideoProof1 ?? null,
        }],
        SourceType: "ClientAPI",
        OtherProofs1: otherProofs1,
        OtherProofs2: otherProofs2,
        actionStatus: null,
    };
    return xbeesPost(ctx, "/raisedDispute", body, "Raise dispute");
}

// -----------------------------------------------------------------------------
// 🎫 Dispute readback
// -----------------------------------------------------------------------------
/**
 * POST /disputeSummary — list of disputes for the seller (paged; filters).
 * POST /viewDisputeDetails — full detail for one dispute id.
 * Response shapes vary per Xbees release; probe common keys.
 */
async function getDisputeSummary(ctx, { awbNumber = "", pageNumber = 1, pageSize = 25 } = {}) {
    const body = { AWBNumber: awbNumber ? String(awbNumber) : "", pageNumber, pageSize };
    const result = await xbeesPost(ctx, "/disputeSummary", body, "Dispute summary");
    // Some builds return the list under `disputeList`; some under `data`.
    return result?.disputeList || result?.data || (Array.isArray(result) ? result : []) || [];
}

async function viewDisputeDetails(ctx, disputeId) {
    return xbeesPost(ctx, "/viewDisputeDetails", { disputeId: String(disputeId) }, "View dispute details");
}

async function findExistingDisputeByAwb(ctx, awbNumber) {
    const list = await getDisputeSummary(ctx, { awbNumber, pageSize: 5 });
    const hit = list.find((d) => String(d?.AWBNumber || d?.awbNumber) === String(awbNumber));
    if (!hit) return null;
    return {
        disputeId: hit.disputeId || hit.DisputeId || hit.id || null,
        status: hit.status || hit.disputeStatus || hit.Status || null,
        raw: hit,
    };
}

// -----------------------------------------------------------------------------
// 🗂️ Status mapping
// -----------------------------------------------------------------------------
const XBEES_TO_CMS_STATUS = {
    open: "In Review",
    in_review: "In Review",
    pending: "In Review",
    processing: "In Review",
    initiated: "In Review",
    approved: "Approved",
    resolved: "Approved",
    accepted: "Approved",
    rejected: "Rejected",
    denied: "Rejected",
    closed: "Approved",     // Xbees usually spells the terminal-approved state "closed"
    seller_action_required: "Awaiting Seller Response",
    awaiting_response: "Awaiting Seller Response",
};

function mapXbeesStatus(xbeesStatus) {
    if (!xbeesStatus) return null;
    const k = String(xbeesStatus).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return XBEES_TO_CMS_STATUS[k] || null;
}
function claimStatusToCmsStatus(xbeesStatus) { return mapXbeesStatus(xbeesStatus) || "Success"; }

module.exports = {
    loginXbeesApi,
    getDisputeReasons, resolveDisputeReason,
    getPresignedUrl, putToS3, saveUploadedMedia, uploadOneMedia,
    raiseDispute,
    getDisputeSummary, viewDisputeDetails, findExistingDisputeByAwb,
    mapXbeesStatus, claimStatusToCmsStatus, XBEES_TO_CMS_STATUS,
    PHOTO_SLOTS, VIDEO_SLOTS,
    apiHeaders, xbeesPost,
    // exported for tests / for the runner's tagged-error list
    xbeesBusinessError,
    CLIENT_SHIP_HOST, XBM_MASTER_HOST,
};
