// -----------------------------------------------------------------------------
// OS-level mouse input — whichever robotjs build this host actually has
// -----------------------------------------------------------------------------
// Myntra's login needs a click that arrives through the OS input pipeline
// rather than WebDriver. That is not a preference: Akamai's fingerprinter
// distinguishes the two, and a WebDriver click on the LOG IN button trips
// "Network Error" (HTTP/2 RST on the auth POST) while a physical click in the
// same session passes. Experimentally confirmed — see osLevelClickAt in
// ../platforms/myntra/claim-management/common/utils.js.
//
// The problem is `robotjs` itself. It is unmaintained, ships no prebuilt binary
// for a modern Node, and will not build on Node 24 — so the original
// `require("robotjs")` failed on every current host and Myntra's login died
// after correctly entering the email and password, at the click.
//
// So try the known builds in order and use the first that loads. They are
// API-compatible for the three calls used here (moveMouseSmooth, mouseClick,
// getMousePos), so the caller does not care which answered.
//
//   @jitsi/robotjs   maintained fork with prebuilds for current Node — verified
//                    working on Node 24
//   robotjs          the original, for hosts that already have it built
//
// Every one is an OPTIONAL dependency. A consumer that never signs in to Myntra
// must not need a native module to import this package, and Trackvid-CMS is
// exactly that case.
// -----------------------------------------------------------------------------

const CANDIDATES = ["@jitsi/robotjs", "robotjs"];

let resolved;

/**
 * The loaded module, or null when none is available.
 *
 * Resolved once and cached, including the null: a missing native module will
 * not appear later in the same process, and retrying makes every call pay for
 * a failed resolution.
 */
function loadOsInput() {
    if (resolved !== undefined) return resolved;

    const tried = [];

    for (const name of CANDIDATES) {
        try {
            resolved = require(name);
            return resolved;
        } catch (err) {
            tried.push(`${name} (${(err.message || "").split("\n")[0]})`);
        }
    }

    console.warn(
        `⚠️ No OS-level input module available — tried ${tried.join("; ")}. ` +
        `Myntra's login needs one; install @jitsi/robotjs on this host.`
    );
    resolved = null;
    return resolved;
}

/** True when an OS-level click is possible here. */
function hasOsInput() {
    return loadOsInput() !== null;
}

/**
 * The error to throw when a click is needed and nothing can perform it.
 * Names the fix, because "robotjs failed to load" told an operator nothing
 * they could act on.
 */
function osInputUnavailableError() {
    const err = new Error(
        "This sign-in needs an OS-level mouse click, which the automation host cannot perform: " +
        "no robotjs build is installed. Run `npm install @jitsi/robotjs` on the automation server " +
        "(the original robotjs does not build on current Node)."
    );
    err.code = "OS_INPUT_UNAVAILABLE";
    return err;
}

module.exports = { loadOsInput, hasOsInput, osInputUnavailableError, CANDIDATES };
