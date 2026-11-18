// -----------------------------------------------------------------------------
// Nykaa — the Zoho portal id every call is addressed by
// -----------------------------------------------------------------------------
// Nykaa's seller dispute portal is Zoho Desk, and `portalId` is a query
// parameter on every /portal/api/* call: the identity probe, the department
// vocabulary, the ticket submit, the ticket list. It is a per-TENANT public
// identifier — not a secret, and the same for every Nykaa seller account —
// which is why it can be a constant at all.
//
// HERE RATHER THAN IN THE CLAIM FLOW, because the claim flow is no longer the
// only thing that needs it. A captured session is judged by asking
// /portal/api/me?portalId=…, and a session stored without one is judged DEAD
// without a request being made ("Probe skipped — no portalId cached"). That
// rejected manual captures that had plainly worked: the operator signed in,
// the app harvested the cookies, and the check refused them over a query
// parameter nobody had put in the record.
// -----------------------------------------------------------------------------

/** Captured from live traffic; override with NAYKAA_PORTAL_ID. */
const NYKAA_PORTAL_ID =
    process.env.NAYKAA_PORTAL_ID ||
    "edbsn77edc5e13be14453822b32ccf3e7632793c200458760680704c3baa40775fa28";

module.exports = { NYKAA_PORTAL_ID };
