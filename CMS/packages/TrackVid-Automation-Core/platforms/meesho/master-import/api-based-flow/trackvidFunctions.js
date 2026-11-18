// Required where it is used, not at module scope. Trackvid-CMS runs this same
// upload — importXDataToTrackVid POSTs the report over HTTP and needs no
// database — but has no `mongodb` installed, and a top-level require made the
// whole module unimportable there. Only updateMasterSyncDate touches Mongo.
const loadObjectId = () => require("mongodb").ObjectId;
const { loadEnv } = require("../../../../common/loadEnv");
const { normalizeUsername } = require("../../../../common/text");
loadEnv();
const { connectDB } = require("../../../../common/db");
const fs = require('fs')
const axios = require('axios');
const FormData = require("form-data");
const { logError } = require("../../../../common/errorHandler");
const { filterUnverifiedCredentials } = require("../../../../common/filterUnverifiedCredentials");
const logger = require("../../../../common/redactingLogger");
const { getAdminUserByCompanyId } = require("../../../../common/trackvidQueries");
// getUsersByCompanyId was this module's name for it; keep the export stable.
const getUsersByCompanyId = getAdminUserByCompanyId;


async function getCompaniesUsingMasterData() {
  try {
    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);
    logger.info(`🔍 Fetching ALL companies with isUsingMasterData = true from DB: ${process.env.DB_NAME}...`);

    const companies = await db.collection("companies").find({ "settings.isUsingMasterData": true }).toArray();

    filterUnverifiedCredentials(companies, logger);

    if (companies.length === 0) {
      logger.warn("⚠️ No companies found with isUsingMasterData = true");
    } else {
      logger.info(`✅ Found ${companies.length} companies using master data.`);
    }
    return companies;
  } catch (err) {
    logger.error({ err }, "❌ Error while fetching companies with isUsingMasterData = true");
    throw err;
  }
}


/**
 * Stamp the sync date on the CREDENTIALS that succeeded (not the whole company).
 * See masterDataImport/utils/trackvidFunctions.js for the full rationale.
 *
 * The company-level `masterDataSync` is no longer written; the field and its
 * existing values are left in place to be removed separately.
 *
 * @param {Array<{companyId: string, credentialId: string, username?: string}>} credentials
 * @param {string} [platform="MEESHO"]
 */
async function updateMasterSyncDate(credentials, platform = "MEESHO", { field = "masterDataSync" } = {}) {
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
      list.map(cred =>
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

    const matched = results.filter(r => r.modifiedCount > 0).length;
    logger.info(`✅ ${platform} ${field} stamped on ${matched}/${list.length} credential(s)`);
    return results;

  } catch (error) {
    logger.error({ err: error }, `❌ Error updating per-credential ${field} (${platform})`);
    throw error;
  }
}

async function importMasterDataToTrackVid(reportType, filePath, user) {

  logger.info(`importMasterDataToTrackVid function called :: ${user.trackVidEmail}`);
  const moduleName = "importMasterDataToTrackVid";
  try {
    //Login TrackVid user first
    const data = await userProfile(user.trackVidEmail);
    const masterData = await importMasterData(reportType, filePath, data, user.plateForm, user.username)
    //Unlink file after uploading data properly.
    if (masterData.error) {
      return { error: masterData.error };
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return masterData.data
  } catch (error) {
    logger.error({ err: error }, `🚨 Error processing importMasterDataToTrackVid user ${user.trackVidEmail}`);
    logError({
      fileName: "trackvidFunctions.js",
      moduleName,
      errorType: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    return { error: error.message };
  }
}

async function userProfile(email) {
  const url = process.env.TRACKVID_GET_USER_PROFILE_URL

  const response = await axios.get(`${url}/user-profile`,
    { params: { email: email } },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
  return response.data;
}

async function importMasterData(reportType, filePath, userData, plateForm, email) {
  logger.info("📥 Importing master data to TrackVid...");
  const url = process.env.MASTER_SERVER_BASE_URL + '/api/v2/meesho-master/import';
  const token = userData?.data?.accessToken;
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));
      formData.append('importPlatform', plateForm);
      // Trimmed for the same reason as AJIO's uploader: this is the
      // credential's portal login, the backend validates it as an email, and
      // a login stored with a trailing space fails validation after the whole
      // report has already been fetched. See the note there.
      formData.append('email', normalizeUsername(email));
      formData.append('reportType', reportType);
      console.log({ url });
      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${token}`,
        },
        timeout: 120000,
      });

      logger.info(`✅ Master data imported successfully: ${reportType}`);
      return { data: response.data };

    } catch (error) {
      logger.error({ attempt, err: error.message }, `⚠️ Attempt ${attempt}/${MAX_RETRIES} failed`);

      if (attempt === MAX_RETRIES) {
        const errorMessage = error.response?.data?.message || error.message;
        logger.error(`❌ All ${MAX_RETRIES} attempts failed for importMasterData: ${errorMessage}`);
        return { error: errorMessage };
      }

      // Wait before retry (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      logger.info(`⏳ Retrying in ${delay / 1000} seconds...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

module.exports = {
  getCompaniesUsingMasterData,
  getUsersByCompanyId,
  updateMasterSyncDate,
  importMasterDataToTrackVid
};
