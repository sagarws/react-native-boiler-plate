// Myntra — what a captured session needs beyond "the login worked".
//
// Two things, both learned from loginMyntraApi in
// ../claim-management/api-based-flow/claimApiFlow.js, which is the authority.
//
// 1. A HOP after signing in. The cookies the automation actually needs live on
//    partnersapi.myntrainfo.com and are host-scoped, not domain-scoped — so
//    they are not set by signing in at partners.myntrainfo.com and never appear
//    in a jar harvested there. One request to the API host materialises them.
//    The server does exactly this hop for exactly this reason.
//
// 2. `erp.at` and `session` must be present. The backend rejects the ingest
//    without them (REQUIRED_COOKIES in the Myntra ingest controller), and the
//    server's own login throws LOGIN_NO_COOKIES on the same condition. Checked
//    here too so the operator is told what is missing rather than handed a 400.
//
// See common/sessionExtras.js for the contract.

module.exports = {
    platform: "myntra",
    required: [],
    // Visited after a successful sign-in, before the jar is harvested.
    visitAfterLogin: ["https://partnersapi.myntrainfo.com/api/boot/partners"],
    requiredCookies: ["erp.at", "session"],
};
