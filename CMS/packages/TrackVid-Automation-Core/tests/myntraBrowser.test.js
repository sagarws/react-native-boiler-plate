const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
    chromeCandidates,
    realChromeBinaryPath,
    realChromeRequiredError,
} = require("../platforms/myntra/common/chromeBinary.js");
const runtime = require("../common/browserRuntime.js");
const {
    installedChromeMajor,
    myntraBrowserIdentity,
    FALLBACK_CHROME_MAJOR,
} = require("../platforms/myntra/common/browserIdentity.js");

/**
 * Which browser drives Myntra's sign-in, and who it then says it is.
 *
 * BOTH HALVES ARE ONE FACT. The login is a real Chrome; every call afterwards
 * is axios replaying that Chrome's cookies. Akamai fronts the portal and sees
 * one session across both, so a disagreement between them — a different OS, a
 * different Chrome version, a browser that announces itself as an automation
 * build — is not a cosmetic inconsistency. It is the thing that comes back as
 * a red "Network Error" under the LOG IN button, which names neither the
 * browser nor the headers and sends everyone looking at the network.
 *
 * These are pure functions over an injected filesystem, so the paths and the
 * strings can be pinned exactly. What they guard is a silent fallback: nothing
 * throws when Chrome is not found — the sign-in just quietly becomes one that
 * cannot succeed.
 */

const existsOnly = (...present) => {
    const set = new Set(present);

    return (candidate) => set.has(candidate);
};

const WINDOWS_ENV = {
    LOCALAPPDATA: "C:\\Users\\op\\AppData\\Local",
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
};

