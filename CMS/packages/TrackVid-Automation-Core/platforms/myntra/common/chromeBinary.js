// -----------------------------------------------------------------------------
// Myntra — the browser its sign-in must be driven with
// -----------------------------------------------------------------------------
// Myntra is the ONE platform that names its own browser, and the reason is
// Akamai Bot Manager in front of accounts.myntra.com. Its login POST is not
// refused with a status an app could read: the edge resets the HTTP/2 stream,
// Chrome reports ERR_HTTP2_PROTOCOL_ERROR, and the React form renders the
// generic red "Network Error" under the LOG IN button. Every automation tell
// raises the risk score that triggers it.
//
// THE REAL, INSTALLED GOOGLE CHROME IS THE POINT. What the runners fall back to
// otherwise is Chrome for Testing — the build a consumer pins for every other
// platform — and it is the wrong browser for this one in three separate ways:
//
//   • it announces itself. "Chrome for Testing … is only for automated
//     testing" sits in a banner across the top of the window, which is the
//     screenshot an operator sends when they report this.
//   • it is PINNED, so it ages. Trackvid-CMS pins 131.0.6778.108; a real
//     Chrome is many majors past that, and this package's own API calls claim
//     Chrome 151/152 in their `sec-ch-ua`. A browser that old is a signal on
//     its own, and it disagrees with what the rest of this code says we are.
//   • it fingerprints differently from a consumer-channel Chrome.
//
// WINDOWS WAS SIMPLY MISSING. This lookup had a Linux branch (production only)
// and a macOS branch, and nothing for Windows — so on every operator's Windows
// machine, which is where the desktop app actually runs, it returned null and
// the login fell through to the pinned testing build. That is the whole bug
// behind "Myntra always gives Network error due to automation".
//
// Shared by both Myntra automations rather than copied into each: the claim
// sign-in and the master-import sign-in drive the same portal past the same
// edge, and a machine where one finds Chrome and the other does not is the
// hardest version of this to diagnose.
// -----------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const os = require("os");

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
function chromeCandidates(env = process.env, platform = process.platform) {
    if (platform === "win32") {
        // A per-user install (LOCALAPPDATA) is first because it is what an
        // operator who installed Chrome themselves ends up with, and it is the
        // one a machine-wide search misses.
        const roots = [
            env.LOCALAPPDATA,
            env.PROGRAMFILES,
            env["PROGRAMFILES(X86)"],
            // Spelled out for the case where the environment is not inherited —
            // a service, a scheduled task, a shell with a scrubbed env.
            "C:\\Program Files",
            "C:\\Program Files (x86)",
        ].filter(Boolean);

        // `path.win32`, not `path`, because this list is built on whichever OS
        // happens to be running — a developer on macOS reading the Windows
        // branch would otherwise get forward slashes in a Windows path.
        // Deduplicated: PROGRAMFILES usually IS "C:\\Program Files", and a
        // candidate list that checks the same file twice reads like two places
        // were searched.
        return [
            ...new Set(
                roots.map((root) =>
                    path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe")
                )
            ),
        ];
    }

    if (platform === "darwin") {
        return [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ];
    }

    // Linux — the server. `google-chrome` is the Debian package's symlink,
    // `-stable` the name on several distros, and the last two are where the
    // real binary sits when neither symlink was created.
    return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
        "/snap/bin/google-chrome",
    ];
}

// Where Windows records an installed Chrome's location, whichever folder it was
// installed to. The Chrome installer writes the App Paths key for both
// machine-wide and per-user installs; the WOW6432Node view is where a 32-bit
// installer on 64-bit Windows leaves it.
const CHROME_REGISTRY_KEYS = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
];

/**
 * The default value of one registry key, or null.
 *
 * `reg.exe` ships with every Windows, so this needs no native module. Bounded
 * by a timeout and never throws: a missing key, a locked-down registry or a
 * non-Windows host are all simply "not recorded here".
 *
 * @param {string} key
 * @returns {string|null}
 */
function readRegistryDefault(key) {
    try {
        const { execFileSync } = require("child_process");
        const out = execFileSync("reg", ["query", key, "/ve"], {
            encoding: "utf8",
            timeout: 5000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
        });
        const match = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(out);

        return match ? match[1].trim().replace(/^"|"$/g, "") : null;
    } catch (_) {
        return null;
    }
}

/**
 * Chrome's location as Windows records it — the install a fixed-path search
 * misses: a custom install folder, or a company deployment that put it
 * somewhere of its own. Only consulted after the fixed paths, so a machine they
 * already cover never spawns a process.
 *
 * @param {(key: string) => string|null} queryRegistry injected for the test
 * @returns {string[]}
 */
function registryChromeCandidates(queryRegistry = readRegistryDefault) {
    return CHROME_REGISTRY_KEYS.map((key) => queryRegistry(key)).filter(Boolean);
}

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
function realChromeBinaryPath({
    env = process.env,
    platform = process.platform,
    exists = fs.existsSync,
    queryRegistry = readRegistryDefault,
} = {}) {
    const configured = String(env.CHROME_BINARY_PATH || "").trim();

    if (configured && exists(configured)) return configured;

    for (const candidate of chromeCandidates(env, platform)) {
        if (exists(candidate)) return candidate;
    }

    if (platform === "win32") {
        for (const candidate of registryChromeCandidates(queryRegistry)) {
            if (exists(candidate)) return candidate;
        }
    }

    return null;
}

/**
 * What to say when there is no real Chrome to drive.
 *
 * A sentence rather than a thrown error: the login still runs, and the person
 * reading the log needs to connect "Network Error" on a Myntra form to a
 * browser choice made twenty lines earlier in a different package. Silence here
 * is how that connection never gets made.
 */
const NO_REAL_CHROME_WARNING =
    "⚠️ [myntra] No installed Google Chrome found — signing in with the automation build instead. " +
    "Myntra sits behind Akamai, which refuses that browser with a red \"Network Error\" on the login " +
    "form (the window also shows the \"Chrome for Testing … only for automated testing\" banner). " +
    "Install Google Chrome on this machine, or set CHROME_BINARY_PATH to its chrome.exe / binary.";

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
function realChromeRequiredError(reason, cause) {
    const message =
        reason === "no-driver"
            ? "Myntra sign-in needs Google Chrome, and the matching ChromeDriver for this machine's " +
              "Chrome could not be downloaded. Allow googlechromelabs.github.io and " +
              "storage.googleapis.com through the firewall or antivirus, then try again."
            : "Myntra sign-in needs Google Chrome, and it is not installed on this machine. " +
              "Install Google Chrome from google.com/chrome, or set CHROME_BINARY_PATH to its chrome.exe, " +
              "then try again.";
    const err = new Error(message);

    err.code = "REAL_CHROME_REQUIRED";
    err.reason = reason;
    if (cause) err.cause = cause;

    return err;
}

module.exports = {
    chromeCandidates,
    registryChromeCandidates,
    realChromeBinaryPath,
    realChromeRequiredError,
    NO_REAL_CHROME_WARNING,
};
