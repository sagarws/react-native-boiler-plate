/**
 * Where an automation runs, and how — resolved per company.
 *
 * Two decisions live on `company.settings`, written from Monitor:
 *
 *   desktopExecution[<platform>][<automation>]    run it in the Trackvid-CMS
 *                                                 desktop app, not on the server
 *   apiBasedAutomation[<platform>][<automation>]  use the direct-API flow rather
 *                                                 than the browser-driven one
 *
 * Before this existed, the second was a single global env toggle per platform
 * (SNAPDEAL_APIBASE_AUTOMATION and friends) that applied to every company at
 * once. Those still work: a company that has not been given an explicit setting
 * falls back to its platform's env var, so turning this on changes nothing until
 * someone actually flips a switch.
 *
 *   company setting (a real boolean)  >  env toggle  >  documented default
 *
 * Reads are cached briefly. A claim batch resolves the same company/platform
 * once per config entry, and hitting Mongo for each would turn one decision into
 * dozens of round trips inside a loop that is already slow.
 */

const { connectDB } = require("./db");

/** Env var each platform used before the per-company setting existed. */
const LEGACY_API_FLOW_ENV = {
	ajio: null, // never had one — ajio's API work runs inside the script flow
	myntra: "MYNTRA_API_BASE_AUTOMATION",
	snapdeal: "SNAPDEAL_APIBASE_AUTOMATION",
	meesho: "MEESHO_APIBASE_AUTOMATION",
	flipkart: "FLIPKART_API_BASE_AUTOMATION",
	nykaa: "NAYKAA_APIBASE_AUTOMATION",
	delhivery: "DELHIVERY_APIBASE_AUTOMATION",
	xbees: "XBEES_APIBASE_AUTOMATION",
};

/**
 * The flow a platform uses when neither a company setting nor an env toggle
 * says otherwise. Script for everything except AJIO, whose script flow drives
 * a portal AJIO rebuilt as the "Seller Central" SPA and no longer completes.
 *
 * MUST MATCH `DEFAULT_API_FLOW` in Trackvid-CMS
 * (electron/main/services/automationRouting.service.ts). The desktop cannot
 * load this module, so the map is written twice; its
 * tests/automationRoutingDefault.test.ts compares the two. A platform added
 * here has to be added there, deliberately.
 */
const DEFAULT_API_FLOW = {
	ajio: true,
};

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // companyId -> { at, settings }

const key = (value) => String(value || "").toLowerCase().trim();

/** Clears the cache. Call after writing a setting, and from tests. */
function clearRoutingCache(companyId) {
	if (companyId) cache.delete(String(companyId));
	else cache.clear();
}

async function loadSettings(companyId) {
	const id = String(companyId || "").trim();
	if (!id) return {};

	const hit = cache.get(id);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.settings;

	let settings = {};
	try {
		const { ObjectId } = require("mongodb");
		const client = await connectDB();
		const doc = await client
			.db(process.env.DB_NAME)
			.collection("companies")
			.findOne(
				{ _id: new ObjectId(id) },
				{
					projection: {
						"settings.desktopExecution": 1,
						"settings.apiBasedAutomation": 1,
						// Who signs this platform in. Read here because it decides
						// whether a browser window is drawn — see applyAutoLoginPolicy.
						"settings.isAutoLoginOnActiveSession": 1,
					},
				}
			);
		settings = doc?.settings || {};
	} catch (err) {
		// A lookup failure must not decide the routing. Returning {} means every
		// pair falls through to the env toggle — the behaviour that was in place
		// before this module existed.
		console.warn(`⚠️ automationRouting: could not read settings for ${id} — using env defaults (${err.message})`);
		settings = {};
	}

	cache.set(id, { at: Date.now(), settings });
	return settings;
}

function envFlag(platform) {
	const name = LEGACY_API_FLOW_ENV[key(platform)];
	if (!name) return undefined;
	const raw = process.env[name];
	return raw === undefined ? undefined : raw === "true";
}

/**
 * Should this company/platform/automation use the direct-API flow?
 *
 * @param {string} companyId
 * @param {string} platform    ajio | myntra | …
 * @param {string} automation  claim | masterImport | ticketDownload
 * @param {boolean} [fallback] used when neither a setting nor an env var exists;
 *                              omitted, the platform's `DEFAULT_API_FLOW` applies
 */
