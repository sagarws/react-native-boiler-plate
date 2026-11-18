export const SESSION_FIELD: "tatacliqSession";
/** The hosts whose cookies make up a Tata CliQ session. */
export const COOKIE_DOMAINS: string[];
export function isSessionCacheEnabled(): boolean;
/**
 * Every Tata CliQ cookie the browser holds, in Puppeteer's own shape.
 *
 * Read through CDP (see cookieHarvest) rather than `page.cookies()`, so the
 * HttpOnly Cloudflare cookies come too. Kept as full records, which is what
 * `hydrateCookies` needs to put a Cloudflare cookie back.
 */
export function harvestCookies(page: any, { logger }?: {
    logger?: Console;
}): Promise<{
    name: string;
    value: string;
    domain: string;
}[]>;
/**
 * Put a stored jar back into a browser.
 *
 * THE SHARED ONE, not a loop over `page.setCookie`. This file had that loop,
 * and it dropped `cf_clearance` on every single reuse:
 *
 *     cookie "cf_clearance" rejected: Protocol error (Network.deleteCookies):
 *     Failed to deserialize params.partitionKey.topLevelSite
 *
 * Newer Chrome returns `partitionKey` as an object and handing it straight back
 * fails to deserialise. Of all the cookies to lose, that is the worst one: it
 * is Cloudflare's clearance token, so the session came back looking alive with
 * the one cookie missing that stops the next request being a challenge page.
 * The shared helper copies fields in deliberately instead, and carries AJIO's
 * other two hard-won rules with it (`expires: -1`, a malformed `sameSite`).
 *
 * @returns {Promise<number>} how many cookies landed. Zero means the jar could
 *          not be restored at all, which the caller treats as no session.
 */
declare function hydrateTataCliqCookies(page: any, jar: any): Promise<number>;
/**
 * Store the session this page is signed in with. Never throws — a cache write
 * that fails must not fail the login that just succeeded, least of all one that
 * spent an OTP.
 */
export function saveSession({ credentialId, username, jar, slaves, ip, source }: {
    credentialId: any;
    username: any;
    jar: any;
    slaves?: any[];
    ip?: any;
    source?: string;
}): Promise<boolean>;
export function loadSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}): Promise<any>;
export function clearSession({ credentialId, username }: {
    credentialId: any;
    username: any;
}, reason?: string): Promise<boolean>;
/**
 * Is this page actually signed in?
 *
 * The slave list is the probe. It is the cheapest authenticated call the portal
 * has, it is the first thing a claim needs anyway, and — the part that makes it
 * a real probe — a signed-OUT session cannot answer it: there is no slave list
 * without a seller, so the response carries no `<li id="…">` at all.
 *
 * IN-PAGE, like every Tata CliQ call. This platform is deliberately absent from
 * common/probeSession.js's jar-only registry for the same reason AJIO is: a
 * caller holding only a jar cannot run this, and answering "cannot tell" is
 * better than answering wrongly.
 *
 * @returns {Promise<{ alive: boolean, slaves: Array }>} the slaves come back
 *          because the probe already has them — throwing them away would mean
 *          a second identical call a moment later.
 */
export function probeSessionInPage(page: any): Promise<{
    alive: boolean;
    slaves: any[];
}>;
/**
 * Hydrate a stored session into this page and prove it.
 *
 * @returns {Promise<{ jar: Array, slaves: Array }|null>} null when there is
 *          nothing usable, in which case the caller signs in — which costs an
 *          OTP, so this is worth the two calls it spends trying.
 */
export function reuseSessionRecord(page: any, record: any, { username }?: {}): Promise<{
    jar: any[];
    slaves: any[];
} | null>;
/** Load, hydrate and prove in one call. Null means "sign in". */
export function tryReuseSession(page: any, { credentialId, username }: {
    credentialId: any;
    username: any;
}): Promise<{
    jar: any[];
    slaves: any[];
}>;
export { hydrateTataCliqCookies as hydrateCookies };
