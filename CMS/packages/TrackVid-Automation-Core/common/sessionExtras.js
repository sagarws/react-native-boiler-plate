// -----------------------------------------------------------------------------
// Session extras — the parts of a captured session that are not cookies
// -----------------------------------------------------------------------------
// A cookie jar is not a whole session on every platform. Four of the eight
// ingest endpoints reject a jar on its own:
//
//   ajio       userId (activeSellerProfileId) + pobIds — every API URL is built
//              around the userId, and the download API needs a place of business
//   flipkart   csrfToken — Flipkart signs every call with fk-csrf-token
//   nykaa      portalId — a per-tenant constant, but one the session probe
//              refuses to run without
//   meesho     supplierId — read from the supplier boot config, not a cookie
//   delhivery  accessToken + refreshToken + realm — NOT cookie-based at all
//   xbees      accessToken + refreshToken — same
//
// This module covers the first two, which can be read from a signed-in page or
// from the jar itself. Delhivery and Xbees need the OAuth token RESPONSE to be
// intercepted as it arrives, which is a different capture shape entirely (the
// server does it with a Puppeteer response listener) and is not implemented for
// the desktop app yet — see platformsNeedingTokenCapture below.
//
// It also covers the two ways a capture can be incomplete without being wrong:
//
//   myntra     the cookies the automation needs are host-scoped to
//              partnersapi.myntrainfo.com, so signing in at
//              partners.myntrainfo.com never sets them. One hop does.
//              It also has REQUIRED cookies the ingest endpoint enforces.
//
// ## Contract
//
// A descriptor has `required` (field names the ingest endpoint will reject the
// session without) plus ONE source:
//
//   pageScript  a self-contained JS expression, evaluated in the signed-in page,
//               resolving to the extras object — or `{ error }` if it cannot.
//               A string because Trackvid-CMS has no Puppeteer; it evaluates
//               this with webContents.executeJavaScript, which resolves a
//               returned Promise just as page.evaluate does.
//
//   fromJar     a pure function over the harvested cookies, for extras that are
//               already in the jar. Returns the extras, or `{ error }`.
//               Preferred when possible: no page access, and testable.
//
// Either may also return `warning`, for a value found by a fallback the caller
// should know fired.
//
// Two more optional fields, about the cookies rather than the extras:
//
//   visitAfterLogin  URLs to load after a successful sign-in and before the jar
//                    is harvested, for cookies that are host-scoped to an API
//                    domain the login page never touches.
//
//   requiredCookies  names the session is useless without. Checked locally so
//                    the operator is told what is missing, instead of reading a
//                    backend 400 phrased in terms of its own contract.
// -----------------------------------------------------------------------------

// Static requires, never a computed path — Trackvid-CMS bundles its main
// process and a bundler cannot follow a dynamic one. See CLAUDE.md.
const ajio = require("../platforms/ajio/common/sessionExtras.js");
const flipkart = require("../platforms/flipkart/common/sessionExtras.js");
const myntra = require("../platforms/myntra/common/sessionExtras.js");
const meesho = require("../platforms/meesho/common/sessionExtras.js");
const nykaa = require("../platforms/nykaa/common/sessionExtras.js");

const SESSION_EXTRAS = { ajio, flipkart, meesho, myntra, nykaa };

/**
 * The descriptor for one platform, or null when a jar is the whole session.
 *
 * Null is the common case and not an error — the remaining platforms need
 * nothing more than the cookies their login page sets.
 */
function getSessionExtras(platform) {
    const key = String(platform || "").toLowerCase().trim();
    return SESSION_EXTRAS[key] || null;
}

/**
 * Platforms whose session is OAuth tokens rather than cookies.
 *
 * Listed so a caller can say so plainly instead of shipping a jar the ingest
 * endpoint will reject for reasons that read like a capture bug.
 */
const platformsNeedingTokenCapture = () => ["delhivery", "xbees"];

module.exports = { SESSION_EXTRAS, getSessionExtras, platformsNeedingTokenCapture };
