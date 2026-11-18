/**
 * Browser tweaks every Meesho automation needs before it drives a page.
 *
 * These sat in `master-import/script-based-flow/puppeteerHelpers.js` while the
 * CLAIM login also needed them, and it required them from
 * `claim-management/common/utils.js` — which does not export them. Destructuring
 * an absent export is silent in JavaScript, so `enableStealthMode` was undefined
 * and every Meesho Re-capture died on "enableStealthMode is not a function"
 * the moment it tried to sign in. Nothing failed at require time to point at it.
 *
 * They live here because two automation types use them, which is the rule: a
 * helper is pushed as far down as it is true and lifted only when a second
 * caller appears. `puppeteerHelpers` re-exports them so the master-import flow
 * and the package barrels are unchanged.
 *
 * `handleAdvertisementPopup` is still NOT here: the two trees keep their own
 * exact selectors, which are tested against the live portal and which a rewrite
 * would risk. What they now SHARE is the fallback — `common/dismissPopup.js`,
 * which matches a close control by what it is rather than what Meesho called it
 * this quarter. Both handlers try their own selectors first and fall through to
 * it, so a promo in markup neither knows is closed once rather than missed
 * twice.
 */
/**
 * Stealth tweaks to reduce bot detection on Meesho's portal.
 */
export function enableStealthMode(page: any): Promise<void>;
/**
 * Auto-accept Chrome's "password breach" / security dialogs that interrupt navigation.
 */
export function handleDialog(page: any): Promise<void>;
