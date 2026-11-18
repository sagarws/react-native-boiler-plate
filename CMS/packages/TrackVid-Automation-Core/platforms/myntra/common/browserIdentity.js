// -----------------------------------------------------------------------------
// Myntra — one browser identity, shared by the browser and the calls after it
// -----------------------------------------------------------------------------
// A Myntra session is minted by a real Chrome (see chromeBinary.js) and then
// USED by axios: the login harvests `erp.at` + `session` and every claim,
// report and probe call afterwards replays that jar over HTTP. Akamai sees one
// session across both halves, so the two halves have to agree about who they
// are.
//
// THEY DID NOT. The API calls hardcoded
//
//     user-agent          … Macintosh; Intel Mac OS X 10_15_7 … Chrome/151
//     sec-ch-ua-platform  "macOS"
//
// on every machine — while the browser that minted the cookies was Chrome on
// WINDOWS, which is where the desktop app runs. A session established by a
// Windows browser and then continued by a macOS one is not a subtle
// fingerprint: it is the same contradiction as a cookie moving between two
// devices, and it is exactly what a bot manager is deployed to catch. The
// master-import flow had a third answer again (Chrome 150).
//
// So the identity is computed once, here, from the machine actually running —
// and where the real Chrome can be asked its version, from the browser actually
// launching. Nothing is invented: every field is either read from this host or
// falls back to a constant that is honest about being one.
// -----------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const { realChromeBinaryPath } = require("./chromeBinary.js");

/**
 * The version claimed when this host's Chrome cannot be asked.
 *
 * Kept current deliberately: a version that has aged out of the release channel
 * is itself a signal, which is half of what was wrong with driving the pinned
 * Chrome-for-Testing 131. Bump it when it starts to look old.
 */
const FALLBACK_CHROME_MAJOR = 152;

/**
 * The installed Chrome's major version, read off disk. Null when it cannot be.
 *
 * Windows lays its Chrome out as
 * `…\Application\<full version>\chrome.dll`, so the directory listing IS the
 * version — no process to spawn, nothing to parse out of `--version`, and it
 * costs one readdir. macOS and Linux keep no such directory, so they fall back
 * rather than paying for a subprocess on every call.
 */
function installedChromeMajor({
    binary = realChromeBinaryPath(),
    readdir = fs.readdirSync,
} = {}) {
    if (!binary || !/chrome\.exe$/i.test(binary)) return null;

    try {
        const versions = readdir(path.win32.dirname(binary))
            .map((name) => /^(\d+)\.\d+\.\d+\.\d+$/.exec(name))
            .filter(Boolean)
            .map((match) => Number(match[1]));

        return versions.length > 0 ? Math.max(...versions) : null;
    } catch (_) {
        // A path we cannot read says nothing about the browser. Fall back.
        return null;
    }
}

/** Per OS: what a real Chrome on it says about itself. */
const PLATFORMS = {
    win32: { token: "Windows NT 10.0; Win64; x64", hint: '"Windows"' },
    darwin: { token: "Macintosh; Intel Mac OS X 10_15_7", hint: '"macOS"' },
    linux: { token: "X11; Linux x86_64", hint: '"Linux"' },
};

/**
 * The user-agent and client hints to send with a jar this host's browser minted.
 *
 * @param {{ platform?: string, major?: number|null }} [options]
 *        `major` null means "ask this host"; a number is used as given, which
 *        is what the tests do.
 * @returns {{ userAgent: string, headers: Record<string, string>, major: number }}
 */
function myntraBrowserIdentity({ platform = process.platform, major = null } = {}) {
    const os = PLATFORMS[platform] || PLATFORMS.linux;
    const version = major ?? installedChromeMajor() ?? FALLBACK_CHROME_MAJOR;

    return {
        major: version,
        userAgent:
            `Mozilla/5.0 (${os.token}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
            `Chrome/${version}.0.0.0 Safari/537.36`,
        headers: {
            // The brand list Chrome itself sends, with the version swapped.
            // `Not=A?Brand` is the deliberate-nonsense entry Chrome includes so
            // that parsers cannot assume a fixed set; it is part of the shape,
            // not a value to tidy up.
            "sec-ch-ua": `"Not=A?Brand";v="99", "Google Chrome";v="${version}", "Chromium";v="${version}"`,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": os.hint,
        },
    };
}

module.exports = {
    FALLBACK_CHROME_MAJOR,
    installedChromeMajor,
    myntraBrowserIdentity,
};
