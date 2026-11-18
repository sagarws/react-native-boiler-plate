// -----------------------------------------------------------------------------
// Claim failure cases — kept on disk, so the next one can be read rather than
// reproduced
// -----------------------------------------------------------------------------
// WHY THIS EXISTS. A Meesho claim failed for weeks with HTTP 500 and an empty
// body. Nothing about it could be diagnosed from the row, the log line or the
// error: the response said nothing, and the REQUEST — the only thing that
// differed from a filing that worked — existed nowhere after the process
// exited. It was finally settled by filing the same claim by hand in the
// portal and diffing the browser's payload against ours, which found three
// keys we were leaving out.
//
// That is not a debugging step anybody should have to take twice. When a claim
// fails in a way the flow cannot explain, the case is written here instead:
// what was sent, what came back, and enough of the row to find it again.
//
// WHAT IT IS NOT. Not a log, not a record, not a queue. It is a small ring of
// recent unexplained failures for a person to open. A run must never depend on
// it, so every function here swallows its own errors and the worst outcome of
// a broken store is that a failure goes undocumented — never that a claim that
// would have filed does not.
//
// WHAT NEVER GOES IN. Cookies, tokens, signed URLs, passwords, and the seller's
// own prose. Response bodies go through `redact` from apiResponseLogger — the
// same rule the terminal line uses, deliberately shared rather than copied —
// and callers pass a DESCRIPTION of the request, not the request: keys, types
// and sizes, with values only where they are identifiers the portal already
// shows on screen.
// -----------------------------------------------------------------------------

const fs = require("fs");
const os = require("os");
const path = require("path");

const { redact } = require("./apiResponseLogger");

/**
 * Where cases are written.
 *
 * `os.tmpdir()` rather than the working directory, because the two consumers
 * disagree about what that is: the automation server runs from a checkout it
 * can write to, and a packaged Electron app's resources directory is read-only
 * on macOS. A temp path is writable in both and survives long enough to be
 * read after a failure — which is the whole window this serves.
 *
 * `CLAIM_FAILURE_DIR` overrides it, for an operator who wants the cases beside
 * the rest of a run's output.
 */
function failureDir() {
    return process.env.CLAIM_FAILURE_DIR || path.join(os.tmpdir(), "trackvid-claim-failures");
}

/**
 * How many cases to keep.
 *
 * A RING, not an archive. These are read within hours of the failure that
 * wrote them or not at all, and an unbounded directory of payloads is a slow
 * leak of claim data onto an operator's machine. Oldest go first.
 */
const KEEP = Number(process.env.CLAIM_FAILURE_KEEP) || 50;

/** Safe for every filesystem, and still recognisable. */
function slug(value) {
    return String(value || "unknown").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
}

/**
 * Drops the oldest cases once there are more than `KEEP`.
 *
 * By NAME, not by mtime: the name begins with an ISO timestamp, so a lexical
 * sort is chronological and needs no stat() per file.
 */
function trim(dir) {
    try {
        const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();

        for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
            try {
                fs.unlinkSync(path.join(dir, name));
            } catch (_) {
                /* a file that cannot be removed is not worth failing over */
            }
        }
    } catch (_) {
        /* the directory may have gone; the write below will recreate it */
    }
}

/**
 * Writes one failure case, and returns where it went.
 *
 * @param {string} platform  ajio | meesho | …
 * @param {object} kase
 * @param {string}  kase.code       the claim code an operator will read (MR1: …)
 * @param {string} [kase.reason]    one line on why the flow could not explain it
 * @param {string} [kase.awbNumber]
 * @param {string} [kase.subOrderNumber]
 * @param {string} [kase.account]   which login filed it
 * @param {number} [kase.status]    the HTTP status that came back
 * @param {unknown} [kase.request]  a DESCRIPTION of what was sent — never the
 *        request itself; see the header
 * @param {unknown} [kase.response] the body as received; redacted here
 * @param {object} [logger]
 * @returns {string|null} the file written, or null if nothing could be
 */
function saveClaimFailure(platform, kase = {}, logger) {
    try {
        const dir = failureDir();

        fs.mkdirSync(dir, { recursive: true });
        trim(dir);

        const at = new Date().toISOString();
        const name = `${at.replace(/[:.]/g, "-")}-${slug(platform)}-${slug(kase.awbNumber)}.json`;
        const file = path.join(dir, name);

        fs.writeFileSync(
            file,
            JSON.stringify(
                {
                    at,
                    platform,
                    code: kase.code || null,
                    reason: kase.reason || null,
                    account: kase.account || null,
                    awbNumber: kase.awbNumber || null,
                    subOrderNumber: kase.subOrderNumber || null,
                    status: kase.status ?? null,
                    // Already a description by contract. Redacted anyway: a
                    // caller that passes the real payload one day should lose
                    // its secrets here rather than write them to disk.
                    request: redact(kase.request ?? null),
                    response: redact(kase.response ?? null),
                },
                null,
                2
            ),
            "utf8"
        );

        // Said out loud, with the path. A file nobody knows was written is the
        // same as no file — and the operator reading the terminal after a
        // failure is exactly who needs to know it exists.
        const line = `🧾 ${platform} failure case saved for debugging → ${file}`;

        (logger && typeof logger.warn === "function" ? logger.warn : console.warn).call(
            logger || console,
            line
        );

        return file;
    } catch (error) {
        try {
            (logger && typeof logger.warn === "function" ? logger.warn : console.warn).call(
                logger || console,
                `⚠️ could not save the ${platform} failure case: ${error && error.message}`
            );
        } catch (_) {
            /* nothing left to try */
        }

        return null;
    }
}

/** Cases on disk, newest first — for a consumer that wants to list them. */
function listClaimFailures() {
    try {
        return fs
            .readdirSync(failureDir())
            .filter((name) => name.endsWith(".json"))
            .sort()
            .reverse()
            .map((name) => path.join(failureDir(), name));
    } catch (_) {
        return [];
    }
}

module.exports = { saveClaimFailure, listClaimFailures, failureDir };
