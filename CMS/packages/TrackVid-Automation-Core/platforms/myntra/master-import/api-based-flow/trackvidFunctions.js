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
const { filterUnverifiedCredentials } = require("../../../../common/filterUnverifiedCredentials");
const logger = require("../../../../common/redactingLogger");
const { getAdminUserByCompanyId, getCompaniesUsingMasterData } = require("../../../../common/trackvidQueries");
// getUsersByCompanyId was this module's name for it; keep the export stable.
const getUsersByCompanyId = getAdminUserByCompanyId;


// ─── Company & User lookups (mirror snapdeal) ─────────────────────────────


async function updateMasterSyncDate(companyIds, platform = "MYNTRA", { field = "masterDataSync" } = {}) {
    logger.info(`📌 Inside updateMasterSyncDate for platform: ${platform}`);

    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);

    try {
        const syncField = `${field}.${platform.toLowerCase()}`;
        const updateOps = companyIds.map((companyId) =>
            db.collection("companies").updateOne(
                { _id: new (loadObjectId())(companyId) },
                { $set: { [syncField]: new Date() } }
            )
        );

        const results = await Promise.all(updateOps);
        logger.info(`✅ ${syncField} updated for ${companyIds.length} companies`);
        return results;
    } catch (error) {
        logger.error({ err: error }, `❌ Error updating ${field}.${platform.toLowerCase()}`);
        throw error;
    }
}

async function userProfile(email) {
    const url = process.env.TRACKVID_GET_USER_PROFILE_URL;
    const response = await axios.get(`${url}/user-profile`, {
        params: { email },
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
    });
    return response.data;
}

// Uploads the downloaded report file to TrackVid via the Myntra master import
// endpoint. Mirrors importSnapdealData but targets /api/v2/myntra-master/import.
const MYNTRA_REPORT_TYPE_MAP = {
    returnReport: "Myntra Returns Report",
    orderReport: "Myntra Orders Report",
};

function normalizeMyntraReportType(reportType) {
    return MYNTRA_REPORT_TYPE_MAP[reportType] || reportType;
}

async function importMyntraData(reportType, filePath, userData, plateForm, username) {
    const url = process.env.MASTER_SERVER_BASE_URL + "/api/v2/myntra-master/import";
    const token = userData?.data?.accessToken;
    const MAX_RETRIES = 3;
    const normalizedReportType = normalizeMyntraReportType(reportType);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const formData = new FormData();
            formData.append("file", fs.createReadStream(filePath));
            formData.append("importPlatform", plateForm);
            formData.append("username", username);
            formData.append("reportType", normalizedReportType);

            console.log(`📤 Uploading Myntra report to ${url} (${normalizedReportType})`);
            const response = await axios.post(url, formData, {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${token}`,
                },
                timeout: 120000,
            });

            console.log(`✅ Myntra data imported successfully: ${reportType}`);
            return { data: response.data };
        } catch (error) {
            console.error(
                `⚠️ importMyntraData attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
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

async function importMyntraDataToTrackVid({ reportType, filePath, user }) {
    console.log(`📥 importMyntraDataToTrackVid :: ${user.trackVidEmail}`);
    try {
        const profile = await userProfile(user.trackVidEmail);
        const result = await importMyntraData(
            reportType,
            filePath,
            profile,
            user.plateForm,
            user.username
        );

        if (result.error) return { error: result.error };

        // Cleanup local file once the backend has accepted it
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Removed local file after upload: ${filePath}`);
        }
        return result.data;
    } catch (error) {
        console.error(`🚨 importMyntraDataToTrackVid failed: ${error.message}`);
        return { error: error.message };
    }
}

module.exports = {
    getCompaniesUsingMasterData,
    getUsersByCompanyId,
    updateMasterSyncDate,
    importMyntraDataToTrackVid,
};
