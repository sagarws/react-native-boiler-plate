/**
 * Remember a browser for as long as it is open.
 *
 * @template T
 * @param {T} browser a selenium driver (`quit`) or a puppeteer browser (`close`)
 * @returns {T} the same handle, so this can wrap a launch inline
 */
export function track<T>(browser: T): T;
/** Stop remembering one — its owner has closed it the ordinary way. */
export function forget(browser: any): void;
/** How many are open right now. For a log line, and for the test. */
export function openBrowserCount(): number;
/**
 * End every browser this process has open.
 *
 * Best effort and never throws: this is called from a path that is tearing
 * things down, and one browser that will not die must not stop the next one.
 *
 * @param {string} [reason] what to say in the log
 * @returns {Promise<number>} how many were asked to close
 */
export function closeAllBrowsers(reason?: string): Promise<number>;
