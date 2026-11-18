// -----------------------------------------------------------------------------
// Shared constants for the automation runners.
// -----------------------------------------------------------------------------

// Lifetime stamped on a captured Myntra cookie jar
// (companies.settings.eCommercePlatformLoginInfo[<myntra>].info[<cred>].myntraSession.expiresAt).
// Sole source of truth (no env override) — edit here and redeploy.
//
// The erp.at JWT carries its own `exp`, and it is deliberately NOT read: in
// practice the jar outlives what that claim advertises, so honouring it forced
// a fresh Selenium login (~30-60s, plus the whole Akamai failure surface) every
// couple of hours for a session that still worked. Expiry is therefore always
// savedAt + this many hours.
//
// 24h, lowered from 48h on 2026-09-02. A jar captured ~24h earlier was still
// inside its 48h window and read "Active" everywhere, but Myntra answered the
// boot probe with the ANONYMOUS payload — no partnerId, no sellerType. The
// cookies were dead and only the guess said otherwise.
//
// This number is a guess either way; Myntra is never asked. Guessing SHORT
// costs one extra login, which is a minute. Guessing LONG means an automation
// starts against cookies that authenticate nobody — on Snapdeal that ends with
// a downloaded login page ingested as a report. The probe is what actually
// decides; this only governs when the UI stops promising a session is good.
//
// Myntra sessions are also IP-bound, so one captured on a different egress
// address dies immediately however much of the window is left.
//
// Keep in step with TrackVid-BE/src/constants/common.ts — the extension ingest
// endpoint writes the same record from its own path.
const MYNTRA_SESSION_EXPIRY_HOURS = 24;

// Same rule for the Flipkart session
// (…info[<cred>].flipkartSession.expiresAt), written by
// flipkartAutoMation/sessionStore.js after a browser login.
//
// Flipkart publishes no session lifetime, and its login is MORE expensive than
// Myntra's — it is gated behind an emailed OTP, so a premature expiry costs a
// mailbox poll on top of the browser launch. Same 166h for the same reason:
// long enough to survive a weekly cadence, short enough to re-mint before the
// next capture is due. The liveness probe, not this number, is what actually
// prevents a dead session from being used.
//
// Keep in step with TrackVid-BE/src/constants/common.ts.
const FLIPKART_SESSION_EXPIRY_HOURS = 166;

// Same rule for the AJIO session
// (…info[<cred>].ajioSession.expiresAt), written by
// masterDataImport/utils/ajioSessionStore.js after a Puppeteer login.
//
// AJIO also publishes no session lifetime. Login is the Reliance SSO OAuth
// dance (~30-60s) plus the Akamai bot check that occasionally locks accounts,
// so a needless fresh login is expensive. 166h matches Myntra/Flipkart — long
// enough to survive a weekly cadence, short enough to re-mint before the next
// capture is due. The liveness probe (work-places API) is what actually
// prevents a dead session from being used.
//
// Keep in step with TrackVid-BE/src/constants/common.ts.
const AJIO_SESSION_EXPIRY_HOURS = 166;

// Same rule for the Snapdeal seller-portal session
// (…info[<cred>].snapdealSession.expiresAt), written by
// snapdealAutoMation/sessionStore.js after a Puppeteer bootstrap login.
//
// Snapdeal publishes no session lifetime either. Login goes through the seller
// portal (username → "Login with Password" → password → optional OTP) and costs
// ~15-30s of Puppeteer + a page render. 166h matches every other platform —
// long enough to survive a weekly cadence, short enough to re-mint before the
// next capture is due. The liveness probe (/getLoggedInSeller), not this
// number, is what actually prevents a dead session from being used.
//
// Keep in step with TrackVid-BE/src/constants/common.ts.
const SNAPDEAL_SESSION_EXPIRY_HOURS = 166;

// Delhivery uses Keycloak OAuth2. Its access_token lives just 10 minutes
// (expires_in=600) and its refresh_token 24 hours (refresh_expires_in=86400)
// — see ApiDocs/Delhivery Claim process (1).json. The stored record holds the
// refresh_token; a per-request refresh mints a fresh access_token when the
// cached one is within 60s of expiry. The record's overall lifetime is
// capped at the refresh_token's window, so 23h (a hair under 24h) gives a
// margin before the refresh_token itself expires and forces a full browser
// re-login.
//
// Keep in step with TrackVid-BE/src/constants/common.ts.
const DELHIVERY_SESSION_EXPIRY_HOURS = 23;

