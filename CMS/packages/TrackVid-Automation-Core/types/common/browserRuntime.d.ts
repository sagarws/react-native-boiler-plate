/** The puppeteer implementation available here, or null. */
export function loadPuppeteer(): any;
/**
 * Point the logins at a specific Chrome binary.
 *
 * Required when only `puppeteer-core` is installed, because it ships no
 * browser and cannot guess. Passing null restores "let puppeteer decide".
 */
export function setChromeExecutablePath(binaryPath: any): void;
/** The configured binary, or null. */
export function chromeExecutablePath(): any;
/**
 * The `executablePath` a launch should use.
 *
 * Order: an explicitly configured binary wins; otherwise the caller's own
 * fallback (the server's `/usr/bin/google-chrome` in production); otherwise
 * undefined, letting a full puppeteer find its bundled Chromium.
 *
 * Returns undefined rather than null because that is what puppeteer.launch
 * treats as "not specified".
 */
export function resolveExecutablePath(fallback: any): any;
/**
 * The binary to launch when the PLATFORM has its own opinion.
 *
 * The mirror of resolveExecutablePath: there, a process-wide setting wins over
 * a generic fallback; here, a platform's deliberate choice wins over the
 * process-wide setting.
 *
 * Myntra is why. Its login resolves the real, installed Google Chrome on
 * purpose — Chrome for Testing announces itself with a banner ("only for
 * automated testing") and fingerprints differently, and Myntra's sign-in is
 * behind Akamai. Overriding that with this app's pinned build is how a login
 * that used to work starts failing.
 *
 * @param {string|null|undefined} platformChoice what the platform resolved
 */
export function preferExecutablePath(platformChoice: string | null | undefined): any;
/**
 * Point the Selenium logins (Myntra, Flipkart) at a chromedriver.
 *
 * Selenium needs the driver binary as well as the browser, and the two must
 * match on major version — which is exactly why the desktop app pins both
 * rather than using whatever Chrome the operator has. On the server, Selenium
 * finds chromedriver on PATH and this stays null.
 */
export function setChromedriverPath(binaryPath: any): void;
/** The configured chromedriver, or null to let Selenium find its own. */
export function chromedriverPath(): any;
/**
 * How a consumer obtains a chromedriver for a browser it did NOT pin.
 *
 * WHY THIS HAD TO EXIST. A pinned browser and a pinned driver are a matched
 * pair, and `chromedriverPath` only ever describes that pair. Myntra launches a
 * different browser on purpose — the operator's real Chrome — and chromedriver
 * matches on MAJOR VERSION, so the pinned 131 driver cannot drive a Chrome 152.
 *
 * Selenium Manager is supposed to cover this: handed no service, selenium
 * downloads the matching driver itself. In a packaged desktop app it does not.
 * The first build to reach a real Chrome answered every re-capture with
 * "Unable to obtain browser driver" — Selenium Manager's own words — because
 * fetching one needs network the operator's machine may filter and a cache
 * directory it may not be able to write.
 *
 * So the consumer, which already downloads and caches browsers, is asked
 * instead. Registered, not imported: this package must not learn how the
 * desktop app stores anything.
 *
 * @param {(binaryPath: string) => Promise<string|null>|string|null} fn
 */
export function setDriverProvider(fn: (binaryPath: string) => Promise<string | null> | string | null): void;
/**
 * The chromedriver for this browser, or null when there is none to be had.
 *
 * Null is not an error: the caller can still let Selenium Manager try, and
 * should still have somewhere to fall back to when that fails too.
 *
 * @param {string|null|undefined} binaryPath the browser about to be launched
 * @returns {Promise<string|null>}
 */
export function driverPathFor(binaryPath: string | null | undefined): Promise<string | null>;
/**
 * Whether a platform that names its own browser may substitute the pinned one.
 *
 * Myntra names the installed Google Chrome. When it cannot have it — no Chrome
 * on the machine, or no chromedriver to drive it — the default is to launch the
 * pinned Chrome for Testing instead: a sign-in that might be refused beats one
 * that never starts, and the server has always behaved that way.
 *
 * On the desktop that substitute is never accepted. Akamai answers it with
 * "Network Error" every time, under a "Chrome for Testing … only for automated
 * testing" banner, so the operator sees a broken login and a misleading cause.
 * The desktop turns this off and gets a plain "install Google Chrome" error
 * instead. Default true: a consumer that never calls this behaves as before.
 *
 * @param {boolean} allowed
 */
export function setPinnedFallbackAllowed(allowed: boolean): void;
/** See setPinnedFallbackAllowed. */
export function pinnedFallbackIsAllowed(): boolean;
/** A Selenium ServiceBuilder for one explicit chromedriver, or null. */
export function chromeServiceFor(binaryPath: any): any;
/**
 * A Selenium ServiceBuilder for the configured chromedriver, or null.
 *
 * Returned rather than applied so the caller keeps ownership of its Builder
 * chain, and so a consumer without selenium-webdriver never loads it.
 */
export function chromeServiceBuilder(options?: {}): any;
/** The error to throw when a login needs a browser and none can be launched. */
export function browserUnavailableError(): Error;
export const CANDIDATES: string[];
