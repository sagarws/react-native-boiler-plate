// Required where it is used, not at module scope — see the sibling platforms.
// Trackvid-CMS runs this same upload over HTTP and has no `mongodb` installed.
const loadObjectId = () => require("mongodb").ObjectId;
const { loadEnv } = require("../../../../common/loadEnv");
loadEnv();
const { connectDB } = require("../../../../common/db");
const fs = require('fs')
const path = require('path')
const axios = require('axios');
const FormData = require("form-data");
const { logError } = require("../../../../common/errorHandler");
const { normalizeUsername } = require("../../../../common/text");
const { filterUnverifiedCredentials } = require("../../../../common/filterUnverifiedCredentials");
const logger = require("../../../../common/logger");
const { getAdminUserByCompanyId } = require("../../../../common/trackvidQueries");
// getUsersByCompanyId was this module's name for it; keep the export stable.
const getUsersByCompanyId = getAdminUserByCompanyId;


async function getCompaniesUsingMasterData() {
    try {
      const client = await connectDB();
      const db = client.db(process.env.DB_NAME);
      logger.info(`🔍 Fetching ALL companies with isUsingMasterData = true from DB: ${process.env.DB_NAME}...`);
  
      // Sort by _id so the seller processing order is DETERMINISTIC and identical
      // every run (MongoDB natural order is not stable). This keeps this job and
      // the AJIO ticket-download job in the same order, so they never hit the same
      // AJIO account at the same moment during any schedule overlap.
      const companies = await db.collection("companies").find({ "settings.isUsingMasterData": true }).sort({ _id: 1 }).toArray();

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
 * Stamp the sync date on the CREDENTIALS that actually succeeded.
 *
 * Replaces the old company-level `masterDataSync.ajio`. That single date meant one
 * failing account held back every other account in the same company — 4 healthy
 * logins re-pulled 89 days of history because the 5th failed. Each credential now
 * carries its own `masterDataSync`, so accounts advance independently.
 *
 * Targets the sub-document via arrayFilters:
 *   settings.eCommercePlatformLoginInfo.$[plat].info.$[acc].masterDataSync
 * matching the credential by its own _id — usernames are not unique across
 * platforms, and a company can hold the same login under two marketplaces.
 *
 * The company-level `masterDataSync` is intentionally NOT written any more. The
 * field and its existing values are left untouched (to be removed separately).
 *
 * `field` picks the credential field to stamp — `masterDataSync` by default.
 * The server passes `serverMasterDataSync`: the desktop app stamps
 * `masterDataSync` (through TrackVid-BE) for its own runs, and one shared field
 * meant whichever runner went first made the other skip the credential as
 * "already synced today". The meesho/snapdeal/myntra writers take the same option.
 *
 * @param {Array<{companyId: string, credentialId: string, username?: string}>} credentials
 * @param {string} [platform="AJIO"]  matched case-insensitively against eComPlatform
 */
async function updateMasterSyncDate(credentials, platform = "AJIO", { field = "masterDataSync" } = {}) {
    logger.info("📌 Inside updateMasterSyncDate (per-credential)");

    const list = (credentials || []).filter((c) => c?.companyId && c?.credentialId);
    const missingId = (credentials || []).length - list.length;
    if (missingId > 0) {
        logger.warn(
            `⚠️ ${missingId} successful entr(ies) had no credentialId — cannot stamp their sync date`
        );
    }
    if (list.length === 0) return [];

    const client = await connectDB();
    const db = client.db(process.env.DB_NAME);
    // Epoch milliseconds (Number), not a BSON Date — stored this way so sync
    // times compare with plain numeric operators everywhere (queries, filters,
    // JS) without any date parsing. Readers use `new Date(ms)` / `dayjs(ms)`,
    // both of which accept a number directly.
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
        logger.info(
            `✅ ${platform} ${field} stamped on ${matched}/${list.length} credential(s)`
        );
        return results;
    } catch (error) {
        logger.error({ err: error }, `❌ Error updating per-credential ${field} (${platform})`);
        throw error; // rethrow to be handled upstream if needed
    }
}

//Main function
async function importMasterDataToTrackVid(reportType, filePath, user) {
    logger.info(`importMasterDataToTrackVid function called :: ${user.trackVidEmail}`);
    const moduleName = "importMasterDataToTrackVid";
    try {
        //Login TrackVid user first
        const data = await userProfile(user.trackVidEmail);
        const masterData = await importMasterData(reportType, filePath, data, user.plateForm,user.username)
        //Unlink file after uploading data properly.
        if (masterData.error) {
            return { error: masterData.error };
        }
        fs.unlinkSync(filePath)
        return masterData.data
    } catch (error) {
        logger.error({ err: error }, `🚨 Error processing importMasterDataToTrackVid user ${user.trackVidEmail}`);
        logError({
            fileName: "importData.js",
            moduleName,
            errorType: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            user: user.username,
        });
        throw error;
    }
}

//Get user profile of config user
async function userProfile(email) {
    const moduleName = "userProfile";
    const url = process.env.TRACKVID_GET_USER_PROFILE_URL;
    try {
        //Axios call for login api from TrackVid backend
        const response = await axios.get(`${url}/user-profile`,
            { params: { email: email } }, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        });
        return response.data?.data;
    } catch (error) {
        logger.error({ err: error }, "❌ Error get user profile ::");
        logError({
            fileName: "importData.js",
            moduleName,
            url,
            errorType: error.name,
            errorMessage: error.message,
            email,
        });
        throw error;
    }

}

