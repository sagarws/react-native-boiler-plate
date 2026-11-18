/**
 * The platform registry — one table every TrackVid runner agrees on.
 *
 * Automated-Scripts, Trackvid-CMS and anything else that automates a platform
 * reads its identity from here instead of hard-coding a login URL or guessing a
 * session field name. Adding a platform is one entry.
 *
 * `sessionField` and `ingestPath` are the two that must not drift: the field is
 * where the session lands on the credential document
 * (companies.settings.eCommercePlatformLoginInfo[<platform>].info[<cred>].<field>),
 * and the path is the authenticated BE endpoint that writes it.
 */

/**
 * @typedef {Object} PlatformEntry
 * @property {string}   key            lowercase id used everywhere
 * @property {string}   label          human name
 * @property {string}   loginUrl       where a browser should land to sign in
 * @property {string[]} cookieDomains  domains to harvest the session jar from
 * @property {string}   sessionField   credential sub-document field holding the session
 * @property {string}   ingestPath     authenticated BE endpoint that stores a harvested jar
 * @property {string}   jarFormat      the SHAPE that endpoint wants the jar in:
 *                                     "cookie-array"  → [{ name, value, domain, ... }]
 *                                     "name-value-map" → { name: value }
 * @property {string[]} automations    automation types this platform actually has
 */

/** @type {PlatformEntry[]} */
const PLATFORMS = [
	{
		key: "ajio",
		label: "Ajio",
		loginUrl: "https://seller.ajio.com/",
		cookieDomains: ["seller.ajio.com", ".ajio.com"],
		sessionField: "ajioSession",
		ingestPath: "/ajio/ingest-session",
		// Rehydrated into Puppeteer via CDP Network.setCookies, which needs the full cookie.
		jarFormat: "cookie-array",
		automations: ["claim", "masterImport", "ticketDownload"],
	},
	{
		key: "myntra",
		label: "Myntra",
		loginUrl: "https://partners.myntrainfo.com/",
		cookieDomains: ["partners.myntrainfo.com", ".myntrainfo.com"],
		sessionField: "myntraSession",
		ingestPath: "/myntra/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim", "masterImport"],
	},
	{
		key: "snapdeal",
		label: "Snapdeal",
		loginUrl: "https://seller.snapdeal.com/",
		cookieDomains: ["seller.snapdeal.com", ".snapdeal.com"],
		sessionField: "snapdealSession",
		ingestPath: "/snapdeal/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim", "masterImport"],
	},
	{
		key: "meesho",
		label: "Meesho",
		loginUrl: "https://supplier.meesho.com/",
		cookieDomains: ["supplier.meesho.com", ".meesho.com"],
		sessionField: "meeshoSession",
		ingestPath: "/meesho/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim", "masterImport"],
	},
	{
		key: "tatacliq",
		label: "Tata CliQ",
		loginUrl: "https://sellerzone.tatacliq.com/",
		cookieDomains: ["sellerzone.tatacliq.com", ".tatacliq.com"],
		sessionField: "tatacliqSession",
		ingestPath: "/tatacliq/ingest-session",
		// Rehydrated into Puppeteer, like AJIO's: every Tata CliQ call runs
		// inside a logged-in page (Cloudflare, plus a slave pick that is
		// server-side session state), and the Cloudflare cookies are HttpOnly
		// and domain-scoped — a name/value pair alone lands on the wrong scope.
		jarFormat: "cookie-array",
		automations: ["claim"],
	},
	{
		key: "flipkart",
		label: "Flipkart",
		loginUrl: "https://seller.flipkart.com/",
		cookieDomains: ["seller.flipkart.com", ".flipkart.com"],
		sessionField: "flipkartSession",
		ingestPath: "/flipkart/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim"],
	},
	{
		key: "nykaa",
		label: "Nykaa",
		loginUrl: "https://dispute.nykaa.com/",
		// Zoho as well as Nykaa. The portal is served from dispute.nykaa.com but
		// its login is Zoho Desk: the IAM session AND the CSRF cookie the write
		// APIs require are set on zoho hosts. Capturing only the nykaa domains
		// yields a jar that passes every read and is refused on the first write
		// with a 401 that reads like a dead session.
		cookieDomains: ["dispute.nykaa.com", ".nykaa.com", ".zoho.in", ".zoho.com"],
		sessionField: "nykaaSession",
		ingestPath: "/nykaa/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim"],
	},
	{
		key: "delhivery",
		label: "Delhivery",
		loginUrl: "https://one.delhivery.com/",
		cookieDomains: ["one.delhivery.com", ".delhivery.com"],
		sessionField: "delhiverySession",
		ingestPath: "/delhivery/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim"],
	},
	{
		key: "xbees",
		label: "Xbees",
		loginUrl: "https://clientportal.xbees.in/",
		cookieDomains: ["clientportal.xbees.in", ".xbees.in"],
		sessionField: "xbeesSession",
		ingestPath: "/xbees/ingest-session",
		// Stored and replayed as a Cookie header, so only name and value survive.
		jarFormat: "name-value-map",
		automations: ["claim"],
	},
];

const BY_KEY = new Map(PLATFORMS.map((p) => [p.key, p]));

/**
 * Stored spellings that mean a platform already in the registry.
 *
 * Xpressbees rebranded and the database carries all three spellings; Nykaa is
 * typed several ways by the people creating claims.
 */
const ALIASES = {
	expressbees: "xbees",
	xpressbees: "xbees",
	naykaa: "nykaa",
	nykaafashion: "nykaa",
};

/**
 * A platform name as the registries key it.
 *
 * WHY THIS IS NEEDED AT ALL, when every lookup already lower-cased: a platform
 * reaches this code as text somebody typed or as a screen's display LABEL, and
 * the registry keys are single words. For "Myntra" and "Flipkart" lower-casing
 * was enough — it stopped being enough the moment a platform's name had a space
 * in it. "Tata CliQ" lower-cases to "tata cliq", which is not the key
 * "tatacliq", so every lookup answered "no such platform": no refill fields, no
 * account mapping, no claim runner. Nothing failed loudly; the features simply
 * were not there.
 *
 * SEPARATORS ARE DROPPED ONLY IF THE RESULT IS A PLATFORM WE KNOW. An
 * unrecognised name comes back as itself, lower-cased and trimmed, rather than
 * silently mangled into something that might collide with a real key.
 *
 * @param {string} value any spelling — a label, a stored eComPlatform, a tab
 * @returns {string} the canonical key, or the input lower-cased and trimmed
 */
function platformKey(value) {
	const lower = String(value || "").toLowerCase().trim();

	if (ALIASES[lower]) return ALIASES[lower];
	if (BY_KEY.has(lower)) return lower;

	const squashed = lower.replace(/[\s._-]+/g, "");

	if (ALIASES[squashed]) return ALIASES[squashed];

	return BY_KEY.has(squashed) ? squashed : lower;
}

/** Case-insensitive lookup. Returns undefined for an unknown platform. */
function getPlatform(key) {
	return BY_KEY.get(platformKey(key));
}

/** Platform keys, in registry order. */
const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);

/** Platforms that actually have the given automation type. */
function platformsWith(automation) {
	return PLATFORMS.filter((p) => p.automations.includes(automation));
}

module.exports = { PLATFORMS, PLATFORM_KEYS, getPlatform, platformKey, platformsWith };
