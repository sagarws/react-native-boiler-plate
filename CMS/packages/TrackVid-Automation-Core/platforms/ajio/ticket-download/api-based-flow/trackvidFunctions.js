const { loadEnv } = require("../../../../common/loadEnv");
loadEnv({ path: __dirname + "/../.env" });
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { connectDB } = require("../../../../common/db");
const { filterUnverifiedCredentials } = require("../../../../common/filterUnverifiedCredentials");
const { logError } = require("../../../../common/errorHandler");
const logger = require("../../../../common/logger");

// Company-level opt-in flag. Independent of Master Data Import so enabling ticket
// download does not force a master-data sync (and vice-versa). Override in .env.
// Sellers to run for. Defaults to the same set as Master Data Import
// (settings.isUsingMasterData). Override via TICKET_COMPANY_FLAG in .env.
const TICKET_COMPANY_FLAG = process.env.TICKET_COMPANY_FLAG || "isUsingMasterData";

/**
 * Fetch all companies that have opted into AJIO ticket auto-download.
 * Mirrors getCompaniesUsingMasterData but keyed on settings.<TICKET_COMPANY_FLAG>.
 */
async function getCompaniesUsingTicketAutoFetch() {
    try {
        const client = await connectDB();
        const db = client.db(process.env.DB_NAME);
        const flagPath = `settings.${TICKET_COMPANY_FLAG}`;
        logger.info(`🔍 Fetching companies with ${flagPath} = true from DB: ${process.env.DB_NAME}...`);

        // Sort by _id so the seller order is DETERMINISTIC and identical every run
        // — and matches masterDataImport's order — so the two jobs never touch the
        // same AJIO account at the same moment during schedule overlap.
        const companies = await db.collection("companies").find({ [flagPath]: true }).sort({ _id: 1 }).toArray();

        // Drop AJIO logins already flagged as unverified (password changed etc.)
        filterUnverifiedCredentials(companies, logger);

        if (companies.length === 0) {
            logger.warn(`⚠️ No companies found with ${flagPath} = true`);
        } else {
            logger.info(`✅ Found ${companies.length} companies opted into ticket auto-download.`);
        }
        return companies;
    } catch (err) {
        logger.error({ err }, "❌ Error fetching ticket-auto-download companies");
        throw err;
    }
}

/**
 * Fetch companies that have an AJIO login matching any of `usernames`.
 * Used by the TICKET_ONLY_USERNAMES test override to run a specific short list
 * (e.g. one normal + one enterprise account) without setting any opt-in flag.
 */
async function getCompaniesByAjioUsernames(usernames) {
    const wanted = usernames.map((u) => u.trim().toLowerCase()).filter(Boolean);
    if (!wanted.length) return [];
    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);
    logger.info(`🔍 [test override] Fetching companies with AJIO logins: ${wanted.join(", ")}`);

    // Match companies whose eCommercePlatformLoginInfo has an AJIO entry with one
    // of the target usernames. Case-insensitive match is done in JS after fetch.
    const companies = await db.collection("companies").find({
        "settings.eCommercePlatformLoginInfo": {
            $elemMatch: {
                eComPlatform: "AJIO",
                "info.username": { $in: usernames.concat(wanted) },
            },
        },
    }).sort({ _id: 1 }).toArray();

    filterUnverifiedCredentials(companies, logger);
    logger.info(`✅ [test override] Found ${companies.length} matching companies.`);
    return companies;
}

/**
 * The admin user of a company — used as the TrackVid uploader identity.
 */
async function getAdminUserByCompanyId(companyId) {
    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);

    const users = await db.collection("users").aggregate([
        { $match: { companyId } },
        { $lookup: { from: "roles", localField: "role", foreignField: "_id", as: "roleDetails" } },
        { $unwind: "$roleDetails" },
        { $match: { "roleDetails.name": "admin" } },
        { $limit: 1 },
    ]).toArray();

    return users[0] || null;
}

/**
 * Resolve a TrackVid user's profile (for the access token used on upload).
 */
async function userProfile(email) {
    const url = process.env.TRACKVID_GET_USER_PROFILE_URL;
    try {
        const response = await axios.get(`${url}/user-profile`, {
            params: { email },
            headers: { "Content-Type": "application/json", Accept: "application/json" },
        });
        return response.data?.data;
    } catch (error) {
        logger.error({ err: error }, "❌ Error getting TrackVid user profile");
        logError({
            fileName: "ajioTicketDownload/trackvidFunctions.js",
            moduleName: "userProfile",
            url,
            errorType: error.name,
            errorMessage: error.message,
            email,
        });
        throw error;
    }
}

// TrackVid API base (main API). The two bulk-status endpoints live under it.
const TRACKVID_API_BASE = (process.env.TRACKVID_API_BASE || "https://api.trackvid.in/api").replace(/\/+$/, "");
const CMS_BULK_URL = process.env.TRACKVID_BULK_STATUS_URL || `${TRACKVID_API_BASE}/cms/bulk-status-update`;
const RD_BULK_URL = process.env.TRACKVID_RD_BULK_STATUS_URL || `${TRACKVID_API_BASE}/master/bulk-status-update-return-dispute`;
const TICKET_MARKETPLACE = process.env.TICKET_MARKETPLACE || "AJIO";

