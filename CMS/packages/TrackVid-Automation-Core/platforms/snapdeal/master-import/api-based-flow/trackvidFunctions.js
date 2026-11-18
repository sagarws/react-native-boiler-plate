const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
// Required where it is used, not at module scope. Trackvid-CMS runs this same
// upload — importXDataToTrackVid POSTs the report over HTTP and needs no
// database — but has no `mongodb` installed, and a top-level require made the
// whole module unimportable there. Only updateMasterSyncDate touches Mongo.
const loadObjectId = () => require("mongodb").ObjectId;
const { loadEnv } = require("../../../../common/loadEnv");
loadEnv();
const { connectDB } = require("../../../../common/db");
const { logError } = require("../../../../common/errorHandler");
const { filterUnverifiedCredentials } = require("../../../../common/filterUnverifiedCredentials");
const logger = require("../../../../common/redactingLogger");
const { getAdminUserByCompanyId, getCompaniesUsingMasterData } = require("../../../../common/trackvidQueries");
// getUsersByCompanyId was this module's name for it; keep the export stable.
const getUsersByCompanyId = getAdminUserByCompanyId;


// ─── Company & User lookups (mirror meesho) ───────────────────────────────


/**
 * Stamp the sync date on the CREDENTIALS that succeeded (not the whole company).
 * See masterDataImport/utils/trackvidFunctions.js for the full rationale — one
 * company-level date meant a single failing account held back all its siblings.
 *
 * The company-level `masterDataSync` is no longer written; the field and its
 * existing values are left in place to be removed separately.
 *
 * @param {Array<{companyId: string, credentialId: string, username?: string}>} credentials
 * @param {string} [platform="SNAPDEAL"]
 */
async function updateMasterSyncDate(credentials, platform = "SNAPDEAL", { field = "masterDataSync" } = {}) {
    logger.info(`📌 Inside updateMasterSyncDate (per-credential) for platform: ${platform}`);

    const list = (credentials || []).filter((c) => c?.companyId && c?.credentialId);
    const missingId = (credentials || []).length - list.length;
    if (missingId > 0) {
        logger.warn(`⚠️ ${missingId} successful entr(ies) had no credentialId — cannot stamp sync date`);
    }
    if (list.length === 0) return [];

    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);
    // Epoch milliseconds (Number), not a BSON Date — see the AJIO helper
    // (masterDataImport/utils/trackvidFunctions.js) for the rationale.
    const now = Date.now();

    try {
        const results = await Promise.all(
            list.map((cred) =>
                db.collection("companies").updateOne(
                    { _id: new (loadObjectId())(cred.companyId) },
                    {
                        $set: {
                            [`settings.eCommercePlatformLoginInfo.$[plat].info.$[acc].${field}`]: now,
                        },
                    },
                    {
                        arrayFilters: [
                            { "plat.eComPlatform": { $regex: `^${platform}$`, $options: "i" } },
                            { "acc._id": new (loadObjectId())(cred.credentialId) },
                        ],
                    }
                )
            )
        );

        const matched = results.filter((r) => r.modifiedCount > 0).length;
        logger.info(`✅ ${platform} ${field} stamped on ${matched}/${list.length} credential(s)`);
        return results;
    } catch (error) {
        logger.error({ err: error }, `❌ Error updating per-credential ${field} (${platform})`);
        throw error;
    }
}

async function userProfile(email) {
    const url = process.env.TRACKVID_GET_USER_PROFILE_URL;
    const response = await axios.get(
        `${url}/user-profile`,
        {
            params: { email },
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
        }
    );
    return response.data;
}


async function importSnapdealData(reportType, filePath, userData, plateForm, username) {
    const url = process.env.MASTER_SERVER_BASE_URL + '/api/v2/snapdeal-master/import';
    const token = userData?.data?.accessToken;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const formData = new FormData();
            formData.append("file", fs.createReadStream(filePath));
            formData.append("importPlatform", plateForm);
            formData.append("username", username);
            formData.append("reportType", reportType);

            console.log(`📤 Uploading Snapdeal report to ${url}`);
            const response = await axios.post(url, formData, {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${token}`,
                },
                timeout: 120000,
            });

            console.log(`✅ Snapdeal data imported successfully: ${reportType}`);
            return { data: response.data };
        } catch (error) {
            console.error(
                `⚠️ importSnapdealData attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
            );
            if (attempt === MAX_RETRIES) {
                const errorMessage = error.response?.data?.message || error.message;
                console.error(`❌ All ${MAX_RETRIES} attempts failed: ${errorMessage}`);
                return { error: errorMessage };
            }
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}


async function importSnapdealDataToTrackVid({ reportType, filePath, user }) {
    console.log(`📥 importSnapdealDataToTrackVid :: ${user.trackVidEmail}`);
    try {
        const profile = await userProfile(user.trackVidEmail);
        const result = await importSnapdealData(
            reportType,
            filePath,
            profile,
            user.plateForm,
            user.username
        );

        if (result.error) {
            return { error: result.error };
        }

        // Cleanup local file once the backend has accepted it
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Removed local file after upload: ${filePath}`);
        }
        return result.data;
    } catch (error) {
        console.error(`🚨 importSnapdealDataToTrackVid failed: ${error.message}`);
        return { error: error.message };
    }
}

module.exports = {
    getCompaniesUsingMasterData,
    getUsersByCompanyId,
    updateMasterSyncDate,
    importSnapdealDataToTrackVid,
};
