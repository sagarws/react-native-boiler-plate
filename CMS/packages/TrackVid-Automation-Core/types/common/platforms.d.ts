export type PlatformEntry = {
    /**
     * lowercase id used everywhere
     */
    key: string;
    /**
     * human name
     */
    label: string;
    /**
     * where a browser should land to sign in
     */
    loginUrl: string;
    /**
     * domains to harvest the session jar from
     */
    cookieDomains: string[];
    /**
     * credential sub-document field holding the session
     */
    sessionField: string;
    /**
     * authenticated BE endpoint that stores a harvested jar
     */
    ingestPath: string;
    /**
     * the SHAPE that endpoint wants the jar in:
     * "cookie-array"  → [{ name, value, domain, ... }]
     * "name-value-map" → { name: value }
     */
    jarFormat: string;
    /**
     * automation types this platform actually has
     */
    automations: string[];
};
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
export const PLATFORMS: PlatformEntry[];
/** Platform keys, in registry order. */
export const PLATFORM_KEYS: string[];
/** Case-insensitive lookup. Returns undefined for an unknown platform. */
export function getPlatform(key: any): PlatformEntry;
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
export function platformKey(value: string): string;
/** Platforms that actually have the given automation type. */
export function platformsWith(automation: any): PlatformEntry[];