// Xbees uses Keycloak OAuth2 too. access_token expires in 2h (expires_in=7200),
// refresh_token in ~4h (refresh_expires_in=14399). Cap at 3.5h (12600s /
// 3600s = 3.5h) so the refresh_token still has ~30 min of headroom the last
// time we use it.
const XBEES_SESSION_EXPIRY_HOURS = 3;

// Meesho supplier-portal session cookie. Meesho publishes no lifetime we can
// read, so a flat 166h matches every other cookie-jar platform — long enough
// to survive a weekly cadence, short enough to re-mint before the next
// capture is due. The `/api/container/supplier/prefetch-supply-data` probe is
// what actually decides "alive vs dead" at reuse time — and it hands back the
// supplierId and identifier while it is there.
const MEESHO_SESSION_EXPIRY_HOURS = 166;

// Nykaa dispute-portal session cookie. Zoho Desk keeps sessions alive for
// weeks by default; 166h keeps it in line with every other platform. Probe:
// `/portal/api/me?portalId=<PORTAL_ID>` (cheap, cookie-signed).
const NAYKAA_SESSION_EXPIRY_HOURS = 166;

// Tata CliQ seller-portal session. Deliberately the SHORTEST of the cookie
// platforms, because signing in again costs an emailed OTP: a session that
// expires while an operator is not watching cannot be renewed unattended
// without burning a code, so it is kept well inside the portal's own window
// rather than stretched to match the others. The probe — the slave list, which
// only a signed-in session answers — is what actually decides alive vs dead.
const TATACLIQ_SESSION_EXPIRY_HOURS = 23;

/**
 * Ask Meesho's own endpoint which account holds an AWB, rather than looking at
 * the Returns screen.
 *
 * Account mapping had to drive a browser on Meesho because nothing in its
 * supplier API answered by AWB — every endpoint is keyed on the sub-order
 * number, which an unmapped row does not have either. `fetchReturnClaims` does:
 * it is what the Returns screen itself calls, and it takes `text_global`.
 *
 * A flag rather than a replacement because the two are not equivalent. The API
 * is far faster and needs no Chrome, but it needs a session carrying the
 * supplier id AND identifier, and it is one undocumented endpoint away from
 * changing shape. The screen is slow and always works. Turn this off and the
 * browser path returns, unchanged.
 */
const MEESHO_API_BASE_ACCOUNT_MAPPING = true;
/**
 * Should a Login update that cannot re-capture every login stop the schedule?
 *
 * TRUE — the default, and what the runners want. Every automation below the
 * Login update signs in with what it re-captures: a refill asks the
 * marketplace, a claim files on it. Letting them run against logins the
 * marketplace refuses does not fail cheaply — it is a night of opening
 * browsers, each claim burning an attempt on a dead session, and rows ending
 * Failed for a reason that has nothing to do with the claim. The schedule
 * stops itself, the sidebar says why, and it starts again on its own once the
 * logins are good.
 *
 * FALSE — leave the automations ON and let them try anyway. For the machine
 * where one marketplace is permanently unhappy and the operator would rather
 * the other seven kept working than have the whole schedule held for it. The
 * refusals still show on the Login page and in the Settings card; nothing is
 * hidden, nothing is paused.
 *
 * READ AT THE MOMENT OF THE DECISION, not at startup, so flipping it needs no
 * restart. It governs only the AUTOMATIC pause: an operator's own switch is
 * untouched by it in either position.
 */
/**
 * How many days before the status pass asks about the same claim again.
 *
 * WHY IT IS NOT EVERY NIGHT. The status pass re-asked every claim whose status
 * could still move — 580 on Myntra, 821 on Nykaa — every run, to learn that
 * almost none of them had changed. A marketplace does not decide a claim
 * hourly; the back catalogue cost hours of browser time a night to find
 * nothing, and it crowded out the rows that genuinely needed asking.
 *
 * FOUR DAYS: small enough a sweep is a fraction of its old size, short enough
 * a decision is picked up the same week.
 *
 * A row is DUE when it has never been asked, or was last ANSWERED longer ago
 * than this. The stamp (`lastStatusSync` on the claim) is written only when
 * the marketplace actually answered — a failed ask must not buy a row four
 * quiet days, which is the one way this could lose a status change rather
 * than merely defer a question.
 */
