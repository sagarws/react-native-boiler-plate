/**
 * Hydrate a stored session into this driver and prove it is signed in.
 *
 * @param {object} driver a fresh Selenium driver, on no particular page
 * @param {{ jar?: object, expiresAt?: string, source?: string }|null} record
 *        the stored session, as the ingest wrote it
 * @returns {Promise<boolean>} true only when the signed-in SPF dashboard
 *        rendered. On false the driver is left with NO cookies, ready for
 *        `flipkartLogin` to run in it.
 */
export function restoreFlipkartSession(driver: object, record: {
    jar?: object;
    expiresAt?: string;
    source?: string;
} | null): Promise<boolean>;
/**
 * What this driver is currently signed in with.
 *
 * The csrf token is read by the API flow's own `discoverCsrfToken`, because the
 * record is only counted usable when it has one — a jar saved without it is
 * discarded on read and the next batch signs in again regardless.
 *
 * @returns {Promise<{ jar: object, csrfToken: string|null }>}
 */
export function harvestFlipkartSession(driver: any): Promise<{
    jar: object;
    csrfToken: string | null;
}>;
/**
 * Store the session this driver just signed in with, for the next batch.
 *
 * Best-effort and never throws: a session that could not be saved costs the next
 * run a sign-in, and failing the claim in front of us over it would cost the
 * dispute. A no-op in Trackvid-CMS, which has no database and ships what it
 * captures to the backend over HTTP instead.
 */
export function keepFlipkartSession(driver: any, credentials: any, { source }?: {
    source?: string;
}): Promise<boolean>;
/**
 * Get this driver signed in, reusing the stored session when it still works.
 *
 * The default path is the one both runners already had — a real sign-in — so a
 * caller that passes no options behaves exactly as before.
 *
 * @param {object} driver
 * @param {{ username: string, password?: string, _id?: any }} credentials
 * @param {object}  [options]
 * @param {object|null} [options.session] the stored record, for a caller that
 *        already holds one. Trackvid-CMS does (it reads the local company copy);
 *        the server leaves this out and the session store is asked instead.
 * @param {boolean} [options.allowReuse=true] set false to force a sign-in — the
 *        server's login retry passes false on attempt 2+, because a session it
 *        has already watched fail is not worth a second navigation.
 * @param {object} [options.login] passed through to `flipkartLogin`
 *        (`fetchOtp`, `operatorFallback`, `operatorTimeoutMs`).
 * @param {boolean} [options.keep=true] store the session a fresh sign-in mints,
 *        so the next batch can reuse it. Trackvid-CMS passes false and saves it
 *        its own way — it has no database and posts to the backend instead.
 * @returns {Promise<{ reused: boolean }>}
 */
export function signInOrRestore(driver: object, credentials: {
    username: string;
    password?: string;
    _id?: any;
}, { session, allowReuse, login, keep }?: {
    session?: object | null;
    allowReuse?: boolean;
    login?: object;
    keep?: boolean;
}): Promise<{
    reused: boolean;
}>;