//Import excel file data into master import api
async function importMasterData(reportType, filePath, userData, plateForm,email) {
    logger.info("📥 Importing master data to TrackVid...");
    const moduleName = "importMasterData";
    const url = process.env.TRACKVID_IMPORTDATA_API_URL;
    const token = userData.accessToken;

    const MAX_RETRIES = 3;
    const BASE_DELAY = 5000; // 5 seconds base delay

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const formData = new FormData();
            formData.append("importPlatform", plateForm);
            /*
             * TRIMMED, and this is the whole reason the upload 400s.
             *
             * This field is the seller account each imported row is tagged
             * with (`ajio_account_email`), and it is `user.username` — the
             * credential's portal login. The backend validates it with
             * `Joi.string().email()`, which does NOT trim, so a login stored
             * as "seller123@example.com " — one trailing space an operator
             * typed years ago — is rejected with `"email" must be a valid
             * email` before the file is even looked at.
             *
             * The report downloads perfectly first, so the run burns its full
             * time and dies on the last call, on a whitespace character. Of
             * 396 stored AJIO logins, 392 are clean and 4 are not, which is
             * why this looked like an intermittent backend fault rather than
             * a data problem.
             *
             * `normalizeUsername` is the shared normaliser every session store
             * and claim flow already matches credentials with, so this agrees
             * with how the username is compared everywhere else.
             */
            formData.append("email", normalizeUsername(email));
            if (reportType === "Dropship Rtv Report") {
                formData.append("DropshipRtvFile", fs.createReadStream(filePath));
            } else {
                formData.append("DropshipOrderFile", fs.createReadStream(filePath));
            }

            const response = await axios.post(url, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...formData.getHeaders(),
                },
                timeout: 120000, // 2-minute timeout
            });

            logger.info(`✅ API call succeeded on attempt ${attempt}`);
            return response.data;

        } catch (error) {
            const isLastAttempt = attempt === MAX_RETRIES;

            /**
             * WHAT THE SERVER ACTUALLY SAID.
             *
             * `error.message` is "Request failed with status code 400" and
             * nothing else — which is true of four different refusals this
             * endpoint makes:
             *
             *   At least one file is required
             *   Unsupported platform: <what was sent>
             *   Unknown file type: <field> for platform <platform>
             *   <mime> is not supported. Please upload an Excel file.
             *
             * Without the body, a 400 here is four bugs wearing one message and
             * the only way to tell them apart was to read the server's source.
             */
            const status = error.response?.status;
            const body = error.response?.data;
            const said =
                typeof body === "string"
                    ? body.slice(0, 300)
                    : body
                        ? JSON.stringify(body).slice(0, 300)
                        : null;

            /*
             * THE ERROR OBJECT IS NOT LOGGED WHOLE, and that is deliberate.
             *
             * An axios error carries `config.headers`, and this request's
             * headers carry `Authorization: Bearer <token>` — so `{ err: error }`
             * wrote a live access token into the log file, and into anything the
             * log was later pasted into. What is useful here is the status, the
             * server's sentence and the file; none of that needs the token.
             */
            logger.warn(
                {
                    attempt,
                    status: status ?? "no response",
                    said: said ?? "(the server sent no body)",
                    file: path.basename(filePath),
                    plateForm,
                    reportType,
                },
                `⚠️ Attempt ${attempt} failed`
            );

            logError({
                fileName: "importData.js",
                moduleName,
                url,
                errorType: error.name,
                // The server's own words first — `error.message` is the same
                // sentence for every refusal it makes.
                errorMessage: said ? `HTTP ${status}: ${said}` : error.message,
                plateForm,
                attempt,
            });

            if (isLastAttempt) {
                logger.error("❌ All attempts to call API failed.");
                return {
                    success: false,
                    error: "All API retries failed. Please check logs and retry manually.",
                };
            }

            // Exponential backoff delay before retrying
            const delay = BASE_DELAY * attempt;
            logger.info(`⏳ Retrying in ${delay / 1000} seconds...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

module.exports = { getCompaniesUsingMasterData, getUsersByCompanyId, updateMasterSyncDate, importMasterDataToTrackVid};