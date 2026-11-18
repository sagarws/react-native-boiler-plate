const axios = require("axios");

// Calls POST {BASE_URL}/api/master-setting/mark-credentials-unverified once per
// affected company, using that company's admin Bearer token. Used after each
// master-data job to flip is_verified=false on credentials whose login failed
// with "password_changed".
//
// Inputs:
//   items  = [{ companyId, trackVidEmail, platform, username }, ...]
//   logger = optional pino-style logger ({ info, warn, error }). If omitted,
//            falls back to console — but every cron caller passes its own
//            logger so messages land in the same structured log stream the
//            team monitors. The Mattermost job report is sent before this
//            helper runs; this helper's logs are the only signal operators
//            get when the unverify call fails, so dropping them into console
//            (where the rest of the cron uses pino) tends to lose them.
//
// Failure mode: log only. The credential flag is a nice-to-have signal for
// the dashboard; we never want it to break the cron job's main report path.
async function markCredentialsUnverified(items, logger) {
    const log = pickLogger(logger);

    if (!Array.isArray(items) || items.length === 0) {
        return;
    }

    const baseUrl = process.env.BASE_URL;
    const profileUrl = process.env.TRACKVID_GET_USER_PROFILE_URL;
    if (!baseUrl || !profileUrl) {
        log.error(
            "🚨 [markCredentialsUnverified] Missing BASE_URL or TRACKVID_GET_USER_PROFILE_URL — skipping is_verified update."
        );
        return;
    }

    // Group by companyId so one token + one HTTP call serves all of that
    // company's failed credentials.
    const byCompany = new Map();
    for (const it of items) {
        const companyId = it.companyId ? String(it.companyId) : "";
        const email = it.trackVidEmail;
        const platform = it.platform;
        const username = it.username;
        if (!companyId || !email || !platform || !username) {
            log.warn(
                { companyId, email, platform, username },
                "⚠️ [markCredentialsUnverified] Skipping item with missing field"
            );
            continue;
        }
        if (!byCompany.has(companyId)) {
            byCompany.set(companyId, { trackVidEmail: email, accounts: [] });
        }
        byCompany.get(companyId).accounts.push({ platform, username });
    }

    for (const [companyId, { trackVidEmail, accounts }] of byCompany.entries()) {
        try {
            const profileResp = await axios.get(`${profileUrl}/user-profile`, {
                params: { email: trackVidEmail },
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                timeout: 30_000,
            });
            const token = profileResp.data?.data?.accessToken;
            if (!token) {
                log.error(
                    { companyId, trackVidEmail },
                    "🚨 [markCredentialsUnverified] No accessToken — skipping company."
                );
                continue;
            }

            // BASE_URL points at the BE host root (e.g. http://localhost:8000),
            // but BE mounts all routes under /api (server.ts: app.use("/api", routes)),
            // so the prefix is appended here rather than baked into the env var.
            const resp = await axios.post(
                `${baseUrl.replace(/\/$/, "")}/api/master-setting/mark-credentials-unverified`,
                { items: accounts },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 30_000,
                }
            );

            const data = resp.data?.data || {};
            log.info(
                {
                    companyId,
                    updated: data.updatedCount ?? null,
                    notFound: data.notFoundCount ?? null,
                },
                "🔒 [markCredentialsUnverified] is_verified flags updated."
            );
        } catch (error) {
            const status = error.response?.status;
            const upstream = error.response?.data?.message || error.message;
            log.error(
                { companyId, status: status || null, upstream },
                "🚨 [markCredentialsUnverified] Request failed."
            );
        }
    }
}

// Accept any pino-compatible logger; fall back to a console-backed shim for
// callers that don't pass one. The shim normalizes pino's (obj, msg) call
// signature so callers can use one shape regardless of which logger they got.
function pickLogger(logger) {
    if (logger && typeof logger.warn === "function" && typeof logger.error === "function") {
        return logger;
    }
    return {
        info: (obj, msg) => console.log(msg || obj, msg ? obj : ""),
        warn: (obj, msg) => console.warn(msg || obj, msg ? obj : ""),
        error: (obj, msg) => console.error(msg || obj, msg ? obj : ""),
    };
}

module.exports = { markCredentialsUnverified };
