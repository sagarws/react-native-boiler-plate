/**
 * TrackVid database reads shared by the master-import flows.
 *
 * Each platform's trackvidFunctions.js carried its own copy of these, differing
 * only in formatting. The writes stay per-platform — each writes a different
 * masterDataSync field — so only the reads live here.
 */

const { connectDB } = require("./db");
const { filterUnverifiedCredentials } = require("./filterUnverifiedCredentials");
const defaultLogger = require("./redactingLogger");

/**
 * The one admin user for a company, or null. Used as the TrackVid identity that
 * an import is attributed to.
 */
async function getAdminUserByCompanyId(companyId) {
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

	return users[0] || null;
}

/**
 * Every company with settings.isUsingMasterData, with unverified credentials
 * stripped out in place.
 */
async function getCompaniesUsingMasterData(logger = defaultLogger) {
	try {
		const client = await connectDB();
		const db = client.db(process.env.DB_NAME);
		logger.info(
			`🔍 Fetching ALL companies with isUsingMasterData = true from DB: ${process.env.DB_NAME}...`
		);

		const companies = await db
			.collection("companies")
			.find({ "settings.isUsingMasterData": true })
			.toArray();

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

module.exports = { getAdminUserByCompanyId, getCompaniesUsingMasterData };
