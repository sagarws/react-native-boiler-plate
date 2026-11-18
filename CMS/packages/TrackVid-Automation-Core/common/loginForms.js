// -----------------------------------------------------------------------------
// Scripted sign-in descriptors — how to fill each platform's login form
// -----------------------------------------------------------------------------
// Consumed by Trackvid-CMS, which drives a marketplace login inside an Electron
// BrowserWindow when `settings.isAutoLoginOnActiveSession[platform]` is on, so
// an operator re-capturing a session does not have to type a password.
//
// These are DATA, not code: a declarative step list a driver interprets. That
// is deliberate. The server already logs in with puppeteer/selenium, and those
// APIs do not exist in a BrowserWindow — but the SELECTORS are the same, and
// the selectors are the part that rots. Keeping them in one place means a
// portal redesign is fixed once rather than twice.
//
// Every descriptor's selectors are lifted from that platform's existing server
// login, which stays the authority. Each file names the function it came from.
//
// ## Step vocabulary
//
//   { kind: "wait",      selector, label?, timeoutMs? }
//       Block until the selector matches a visible element.
//
//   { kind: "fill",      selector, field: "username"|"password",
//                        visibleOnly?, optional? }
//       Set an input's value. A driver MUST use the native value setter and
//       dispatch input+change — every one of these portals is React or Angular,
//       and assigning `.value` alone leaves the framework's state empty, so the
//       form submits blank.
//       `visibleOnly` picks the first element with a non-zero box: Chrome
//       injects hidden autofill inputs on some of these pages.
//
//   { kind: "click",     selector, label?, optional? }
//   { kind: "clickText", text, label?, optional? }
//       Click by exact trimmed text across a/button/div/span — several of these
//       portals have no usable id on the button.
//
//   { kind: "settle",    ms }
//       Fixed pause. Used only where the page animates a field into existence
//       with no selector that appears at the right moment.
//
// `optional: true` means a step that does not match is skipped rather than
// failing the sign-in — for launchers that are absent when the page opens
// straight onto the form.
//
// ## Outcome
//
//   success  { anySelector?: string[], urlIncludes?: string[], urlExcludes?: string[] }
//   failure  same shape — matched first, so a known error beats a timeout
//   otp      same shape — the driver hands the window to the operator instead
//            of failing, because a challenge is not a broken login
//   otpEntry { input, submit } — where a driver that can read the code types it
//   interstitials [{ whenText, clickText }] — a screen that may appear on the
//            way in (AJIO's "Select a sales channel"): while the page shows
//            `whenText`, click the visible element whose text is `clickText`
//
// `frameSelector` (Nykaa only) means every selector resolves inside that
// iframe rather than the top document.
//
// -----------------------------------------------------------------------------
// Static requires, never a computed path: Trackvid-CMS bundles its Electron
// main process and a bundler cannot follow a dynamic one. See CLAUDE.md.
// -----------------------------------------------------------------------------

const ajio = require("../platforms/ajio/common/loginForm.js");
const delhivery = require("../platforms/delhivery/common/loginForm.js");
const flipkart = require("../platforms/flipkart/common/loginForm.js");
const meesho = require("../platforms/meesho/common/loginForm.js");
const myntra = require("../platforms/myntra/common/loginForm.js");
const nykaa = require("../platforms/nykaa/common/loginForm.js");
const snapdeal = require("../platforms/snapdeal/common/loginForm.js");
const xbees = require("../platforms/xbees/common/loginForm.js");
const { platformKey } = require("./platforms.js");

const LOGIN_FORMS = {
    ajio,
    delhivery,
    flipkart,
    meesho,
    myntra,
    nykaa,
    snapdeal,
    xbees,
};

/**
 * The descriptor for one platform, or null when there is none.
 *
 * Null is a normal answer, not an error: a caller without a descriptor falls
 * back to asking the operator to sign in by hand, which is what every platform
 * did before this existed.
 */
function getLoginForm(platform) {
    const key = platformKey(platform);
    return LOGIN_FORMS[key] || null;
}

/** Platforms a scripted sign-in is described for. */
function platformsWithLoginForm() {
    return Object.keys(LOGIN_FORMS);
}

module.exports = { LOGIN_FORMS, getLoginForm, platformsWithLoginForm };
