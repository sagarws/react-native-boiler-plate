// -----------------------------------------------------------------------------
// A signed-in Flipkart driver for the script-based claim flow
// -----------------------------------------------------------------------------
// Both script runners — Automated-Scripts' scriptNew.js and Trackvid-CMS's
// runFlipkartScriptClaim — used to sign in from scratch on every batch, and
// both carried the same comment explaining why: a jar hydrated into a fresh
// driver produces a browser that LOOKS signed in and is not. Flipkart's
// dashboard is a hash route on the same host as its public marketing page, so a
// signed-out browser answers `#dashboard/payments/spf` with the "Start Selling"
// page and a 200. Nothing in the URL says otherwise, and the run marched on to
// hunt for a claim form that was never going to be there.
//
// That reasoning was right about the URL and wrong about the conclusion. The
// URL is not the only signal available: `gotoSpfDirect` already refuses to call
// a navigation successful unless the signed-in dashboard's Payments rail is
// actually in the DOM — the same element `flipkartLogin` verifies ITSELF with.
// A browser that reaches the SPF route AND renders that rail is signed in by
// the only definition this codebase has.
//
// So reuse is safe when it is PROVEN rather than assumed, which is what this
// module does:
//
//   restore → hydrate the stored jar → open the SPF route → is the rail there?
//     yes → reuse it, no sign-in, no one-time code
//     no  → wipe the cookies and sign in normally
//
// The cost of a wrong guess is one navigation. The cost of not doing this is a
// full OTP sign-in per batch — on the desktop, an operator being asked for a
// code they should not need — while a good session sits in company settings.
//
// This is the same shape the API flow has had all along (`loginFlipkartApi` →
// `getUsableSession` → probe), and the same shape Myntra's claim flow uses.
// The difference is only what counts as a probe: an HTTP call there, a rendered
// dashboard here.
// -----------------------------------------------------------------------------

const { flipkartLogin, gotoSpfDirect, dismissWelcomeModal } = require("../common/utils");
// The same token reader the API flow uses. One definition of "where Flipkart
// keeps its csrf token" rather than a second one that drifts.
const { discoverCsrfToken } = require("../api-based-flow/claimApiFlow");
// mongodb is an optional peer and is required lazily inside connectDB, so this
// module-scope require is safe in Trackvid-CMS, which has no database. Its
// loadSession and saveSession are no-ops there by design — see
// common/sessionPersistence.js.
const { loadSession, saveSession } = require("../../common/sessionStore");

const ORIGIN = (process.env.FLIPKART_LOGIN_URL || "https://seller.flipkart.com/").replace(/\/+$/, "");

/**
 * The stored jar as a list of cookies Selenium will accept.
 *
 * Two shapes reach this: the name→value map the Chrome extension and the API
 * login store (`{ jar: { fk_csrf: "…" } }`), and the `[{ name, value, domain }]`
 * array Trackvid-CMS's local capture keeps. Both are real, so both are read
 * rather than one being declared canonical.
 *
 * `domain` is deliberately DROPPED. WebDriver refuses a cookie whose domain is
 * not the current document's or a parent of it, and a stored `.flipkart.com`
 * scope is the kind of detail that turns a working session into an
 * InvalidCookieDomainError. Every call the claim UI makes goes to
 * seller.flipkart.com, which is the document we set them on, so a host-scoped
 * copy is sent exactly when the original would have been.
 */
function cookieList(jar) {
    if (!jar) return [];

    const raw = Array.isArray(jar)
        ? jar
        : Object.entries(jar).map(([name, value]) => ({ name, value }));

    return raw
        .filter((c) => c && c.name && c.value !== undefined && c.value !== null)
        .map((c) => ({
            name: String(c.name),
            value: String(c.value),
            path: c.path || "/",
            // Chrome rejects a `__Secure-`/`__Host-` prefixed cookie that is not
            // marked secure, and silently — the cookie simply never lands, and
            // the session is one cookie short of working for no visible reason.
            secure: /^__(Secure|Host)-/.test(String(c.name)) ? true : Boolean(c.secure),
        }));
}