async function useApiBasedFlow(companyId, platform, automation, fallback) {
	const settings = await loadSettings(companyId);
	const set = settings?.apiBasedAutomation?.[key(platform)]?.[automation];
	if (typeof set === "boolean") return set;

	const fromEnv = envFlag(platform);
	if (typeof fromEnv === "boolean") return fromEnv;

	return typeof fallback === "boolean" ? fallback : DEFAULT_API_FLOW[key(platform)] === true;
}

/**
 * Should this company/platform/automation be handed to the desktop app instead
 * of running here?
 *
 * Defaults to false when unset: the server keeps doing the work until a company
 * explicitly opts in. Routing to a desktop client that may not be installed —
 * and whose claims would then sit untouched, looking exactly like claims that
 * simply had not run yet — is not a safe default.
 */
async function runsOnDesktop(companyId, platform, automation) {
	const settings = await loadSettings(companyId);
	const set = settings?.desktopExecution?.[key(platform)]?.[automation];
	return typeof set === "boolean" ? set : false;
}

/**
 * Does this company automate the sign-in for this platform?
 *
 * `settings.isAutoLoginOnActiveSession[platform]`. Defaults to TRUE when unset,
 * matching the desktop app: an automation that has always signed itself in must
 * not stop doing so because nobody has opened the setting yet.
 */
async function autoLoginEnabled(companyId, platform) {
	const settings = await loadSettings(companyId);
	const set = settings?.isAutoLoginOnActiveSession?.[key(platform)];

	return typeof set === "boolean" ? set : true;
}

/**
 * Teaches the headless decision who signs this platform in.
 *
 * The desktop app does this in `prepareCore`; the server had no equivalent, so
 * `isAutoLoginOnActiveSession` reached the routing decisions and never the
 * headless one — a company with auto-login off still got a headless browser
 * here, and nobody could complete the sign-in it was waiting for.
 *
 * Call it before launching a browser for a company's automation. Cheap: the
 * settings read is the same cached one every routing call already makes.
 *
 * Never throws — a settings read that fails leaves the environment in charge,
 * which is the behaviour that was in place before this existed.
 */
async function applyAutoLoginPolicy(companyId, platform) {
	try {
		const { setAutoLoginEnabled } = require("./headless");

		setAutoLoginEnabled(platform, await autoLoginEnabled(companyId, platform));
	} catch (err) {
		console.warn(
			`⚠️ automationRouting: could not apply the auto-login policy for ${platform} (${err.message})`
		);
	}
}

/**
 * Both decisions in one read, for callers that need each.
 *
 * @param {string} companyId
 * @param {string} platform
 * @param {string} automation
 * @param {boolean} [apiFallback] as `useApiBasedFlow`'s `fallback`
 */
async function resolveRouting(companyId, platform, automation, apiFallback) {
	const [desktop, api] = await Promise.all([
		runsOnDesktop(companyId, platform, automation),
		useApiBasedFlow(companyId, platform, automation, apiFallback),
	]);
	return { desktopExecution: desktop, apiBasedAutomation: api };
}

/**
 * Splits a master-import/claim config array three ways by how each entry's
 * company is routed.
 *
 * A job's config array spans companies, so "which flow is this job using?" no
 * longer has one answer — it is per entry. Callers run the `api` and `script`
 * groups with their own runners and leave `desktop` alone.
 *
 * @param {Array<{companyId?: string}>} configArray
 * @param {string} platform
 * @param {string} automation
 * @returns {Promise<{desktop: Array, api: Array, script: Array}>}
 */
async function partitionByRouting(configArray, platform, automation) {
	const out = { desktop: [], api: [], script: [] };

	for (const entry of configArray || []) {
		const companyId = entry?.companyId;
		if (await runsOnDesktop(companyId, platform, automation)) {
			out.desktop.push(entry);
			continue;
		}
		if (await useApiBasedFlow(companyId, platform, automation)) out.api.push(entry);
		else out.script.push(entry);
	}

	return out;
}

module.exports = {
	DEFAULT_API_FLOW,
	LEGACY_API_FLOW_ENV,
	partitionByRouting,
	clearRoutingCache,
	useApiBasedFlow,
	runsOnDesktop,
	autoLoginEnabled,
	applyAutoLoginPolicy,
	resolveRouting,
};
