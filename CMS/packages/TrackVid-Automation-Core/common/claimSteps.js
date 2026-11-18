// -----------------------------------------------------------------------------
// The claim pipeline, per marketplace, in the order it actually runs
// -----------------------------------------------------------------------------
// Every platform's claim is a sequence of calls with fallbacks between them, and
// until now that sequence only existed as control flow spread across three
// files. This is the same sequence written down: what is tried, in what order,
// and what happens when a step does not answer.
//
// WHY IT IS WORTH A FILE:
//
//   1. It is the first thing anybody asks when a claim fails — "what did it
//      even do?" — and reading it out of a stack trace is slow and unreliable.
//   2. The fallbacks are the part that keeps being added to (a TAT check after
//      an opaque 500, a sub-order check after that, a ticket lookup after any
//      failure at all) and the part nobody remembers a week later.
//   3. Both runners file the same claims. A step added on one side and not the
//      other is exactly the drift this package exists to prevent.
//
// It is DESCRIPTION, not dispatch: nothing reads these strings to decide what
// to call. Keeping it that way is deliberate — a sequence that drove the code
// would need every step to be a function, and the code would be harder to read
// than the flow it documents. What it costs is the discipline to change both
// together, and what it buys is a page anybody can read.
//
// A step's wording says the CALL and, where it matters, the CONDITION. "If the
// previous step failed" is the common one; a step with no condition always runs.
// -----------------------------------------------------------------------------

/**
 * One claim, per platform, step by step.
 *
 * @type {Record<string, Record<string, string>>}
 */
const CLAIM_STEPS = {
    meesho: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Read the supplier identity — supplier_id and identifier — from prefetch-supply-data when the session carries neither",
        step3: "Resolve the sub-category id for this type of claim (getSubCategoryList)",
        step4: "Upload every image and the video (upload/supplier-support/input-attachment)",
        step5: "File the claim (createTicket). A refusal arrives as HTTP 200 with is_valid:false and Meesho's own words",
        step6: "If step5 answered a bare HTTP 500 with an empty backendData: ask validateTicketField whether the claim window has closed → ME1: TAT expired",
        step7: "If step6 says the window is open: ask validateTicketField about the sub-order number ALONE → ME2: Invalid sub order number.",
        step8: "Read the ticket back by sub-order (searchTickets) when createTicket returned no ticket id",
        step9: "If the claim failed for any reason: search the tickets once more — a ticket that exists now was filed by this run, and the row is a success with a ticket id rather than a failure",
    },

    snapdeal: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Find the return (globalSearch by AWB, then by sub-order) and read which KIND of return it is — Buyer_Return, Courier_Return",
        step3: "If nothing is found: ask getDisputes, because a return that has been disputed LEAVES the search. Still nothing → SE1: Invalid Awb number",
        step4: "If the return already carries a dispute id: stop and report that dispute rather than filing a second one",
        step5: "Fetch the issue vocabulary for THAT return type (issueCategories) and resolve the type of claim against it",
        step6: "Upload every image and the video (uploadAttachment, uploadVideoAttachment)",
        step7: "File the dispute (raiseDispute) under the return's own type. A rejection arrives as HTTP 200 with success:false",
        step8: "If step7 failed ambiguously — a 5xx or a dropped connection, which can fail AFTER the case was created: ask getDisputes whether a dispute now exists on the suborder",
        step9: "If the claim failed for any reason: ask getDisputes once more — a dispute that exists now was filed by this run, and its status is read back with it",
    },

    ajio: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Find the return in the claim list (by RT number, or by AWB where the row carries no RT)",
        step3: "Upload every image and the video",
        step4: "File the claim",
        step5: "Read the ticket back from the claim list",
    },

    myntra: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Find the claim row (fetchNewClaim by return AWB) — it also carries the forward leg's tracking id",
        step3: "Upload every image and the video",
        step4: "File the claim (createTicket)",
        step5: "Read the ticket back (fetchClaimByTicketId), which also reports the compensation once Myntra has settled",
    },

    flipkart: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Read the return and check it is claimable — Flipkart reports a closed window as claim_eligible=false with a reason → FE2: TAT expired of 14 days",
        step3: "Resolve the product type and the issue vocabulary for it",
        step4: "Upload every image and the video",
        step5: "File the claim",
        step6: "Read the claim back (GetSpfClaimCounts + GetSpfClaims), which reports the status and the approved amount",
    },

    delhivery: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Raise the lost/damaged claim",
        step3: "Read it back from the lost/damaged claims list",
    },

    tatacliq: {
        step1: "Resolve the account and reuse its stored session — every Tata CliQ sign-in spends an emailed OTP, so a reused session is worth more here than anywhere else",
        step2: "Read the slave list the session can see; a return is visible only to the slave that owns it",
        step3: "Find the return under its slave, or sweep every slave when the claim names none. No Search Found on a live session → TAT Expired",
        step4: "Upload every image and the video",
        step5: "File the claim",
    },

    xbees: {
        step1: "Resolve the account and reuse its stored session (sign in only if there is none)",
        step2: "Search the dispute by AWB — it answers whether one already exists",
        step3: "File the dispute",
    },
};

/** The steps for one platform, in order. Empty for a platform with no entry. */
function claimSteps(platform) {
    const steps = CLAIM_STEPS[String(platform || "").toLowerCase().trim()] || {};

    return Object.keys(steps)
        .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
        .map((key) => ({ key, description: steps[key] }));
}

module.exports = { CLAIM_STEPS, claimSteps };
