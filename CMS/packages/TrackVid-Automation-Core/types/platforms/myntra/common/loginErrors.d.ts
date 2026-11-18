/**
 * Single source of truth for "is this login failure actually a bad credential?"
 *
 * Myntra's login form fails for many reasons that have nothing to do with the
 * password: Akamai rejects the auth POST ("Network Error"), the OS-level click
 * misses the LOG IN button, the proxy egress IP is flagged, the dashboard
 * bundle renders late, a selector times out. Treating any of those as a
 * password change flips is_verified=false on a working credential, and the
 * account then gets skipped by filterUnverifiedCredentials on every later run
 * until someone re-verifies it by hand.
 *
 * The ONLY reliable signal is Myntra's own credential-error banner rendered
 * inside the login form:
 *
 *   <div class="global_errorMessage__u64W2">Incorrect email or password.</div>
 *
 * So: probe for that exact element, and only then raise INVALID_CREDENTIALS.
 * Everything else stays a generic LOGIN_FAILED and leaves the credential
 * verified.
 */
export const CREDENTIAL_ERROR_SELECTOR: "div.global_errorMessage__u64W2";
export const CREDENTIAL_ERROR_SELECTOR_FALLBACK: "div[class*=\"global_errorMessage\"]";
export const CREDENTIAL_ERROR_TEXT: RegExp;
export const INVALID_CREDENTIALS_PREFIX: "INVALID_CREDENTIALS:";
/**
 * Read the login form's credential-error banner, if it is on screen.
 *
 * Best-effort by design: a dead driver, a navigated-away page, or a thrown
 * executeScript all resolve to "" (no banner → not a credential failure)
 * rather than propagating. The caller is already on an error path.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @returns {Promise<string>} banner text, or "" when absent/unreadable
 */
export function probeCredentialErrorBanner(driver: any): Promise<string>;
/**
 * True when the banner text is Myntra's rejected-credential message.
 * @param {string} bannerText
 */
export function isCredentialErrorBanner(bannerText: string): boolean;
/**
 * Build the error a login helper should throw once the banner is confirmed.
 * Carries `code` for structured checks and keeps the INVALID_CREDENTIALS:
 * prefix in the message, because buildDriverAndLogin's retry wrapper rethrows
 * the original Error object and some callers only see the string.
 * @param {string} bannerText
 */
export function invalidCredentialsError(bannerText: string): Error;
/**
 * The classifier every caller should use before marking a credential
 * password-changed / unverified.
 *
 * Deliberately narrow: it matches the structured code or the message prefix
 * set by invalidCredentialsError() — never free-text keywords like "password"
 * or "credentials", which appear in plenty of transient failures
 * ("LOGIN_FAILED: Missing username or password", "Myntra rejected the
 * credentials or kept showing Network Error", selector timeouts on #password).
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isInvalidCredentialsError(err: unknown): boolean;
