export const MYNTRA_SESSION_EXPIRY_HOURS: 24;
export const FLIPKART_SESSION_EXPIRY_HOURS: 166;
export const AJIO_SESSION_EXPIRY_HOURS: 166;
export const SNAPDEAL_SESSION_EXPIRY_HOURS: 166;
export const DELHIVERY_SESSION_EXPIRY_HOURS: 23;
export const XBEES_SESSION_EXPIRY_HOURS: 3;
export const MEESHO_SESSION_EXPIRY_HOURS: 166;
export const NAYKAA_SESSION_EXPIRY_HOURS: 166;
export const TATACLIQ_SESSION_EXPIRY_HOURS: 23;
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
export const MEESHO_API_BASE_ACCOUNT_MAPPING: true;
export const AUTOMATION_PAUSE_ON_SESSION_FAIL: true;
export const CLAIM_STATUS_SYNC_DAYS: 4;
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
export const AJIO_RETURN_SEARCH_MONTHS: number;
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
export const AJIO_RETURN_SEARCH_MAX_PAGES: number;
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
export const AJIO_POB_FILL_DAYS: number;
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
export const MAX_CLAIM_ATTEMPTS: "unlimited" | number;