// Pull a short human summary (message + any row counts) from a bulk-status body.
function summarizeBody(body) {
    if (!body || typeof body !== "object") return "";
    const parts = [];
    if (body.message) parts.push(body.message);
    const d = body.data || body;
    const n = (v) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : undefined);
    const updated = n(d.updated), skipped = n(d.skipped), notFound = n(d.notFound);
    const counts = [];
    if (updated !== undefined) counts.push(`updated=${updated}`);
    if (skipped !== undefined) counts.push(`skipped=${skipped}`);
    if (notFound !== undefined) counts.push(`notFound=${notFound}`);
    if (counts.length) parts.push(`(${counts.join(", ")})`);
    return parts.join(" ");
}

// POST the report to one bulk-status endpoint (multipart: file + marketplace).
// The endpoint derives companyId from the bearer token. Retries with backoff.
// SUCCESS = HTTP 2xx AND body.isSuccess !== false (these controllers can return
// 200 with isSuccess:false on validation problems, so status alone is not enough).
async function postBulkStatus(url, filePath, token, moduleName) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const formData = new FormData();
            formData.append("marketplace", TICKET_MARKETPLACE);
            formData.append("file", fs.createReadStream(filePath)); // fresh stream per attempt
            const response = await axios.post(url, formData, {
                headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() },
                timeout: 120000,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            const body = response.data;
            const summary = summarizeBody(body);
            if (body && body.isSuccess === false) {
                // 2xx but the API says it failed — treat as failure (no retry; it's deterministic).
                logger.warn(`❌ ${moduleName} returned isSuccess:false — ${summary}`);
                return { ok: false, error: body.message || "isSuccess:false", summary };
            }
            logger.info(`✅ ${moduleName} ok (attempt ${attempt}) — ${summary || "success"}`);
            return { ok: true, data: body, summary };
        } catch (error) {
            const status = error.response?.status;
            const body = error.response?.data;
            logger.warn({ status, body }, `⚠️ ${moduleName} attempt ${attempt} failed: ${error.message}`);
            logError({
                fileName: "ajioTicketDownload/trackvidFunctions.js",
                moduleName,
                url,
                errorType: error.name,
                errorMessage: `HTTP ${status || "?"} ${error.message} :: ${JSON.stringify(body || {})}`,
                attempt,
            });
            // Don't retry deterministic client errors (auth/permission/validation).
            if (status && status >= 400 && status < 500) {
                return { ok: false, error: `HTTP ${status}: ${body?.message || error.message}` };
            }
            if (attempt === MAX_RETRIES) return { ok: false, error: body?.message || error.message };
            await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
    }
}

/**
 * Upload a downloaded AJIO ticket report to TrackVid by calling BOTH bulk-status
 * APIs, one after the other, with the same .xlsx:
 *   1) POST /cms/bulk-status-update
 *   2) POST /master/bulk-status-update-return-dispute
 * Both take multipart { marketplace, file } and identify the company from the
 * bearer token (the company admin's accessToken). The file is deleted only if
 * BOTH calls succeed; otherwise it is kept on disk for retry.
 */
async function uploadTicketReportToTrackVid(filePath, user) {
    if (process.env.TICKET_UPLOAD_ENABLED !== "true") {
        logger.warn(`⏭️ TrackVid upload disabled — keeping ${filePath} on disk (set TICKET_UPLOAD_ENABLED=true to enable).`);
        return { uploaded: false, skipped: true, filePath };
    }
    if (!user.trackVidEmail) {
        return { uploaded: false, error: "No trackVidEmail (admin) for this company — cannot get access token." };
    }

    const profile = await userProfile(user.trackVidEmail);
    const token = profile?.accessToken;
    if (!token) return { uploaded: false, error: "Could not resolve TrackVid access token." };

    // Call the two APIs one by one (CMS first, then Return Dispute).
    const cms = await postBulkStatus(CMS_BULK_URL, filePath, token, "bulk-status-update");
    const rd = await postBulkStatus(RD_BULK_URL, filePath, token, "bulk-status-update-return-dispute");

    // Pull updated/notFound counts from each API body for the run summary.
    const counts = (r) => {
        const d = r.ok ? (r.data?.data || r.data || {}) : {};
        return {
            ok: r.ok,
            updated: d.updatedCount ?? (Array.isArray(d.updated) ? d.updated.length : null),
            notFound: d.notFoundCount ?? (Array.isArray(d.notFound) ? d.notFound.length : null),
            error: r.ok ? null : r.error,
        };
    };
    const apiCounts = { cms: counts(cms), rd: counts(rd) };

    if (cms.ok && rd.ok) {
        try {
            fs.unlinkSync(filePath);
            logger.info(`🗑️ Deleted local report after upload: ${filePath}`);
        } catch (e) {
            // e.g. file open in Excel (a ~$lock exists). Not fatal — the next run's
            // sweepTempFiles() will remove it.
            logger.warn(`⚠️ Could not delete ${filePath} (${e.message}); will be swept next run.`);
        }
        return { uploaded: true, counts: apiCounts };
    }
    return {
        uploaded: false,
        counts: apiCounts,
        error: `cms=${cms.ok ? "ok" : cms.error} | returnDispute=${rd.ok ? "ok" : rd.error}`,
    };
}

module.exports = {
    getCompaniesUsingTicketAutoFetch,
    getCompaniesByAjioUsernames,
    getAdminUserByCompanyId,
    uploadTicketReportToTrackVid,
};