/**
 * How many 31-day windows back the AJIO return-order lookup searches.
 *
 * Create Claim's "Return Order Number" asks AJIO for one return order, and
 * AJIO will not answer a report window wider than 31 days — so a longer reach
 * has to be stitched from separate requests, one per window, newest first.
 *
 * FIVE is roughly five months. Raising it costs requests on the lookups that
 * find nothing: every extra window is another sweep of that month's pages, per
 * POB on the account. Lowering it makes an older return order unfindable from
 * the form.
 *
 * Here rather than in the caller so it can be changed for both runners at once
 * — and overridden per machine without a release.
 */
const AJIO_RETURN_SEARCH_MONTHS = Number(process.env.AJIO_RETURN_SEARCH_MONTHS || 5);

/**
 * The most pages the lookup will read in one 31-day window.
 *
 * NOT A FEATURE — a guard. AJIO reports `totalPages` and the lookup now walks
 * every one of them, because the `returnOrderNo` filter is not applied
 * server-side: a window answers `totalPages: 78` whether or not the order is
 * in it, and reading only the first page meant an order on page 37 came back
 * "not found". Walking a number the server supplies needs a ceiling, or one
 * bad answer becomes a loop nobody can stop.
 *
 * 200 pages is 20,000 rows at AJIO's 100-row cap, comfortably past the biggest
 * month anyone has seen and past AJIO's own 10,000-row result window.
 */
const AJIO_RETURN_SEARCH_MAX_PAGES = Number(process.env.AJIO_RETURN_SEARCH_MAX_PAGES || 200);

/**
 * How far back the POB fill searches for a return AWB.
 *
 * The bulk claim needs a POB per row — every AJIO return lookup is scoped to
 * one — and an operator starting out has only the AWB. Ninety days covers the
 * window a return is still claimable in; older than that and the claim is
 * refused for age anyway, so searching further spends requests to find rows
 * nothing can be done with.
 *
 * Swept in 31-day windows because that is the widest the report answers.
 */
const AJIO_POB_FILL_DAYS = Number(process.env.AJIO_POB_FILL_DAYS || 90);

const CLAIM_STATUS_SYNC_DAYS = 4;

const AUTOMATION_PAUSE_ON_SESSION_FAIL = true;

/**
 * How many times a claim may be filed before it stops being retried.
 *
 * "unlimited" — no cap: a Failed to Proceed claim is retried on every run,
 * however many attempts it already carries. A whole number (e.g. 3) — a
 * Failed to Proceed claim at that many attempts is left for a person.
 * Anything else is read as 3, the cap this had before it was configurable.
 *
 * Read by Trackvid-CMS at build time and inlined into both of its processes
 * (see `claimAttemptLimit` in its shared/constants/claims.ts), so a change here
 * takes effect in the desktop app on its next build.
 *
 * @type {"unlimited" | number}
 */
const MAX_CLAIM_ATTEMPTS = "unlimited";

module.exports = {
	MYNTRA_SESSION_EXPIRY_HOURS,
	FLIPKART_SESSION_EXPIRY_HOURS,
	AJIO_SESSION_EXPIRY_HOURS,
	SNAPDEAL_SESSION_EXPIRY_HOURS,
	DELHIVERY_SESSION_EXPIRY_HOURS,
	XBEES_SESSION_EXPIRY_HOURS,
	MEESHO_SESSION_EXPIRY_HOURS,
	NAYKAA_SESSION_EXPIRY_HOURS,
	TATACLIQ_SESSION_EXPIRY_HOURS,
	MEESHO_API_BASE_ACCOUNT_MAPPING,
	AUTOMATION_PAUSE_ON_SESSION_FAIL,
	CLAIM_STATUS_SYNC_DAYS,
	AJIO_RETURN_SEARCH_MONTHS,
	AJIO_RETURN_SEARCH_MAX_PAGES,
	AJIO_POB_FILL_DAYS,
	MAX_CLAIM_ATTEMPTS,
};
