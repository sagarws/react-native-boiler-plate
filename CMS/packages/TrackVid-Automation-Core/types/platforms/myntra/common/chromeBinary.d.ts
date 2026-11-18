/**
 * Where a consumer-channel Chrome actually lives, per platform, best first.
 *
 * Exported for the test: these are paths on other people's machines, so the
 * only thing that can be checked here is that the list still contains them.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} platform  process.platform
 * @returns {string[]}
 */
export function chromeCandidates(env?: NodeJS.ProcessEnv, platform?: string): string[];
/**
 * Chrome's location as Windows records it — the install a fixed-path search
 * misses: a custom install folder, or a company deployment that put it
 * somewhere of its own. Only consulted after the fixed paths, so a machine they
 * already cover never spawns a process.
 *
 * @param {(key: string) => string|null} queryRegistry injected for the test
 * @returns {string[]}
 */
export function registryChromeCandidates(queryRegistry?: (key: string) => string | null): string[];
/**
 * The installed Google Chrome, or null when this machine has none.
 *
 * `CHROME_BINARY_PATH` wins everywhere. It is the one control an operator has
 * when Chrome is somewhere this list does not know about, and the fallback
 * warning names it for exactly that reason.
 *
 * NULL IS A REAL ANSWER, not a failure: the caller still launches something,
 * and a sign-in through the wrong browser that mostly works is better than no
 * sign-in at all. What matters is that the caller SAYS which one it got.
 *
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, exists?: (p: string) => boolean, queryRegistry?: (key: string) => string|null }} [options]
 *        injected for the test; production passes nothing.
 * @returns {string|null}
 */
export function realChromeBinaryPath({ env, platform, exists, queryRegistry, }?: {
    env?: NodeJS.ProcessEnv;
    platform?: string;
    exists?: (p: string) => boolean;
    queryRegistry?: (key: string) => string | null;
}): string | null;
/**
 * The error to throw when the real Chrome cannot be had and the consumer has
 * refused the pinned substitute (common/browserRuntime.setPinnedFallbackAllowed).
 *
 * Worded for the operator, because this is the toast they read. It names the
 * fix and deliberately avoids the words of a transient failure — the login
 * retry loop rotates and relaunches on "network error" or "timed out", and
 * retrying cannot install a browser.
 *
 * @param {"not-found"|"no-driver"} reason
 * @param {Error} [cause] the launch failure, for the log
 */
export function realChromeRequiredError(reason: "not-found" | "no-driver", cause?: Error): Error;
/**
 * What to say when there is no real Chrome to drive.
 *
 * A sentence rather than a thrown error: the login still runs, and the person
 * reading the log needs to connect "Network Error" on a Myntra form to a
 * browser choice made twenty lines earlier in a different package. Silence here
 * is how that connection never gets made.
 */
export const NO_REAL_CHROME_WARNING: string;
