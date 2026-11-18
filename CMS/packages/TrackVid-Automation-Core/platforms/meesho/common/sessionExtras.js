// Meesho — the non-cookie half of a captured session.
//
// A Meesho claim needs `supplierId`, and it is not a cookie. It comes from the
// boot config the supplier SPA loads on every page:
//
//   POST /api/container/supplier/prefetch-supply-data
//
// Until this existed, a captured Meesho session was cookies alone — complete
// enough to look Active on the Sessions page, and incomplete for every claim.
// So each claim signed in a SECOND time purely to make that one call, and an
// operator watched two browsers open back to back for one claim.
//
// Reading it here means the sign-in that already happened produces a session a
// claim can use, and the second one stops happening.
//
// WHY A pageScript RATHER THAN fromJar: the value genuinely is not in the jar.
// Flipkart's csrf token is a cookie under an obfuscated name, so its descriptor
// can be a pure function; this one has to ask the API, from inside the
// signed-in page, with the session's own cookies.
//
// WHICH API, though, is the part that was wrong. This asked supplier/config and
// read `supplier_id` off it — a field that response does not have. Every capture
// stored null, every run called the session incomplete and signed in again, and
// the panel answered 403 "Identifier not present or invalid" when it did get
// through. The identity call is prefetch-supply-data; see
// platforms/meesho/common/supplierIdentity.js, which both this capture and the
// Puppeteer login now share.
//
// See common/sessionExtras.js for the contract.

const { IDENTITY_PAGE_SCRIPT } = require("./supplierIdentity.js");

module.exports = {
    platform: "meesho",
    // BOTH, now. The slug is not decoration: it is the `identifier` header on
    // every panel call, and a session without it is refused with a message that
    // reads like an expired one.
    required: ["supplierId", "supplierIdentifier"],
    pageScript: IDENTITY_PAGE_SCRIPT,
};
