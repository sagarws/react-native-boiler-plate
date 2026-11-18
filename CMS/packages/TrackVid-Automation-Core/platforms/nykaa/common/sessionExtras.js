// Nykaa — the non-cookie half of a captured session.
//
// One field, and it is a CONSTANT rather than something to discover: Zoho's
// `portalId` is per tenant, identical across every Nykaa seller account, and on
// every /portal/api/* call as a query parameter. See ./portal.js.
//
// WHY A DESCRIPTOR AT ALL, for a value that never varies. Because the capture
// only stores what a descriptor names. Without one, a jar harvested from a
// manual sign-in reached the session probe with no portalId, and that probe
// answers `false` before making a request — so a real Nykaa login was reported
// as "not a signed-in Nykaa login". The login path never hit it, because its
// own response carries the id; only the window capture did.
//
// `fromJar` rather than `pageScript`: nothing has to be read from the page, and
// a page read is the half that can fail.
//
// See common/sessionExtras.js for the contract.

const { NYKAA_PORTAL_ID } = require("./portal.js");

/**
 * @returns {{ portalId: string }}
 */
function fromJar() {
    return { portalId: NYKAA_PORTAL_ID };
}

module.exports = {
    platform: "nykaa",
    required: ["portalId"],
    fromJar,
};
