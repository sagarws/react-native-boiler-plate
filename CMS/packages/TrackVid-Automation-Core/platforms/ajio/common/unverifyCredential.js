// Flip is_verified=false on a single AJIO credential right where the bad-password
// failure is detected.
//
// The master-data + ticket-download CRON controllers already batch this up at the
// end of a run (see markCredentialsUnverified). The CLAIM scripts have no such
// batching — they get one credential, fail its login, and move on — so they call
// this instead.
//
// markCredentialsUnverified needs a trackVidEmail to fetch that company's admin
// Bearer token, but the claim configs only carry companyId. So we resolve the
// admin user here when the caller can't supply the email.
//
// Failure mode: log only, never throw. The verified flag is a dashboard signal;
// it must never take down a claim run.

const { connectDB } = require("../../../common/db");
const { markCredentialsUnverified } = require("../../../common/markCredentialsUnverified");

/** Admin user for a company — same aggregation the master-data module uses. */
async function findAdminEmail(companyId) {
    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);

    const users = await db
        .collection("users")
        .aggregate([
            { $match: { companyId } },
            {
                $lookup: {
                    from: "roles",
                    localField: "role",
                    foreignField: "_id",
                    as: "roleDetails",
                },
            },
            { $unwind: "$roleDetails" },
            { $match: { "roleDetails.name": "admin" } },
            { $limit: 1 },
        ])
        .toArray();

    return users[0]?.email || null;
}

/**
 * @param {object}  cred
 * @param {string}  cred.companyId
 * @param {string}  cred.username        the AJIO login that failed
 * @param {string} [cred.trackVidEmail]  admin email; looked up when omitted
 * @param {string} [cred.platform]       defaults to "AJIO"
 * @param {object} [logger]              pino-style; falls back to console
 */
async function unverifyAjioCredential(
    { companyId, username, trackVidEmail, platform = "AJIO" } = {},
    logger
) {
    const log = logger || console;

    if (!companyId || !username) {
        log.warn?.(
            `⚠️ [unverifyAjioCredential] Missing companyId/username — skipping (companyId=${companyId}, username=${username})`
        );
        return;
    }

    try {
        const email = trackVidEmail || (await findAdminEmail(companyId));
        if (!email) {
            log.warn?.(
                `⚠️ [unverifyAjioCredential] No admin user for company ${companyId} — cannot unverify ${username}`
            );
            return;
        }

        await markCredentialsUnverified(
            [{ companyId: String(companyId), trackVidEmail: email, platform, username }],
            logger
        );
    } catch (err) {
        log.error?.(
            `🚨 [unverifyAjioCredential] Failed to unverify ${username}: ${err?.message}`
        );
    }
}

module.exports = { unverifyAjioCredential };