/** Has the record passed the expiry its writer stamped on it? */
function isExpired(record) {
    if (!record || !record.expiresAt) return false;

    return new Date(record.expiresAt).getTime() <= Date.now();
}

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
async function restoreFlipkartSession(driver, record) {
    const cookies = cookieList(record && record.jar);

    if (cookies.length === 0) {
        console.log("🍪 [flipkart-script] No stored session to reuse — signing in");

        return false;
    }
    if (isExpired(record)) {
        console.log(
            `⏰ [flipkart-script] Stored session expired at ${record.expiresAt} — signing in`
        );

        return false;
    }

    console.log(
        `🍪 [flipkart-script] Trying the stored session (${cookies.length} cookies` +
        `${record.source ? `, captured by "${record.source}"` : ""})`
    );

    try {
        // Cookies can only be set for the document that is already loaded, so
        // the public landing page is visited purely to have an origin to set
        // them on. Its own cookies are then cleared, so what the dashboard sees
        // is the stored session and nothing else.
        await driver.get(`${ORIGIN}/`);
        await driver.manage().deleteAllCookies();

        let added = 0;

        for (const cookie of cookies) {
            try {
                await driver.manage().addCookie(cookie);
                added++;
            } catch (err) {
                // One rejected cookie is not a failed restore — analytics and
                // bot-detection cookies are in every jar and none of them
                // authenticates anything. The dashboard check below is the
                // verdict; this is only worth a line when it explains one.
                console.log(`    ↩️ cookie "${cookie.name}" rejected: ${err.message}`);
            }
        }

        if (added === 0) {
            console.log("🍪 [flipkart-script] Not one stored cookie could be set — signing in");
            await driver.manage().deleteAllCookies().catch(() => { /* about to sign in anyway */ });

            return false;
        }

        // THE VERDICT. `gotoSpfDirect` returns true only when the URL is the SPF
        // route AND the signed-in dashboard's Payments rail is in the DOM — the
        // public page that answers the same route has nothing like it. This is
        // the check whose absence made reuse unsafe before.
        if (await gotoSpfDirect(driver)) {
            console.log("♻️ [flipkart-script] Stored session works — skipping the sign-in");
            // A reused session never went through the login, which is where
            // this modal is normally dismissed. It covers the dashboard and
            // swallows every sidebar click underneath it.
            await dismissWelcomeModal(driver).catch(() => { /* never blocks a claim */ });

            return true;
        }

        console.log(
            "↩️ [flipkart-script] The stored session did not reach a signed-in dashboard — signing in"
        );
    } catch (err) {
        // A restore that throws says nothing about the session — the navigation
        // may simply have failed — so it is treated the same as a dead one: sign
        // in, which always works.
        console.log(`↩️ [flipkart-script] Session restore failed (${err.message}) — signing in`);
    }

    // Leave the driver clean either way. A half-hydrated jar is worse than none:
    // `flipkartLogin` would start from a browser carrying somebody's expired
    // cookies, which is its own class of confusing failure.
    await driver.manage().deleteAllCookies().catch(() => { /* about to sign in anyway */ });

    return false;
}

/**
 * What this driver is currently signed in with.
 *
 * The csrf token is read by the API flow's own `discoverCsrfToken`, because the
 * record is only counted usable when it has one — a jar saved without it is
 * discarded on read and the next batch signs in again regardless.
 *
 * @returns {Promise<{ jar: object, csrfToken: string|null }>}
 */
async function harvestFlipkartSession(driver) {
    const jar = {};

    for (const cookie of await driver.manage().getCookies()) {
        if (cookie && cookie.name) jar[cookie.name] = cookie.value;
    }

    const csrfToken = await discoverCsrfToken(driver, jar).catch(() => null);

    return { jar, csrfToken };
}

/**
 * Store the session this driver just signed in with, for the next batch.
 *
 * Best-effort and never throws: a session that could not be saved costs the next
 * run a sign-in, and failing the claim in front of us over it would cost the
 * dispute. A no-op in Trackvid-CMS, which has no database and ships what it
 * captures to the backend over HTTP instead.
 */
async function keepFlipkartSession(driver, credentials, { source = "claim-script" } = {}) {
    try {
        const { jar, csrfToken } = await harvestFlipkartSession(driver);

        if (!csrfToken || Object.keys(jar).length === 0) return false;

        return await saveSession({
            credentialId: credentials && credentials._id,
            username: credentials && credentials.username,
            jar,
            csrfToken,
            source,
        });
    } catch (err) {
        console.warn(`⚠️ [flipkart-script] Could not keep the session: ${err.message}`);

        return false;
    }
}

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
async function signInOrRestore(
    driver,
    credentials,
    { session = null, allowReuse = true, login = {}, keep = true } = {}
) {
    if (allowReuse) {
        // An explicitly supplied record wins: the desktop app has one this
        // process could not read anyway — it has no database, so `loadSession`
        // returns null there by design.
        const record = session || (await loadSession({
            credentialId: credentials && credentials._id,
            username: credentials && credentials.username,
        }));

        if (await restoreFlipkartSession(driver, record)) return { reused: true };
    }

    await flipkartLogin(driver, credentials, login);

    // A login that has just been paid for — a one-time code and all — should not
    // be thrown away when the driver closes.
    if (keep) await keepFlipkartSession(driver, credentials);

    return { reused: false };
}

module.exports = {
    restoreFlipkartSession,
    harvestFlipkartSession,
    keepFlipkartSession,
    signInOrRestore,
};