test("looks for Chrome where Windows actually puts it", () => {
    // THE BUG THIS EXISTS FOR: there was no Windows branch at all, on the one
    // OS the desktop app runs on. Every operator's Myntra login fell through to
    // the pinned Chrome for Testing and was refused by Akamai.
    const candidates = chromeCandidates(WINDOWS_ENV, "win32");

    assert.deepEqual(candidates, [
        "C:\\Users\\op\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]);
});

test("finds a per-user Windows install, which a machine-wide search misses", () => {
    const perUser = "C:\\Users\\op\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";

    assert.equal(
        realChromeBinaryPath({
            env: WINDOWS_ENV,
            platform: "win32",
            exists: existsOnly(perUser),
        }),
        perUser
    );
});

test("falls back to the literal Program Files when the environment is scrubbed", () => {
    // A service or scheduled task does not necessarily inherit PROGRAMFILES.
    const machineWide = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

    assert.equal(
        realChromeBinaryPath({ env: {}, platform: "win32", exists: existsOnly(machineWide) }),
        machineWide
    );
});

test("CHROME_BINARY_PATH outranks every guess, on every OS", () => {
    // The operator's escape hatch, and the one the fallback warning names.
    const chosen = "D:\\tools\\chrome\\chrome.exe";

    assert.equal(
        realChromeBinaryPath({
            env: { ...WINDOWS_ENV, CHROME_BINARY_PATH: chosen },
            platform: "win32",
            exists: existsOnly(chosen, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"),
        }),
        chosen
    );
});

test("a configured path that does not exist is not used", () => {
    // Otherwise a typo in .env hands Selenium a binary that cannot launch, and
    // the failure arrives as a driver error rather than as "no Chrome here".
    assert.equal(
        realChromeBinaryPath({
            env: { CHROME_BINARY_PATH: "/nope/chrome" },
            platform: "linux",
            exists: existsOnly("/usr/bin/google-chrome"),
        }),
        "/usr/bin/google-chrome"
    );
});

test("knows the Linux names beyond the Debian symlink", () => {
    assert.equal(
        realChromeBinaryPath({
            env: {},
            platform: "linux",
            exists: existsOnly("/opt/google/chrome/chrome"),
        }),
        "/opt/google/chrome/chrome"
    );
});

test("answers null when the machine has no real Chrome", () => {
    // Null is an answer, not a crash: the sign-in still runs. The caller's job
    // is to say what it got, which is what the warning is for.
    assert.equal(
        realChromeBinaryPath({
            env: {},
            platform: "win32",
            exists: () => false,
            queryRegistry: () => null,
        }),
        null
    );
});

test("the calls after the login claim the OS the login ran on", () => {
    // WHAT IT REPLACED: a hardcoded macOS Chrome 151, sent from every machine —
    // including the Windows desktop whose browser had just minted the cookies
    // those calls carry.
    const windows = myntraBrowserIdentity({ platform: "win32", major: 152 });

    assert.match(windows.userAgent, /Windows NT 10\.0; Win64; x64/);
    assert.match(windows.userAgent, /Chrome\/152\.0\.0\.0/);
    assert.equal(windows.headers["sec-ch-ua-platform"], '"Windows"');
    assert.equal(
        windows.headers["sec-ch-ua"],
        '"Not=A?Brand";v="99", "Google Chrome";v="152", "Chromium";v="152"'
    );

    const mac = myntraBrowserIdentity({ platform: "darwin", major: 152 });

    assert.match(mac.userAgent, /Macintosh; Intel Mac OS X/);
    assert.equal(mac.headers["sec-ch-ua-platform"], '"macOS"');
});

test("the version comes off the installed Chrome, not a constant", () => {
    // Windows keeps its Chrome in a directory named for the full version, so
    // the listing IS the version — no subprocess, no --version parsing.
    assert.equal(
        installedChromeMajor({
            binary: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            readdir: () => ["152.0.6723.117", "151.0.6621.99", "SetupMetrics", "chrome.exe"],
        }),
        152
    );
});

test("falls back to a stated version rather than guessing from a path it cannot read", () => {
    assert.equal(
        installedChromeMajor({
            binary: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            readdir: () => {
                throw new Error("EACCES");
            },
        }),
        null
    );

    // And the identity still answers, with the constant it documents.
    assert.equal(
        myntraBrowserIdentity({ platform: "linux" }).major,
        FALLBACK_CHROME_MAJOR
    );
});

test("finds Chrome installed to a custom folder through the registry", () => {
    // The install a fixed-path search misses: a company deployment or a custom
    // folder. Windows still records it under App Paths.
    const custom = "D:\\Apps\\Chrome\\chrome.exe";

    assert.equal(
        realChromeBinaryPath({
            env: WINDOWS_ENV,
            platform: "win32",
            exists: existsOnly(custom),
            queryRegistry: (key) => (key.startsWith("HKLM\\SOFTWARE\\Microsoft") ? custom : null),
        }),
        custom
    );
});

test("a registry entry pointing at a deleted Chrome is not used", () => {
    assert.equal(
        realChromeBinaryPath({
            env: WINDOWS_ENV,
            platform: "win32",
            exists: () => false,
            queryRegistry: () => "D:\\Gone\\chrome.exe",
        }),
        null
    );
});

test("the registry is only asked on Windows, and only after the fixed paths miss", () => {
    let asked = 0;
    const queryRegistry = () => {
        asked++;
        return null;
    };
    const perUser = "C:\\Users\\op\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";

    realChromeBinaryPath({ env: WINDOWS_ENV, platform: "win32", exists: existsOnly(perUser), queryRegistry });
    realChromeBinaryPath({ env: {}, platform: "linux", exists: () => false, queryRegistry });

    assert.equal(asked, 0);
});

test("the pinned substitute stays allowed unless a consumer refuses it", () => {
    // The server never calls the setter and must keep falling back as before.
    assert.equal(runtime.pinnedFallbackIsAllowed(), true);

    runtime.setPinnedFallbackAllowed(false);
    assert.equal(runtime.pinnedFallbackIsAllowed(), false);

    runtime.setPinnedFallbackAllowed(true);
    assert.equal(runtime.pinnedFallbackIsAllowed(), true);
});

test("the no-Chrome error names the fix and is not mistaken for a retryable blip", () => {
    for (const reason of ["not-found", "no-driver"]) {
        const err = realChromeRequiredError(reason);

        assert.equal(err.code, "REAL_CHROME_REQUIRED");
        assert.match(err.message, /Google Chrome/);
        // The login retry loop relaunches on these; a missing browser stays missing.
        assert.doesNotMatch(err.message, /network\s*error|timed?\s*out|ERR_/i);
    }
});
