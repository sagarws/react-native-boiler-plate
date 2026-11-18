/**
 * Pieces every platform session store needs.
 *
 * All eight stores carried identical copies of these. `buildMatchers` is the one
 * that varies: it needs the platform's own eComPlatform regex, so it is built by
 * a factory rather than exported directly.
 */

const { connectDB } = require("./db");
const { normalizeUsername, escapeRegex } = require("./text");

const COMPANIES_COLLECTION = "companies";

/** Coerce to an ObjectId, or null when the value is empty or malformed. */
function toObjectIdOrNull(value) {
	try {
		// Loaded here rather than at module scope: `mongodb` is an optional peer,
		// and a consumer that only needs the string helpers in this file — the
		// desktop app, importing a claim flow — should not have to install the
		// driver to import it.
		const { ObjectId } = require("mongodb");

		return value ? new ObjectId(String(value)) : null;
	} catch (_) {
		return null;
	}
}

async function companiesCollection() {
	const client = await connectDB();
	return client.db(process.env.DB_NAME).collection(COMPANIES_COLLECTION);
}

/** Serialise a cookie jar object into a Cookie request header. */
function cookieHeader(jar) {
	return Object.entries(jar || {})
		.map(([k, v]) => `${k}=${v}`)
		.join("; ");
}

/**
 * Builds the query / arrayFilters / predicate triple used to find one credential
 * inside settings.eCommercePlatformLoginInfo.
 *
 * Prefers the credential _id; falls back to a case-insensitive username match.
 * Returns null when neither is usable.
 *
 * @param platformRegex the platform's eComPlatform matcher, e.g. /^ajio$/i
 */
function makeBuildMatchers(platformRegex) {
	return function buildMatchers({ credentialId, username }) {
		const oid = toObjectIdOrNull(credentialId);
		const user = normalizeUsername(username);

		if (oid) {
			return {
				query: { "settings.eCommercePlatformLoginInfo.info._id": oid },
				arrayFilters: [{ "p.eComPlatform": platformRegex }, { "c._id": oid }],
				matches: (cred) => String(cred?._id || "") === String(oid),
				label: `_id=${oid}`,
			};
		}
		if (user) {
			const rx = { $regex: `^${escapeRegex(user)}$`, $options: "i" };
			return {
				query: { "settings.eCommercePlatformLoginInfo.info.username": rx },
				arrayFilters: [{ "p.eComPlatform": platformRegex }, { "c.username": rx }],
				matches: (cred) => normalizeUsername(cred?.username) === user,
				label: username,
			};
		}
		return null;
	};
}

module.exports = {
	COMPANIES_COLLECTION,
	toObjectIdOrNull,
	companiesCollection,
	cookieHeader,
	makeBuildMatchers,
};
