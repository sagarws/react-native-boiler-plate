// -----------------------------------------------------------------------------
// Claim error codes — the words an operator reads in the Script Error column
// -----------------------------------------------------------------------------
// A claim that ends badly ends with one line of text on the row, and that line
// is the only thing anybody sees until they go digging. So the lines that MEAN
// something are written once, here, rather than typed wherever they happen to
// be needed.
//
// Two reasons this is a module rather than a string in each caller:
//
//   1. THEY ARE MATCHED, not just displayed. The claims filter, the status
//      sweeps and an operator's own eye all key on the exact text; two copies
//      that drift by a capital letter split one reason into two.
//   2. BOTH RUNNERS WRITE THEM. A row filed by the server and a row filed by
//      the desktop app must give the same reason for the same thing, or the
//      column stops being answerable at all.
//
// The `ME<n>:` prefix is Meesho's numbering, kept short because the column is
// narrow and the code is what gets searched for. The marketplace's own sentence
// is not folded in — it rides on the error object for the log and the report,
// where there is room for it.
// -----------------------------------------------------------------------------

/**
 * The claim window has closed — Meesho's "within 7 days of return delivery".
 *
 * Written by two paths that must agree: the Check TAT sweep, which asks
 * `validateTicketField` before anything is filed, and the claim itself, which
 * meets the same refusal on submit. Same fact, same words, whichever found it.
 */
const TAT_EXPIRED = "ME1: TAT expired";

/**
 * Meesho does not recognise the sub-order number on the row.
 *
 * Its own words are "Please enter a valid sub order number." — which, on a
 * claim, means the row cannot be filed until the number is corrected. Unlike a
 * closed window this one is FIXABLE: Refill Data can read the right sub-order
 * number off the Returns search and write it back, and the claim then files
 * normally. So it is a different code, not a second spelling of the same one.
 */
const INVALID_SUB_ORDER = "ME2: Invalid sub order number.";

/**
 * Meesho has no return under this AWB on the account that was searched.
 *
 * What reached the column before was the raw machine tag and the account name —
 * "NO_RETURN_PACKETS: Wrong awb number, Not exist in account ops@example.com" —
 * which is three problems in one line: it leads with a word from the code rather
 * than from the business, it is too long for the column so the useful half is
 * truncated away, and it cannot be filtered on because the account name makes
 * every occurrence a different string.
 *
 * A CODE OF ITS OWN, not ME2's. Both mean "the identifiers on this row do not
 * match Meesho", but they are fixed differently: a bad sub-order number is
 * repaired by Refill Data, while an AWB that is on no account at all is either
 * mistyped or the claim names the wrong seller login, and a person has to look.
 * Sharing one code would merge two queues with two different owners.
 *
 * The search that decides this asks twice — by AWB, then by sub-order number —
 * so by the time this is written, Meesho has been asked every way the row
 * allows. See platforms/meesho/common/returnsSearch.js.
 *
 * The account that was asked is not in the text. It rides on the error and goes
 * to the log, where there is room for it.
 */
const MEESHO_INVALID_AWB = "ME3: Invalid AWB number";

/**
 * Meesho will not take the claim yet: the return has not reached the seller.
 *
 * Its own words are "You can create this ticket only if your return order has
 * been delivered. Please collect your return delivery and then create this
 * ticket." — three lines that reached the Script Error column as
 * `CLAIM_REFUSED: You can create this ticket only if…`, wrapped over the whole
 * row and unreadable at a glance.
 *
 * NOT TERMINAL, AND THAT IS THE POINT OF NAMING IT. Unlike a closed window
 * this claim becomes filable on its own — the return is in transit, and
 * Meesho even says "try again in 1 hour". So the row must stay retryable: a
 * code that read as final here would write off a claim that only needed
 * waiting, which is the same mistake as calling a payload fault "TAT expired".
 *
 * It is a WAITING state, and the only thing an operator can do about it is
 * nothing — so the words say what is true rather than what to fix.
 *
 * ME4 AND NOT ME3, though ME3 is where the numbering would have continued.
 * ME3 is already "Invalid AWB number", and two meanings under one number is
 * the thing the header of this file warns about: the code is what people say
 * out loud and search for, so a shared number splits one queue in half however
 * distinct the full strings are.
 */
const MEESHO_RETURN_NOT_DELIVERED = "ME4: Return is not delivered";

/**
 * Meesho says a ticket already exists — and no search can find it.
 *
 * THE END OF A RECOVERY, NOT A REFUSAL. The claim flow answers "already been
 * raised for this issue" by going and looking for that ticket, because the
 * number is not in Meesho's sentence (its API sends `{{ticket_id}}`
 * unrendered). Usually it finds one, records it, and the row closes properly.
 *
 * This is what is left when it does not: Meesho is certain a ticket exists,
 * every sub-order number the row knows has been searched, and nothing came
 * back. The two facts cannot both be acted on, so the row must say so rather
 * than pick one.
 *
 * IT MUST NOT BE RETRIED BLINDLY. Filing again is how the ticket Meesho is
 * refusing to show becomes two tickets for one return. What it needs is a
 * person to open the account and find it by hand — which is why this reads as
 * a state, not as a fault to fix on the row.
 */
const MEESHO_ALREADY_RAISED_NO_TICKET =
    "ME5: Meesho already has a ticket for this issue but ticket not getting";

/**
 * The Packet ID on the row is not a packet id.
 *
 * Meesho's own words are three sentences — "Looks like you are filling the AWB
 * number in the Packet ID field. Please fill correct value in the Packet ID
 * field. If you don't have a packet id, please fill NA." — which reached the
 * Script Error column as `CLAIM_REFUSED: Looks like you are filling the AWB…`
 * and wrapped over the row, saying nothing at a glance.
 *
 * IT NAMES ITS OWN FIX, which is why it is worth a code. The portal's Packet ID
 * is a label of its own (DLVPCP017051342); the commonest way to get this is to
 * copy the AWB into it, and Meesho will take literal "NA" where there is no
 * packet id at all. So the row is correctable by hand, by one person, without
 * asking the marketplace anything.
 *
 * A CODE OF ITS OWN, not ME3's. ME3 is an AWB that exists on no account — the
 * number is wrong. Here the AWB is usually right and merely in the wrong box,
 * and the two are fixed in different places on the form. Sharing a number would
 * merge the queue of rows that need a packet id with the queue of rows whose
 * seller account is wrong.
 *
 * Meesho's sentence is not folded in: it rides on the error for the log, where
 * there is room for it.
 */
const MEESHO_INVALID_PACKET_ID = "ME6: Invalid Packet ID";

/**
 * Meesho refused the claim and would not say why.
 *
 * THE ONE THIS IS FOR: HTTP 500 with an empty body, after the flow has asked
 * every question it can and been told nothing is wrong — the claim window is
 * open, the sub-order number is one Meesho recognises, and it still will not
 * take the ticket. That combination means the REQUEST is the problem, not the
 * row, and it has been real: three `ticket_details` keys the portal always
 * sends were conditional here, so a claim whose row carried none of them
 * submitted a shape the portal never produces. The same claim filed by hand
 * went through, which is how it was finally found.
 *
 * SO IT IS A CODE, NOT A RETRY. Nothing on the row can be corrected to make it
 * file, and retrying it nightly asks the same rejected question for ever. The
 * fix is a code change, and this is the flag that says so.
 *
 * DISTINCT FROM ME1 ON PURPOSE. A bare 500 used to be reported as "TAT
 * expired, unverified" on the reasoning that a closed window is its commonest
 * cause. That reading is right often enough to keep where the window cannot be
 * checked — but where the window has been checked and is OPEN, calling it TAT
 * expired closes a claimable return and hides the defect that caused it.
 *
 * Every occurrence writes its case to `common/claimFailureStore`: what was
 * sent, what came back, and the identifiers to find the row again. Without it
 * the next one is diagnosed the way this one was — by filing the same claim by
 * hand and diffing the browser's payload.
 */
const MEESHO_TECHNICAL = "MR1: Technical error";

/**
 * That failure, built the same way wherever it is raised.
 *
 * @param {string} [detail] what the flow was able to establish, for the log.
 */
function meeshoTechnicalError(detail) {
    const error = new Error(MEESHO_TECHNICAL);

    error.code = "MEESHO_TECHNICAL";
    if (detail) error.detail = detail;

    return error;
}

/**
 * Snapdeal has no return under this AWB on the account that was searched.
 *
 * The seller portal answers an unknown AWB with an empty list rather than an
 * error, so this is our reading of silence — and it is a REAL outcome, not a
 * fault: the AWB is mistyped, or the return belongs to a different seller
 * account than the claim names. Both are fixed on the row, which is why it says
 * the number is invalid rather than blaming the search.
 *
 * The account that was asked is not in the text. It is on the error and in the
 * log, where there is room for it; the column is narrow and this is matched.
 */
const SNAPDEAL_INVALID_AWB = "SE1: Invalid Awb number";

/**
 * Flipkart's SPF claim window has closed.
 *
 * Flipkart says it two ways — `claim_eligible=false` with a reason on the API
 * path, a notice on the page on the Selenium one — and both used to reach the
 * column as the raw tag plus Flipkart's sentence
 * ("SPF_WINDOW_EXPIRED: 14 days window to claim SPF has passed"), which is
 * three times the width the column has and not what anybody calls it.
 *
 * The tag lives on as `err.code`, because the flows match on it to decide
 * whether a row should stop retrying. Only the words an operator reads changed.
 */
const FLIPKART_TAT_EXPIRED = "FE2: TAT expired of 14 days";

/**
 * That failure, built the same way wherever it is raised.
 *
 * Both Flipkart flows throw it and both are matched on `err.code`, so the
 * message, the tag and Flipkart's own sentence have to travel together — a
 * copy in each flow is how one of them ends up with the code and the other
 * with only the text, which reads to the runner as an ordinary failure worth
 * retrying for fourteen days.
 *
 * @param {string} [detail] Flipkart's wording — the page notice, or the API's
 *        `claim_eligible_reason`. Kept off the message and on the error.
 */
function flipkartWindowExpired(detail) {
    const error = new Error(FLIPKART_TAT_EXPIRED);

    error.code = "SPF_WINDOW_EXPIRED";

    const reason = String(detail || "").trim();

    if (reason) error.detail = reason;

    return error;
}

module.exports = {
    TAT_EXPIRED,
    INVALID_SUB_ORDER,
    MEESHO_INVALID_AWB,
    MEESHO_RETURN_NOT_DELIVERED,
    MEESHO_ALREADY_RAISED_NO_TICKET,
    MEESHO_INVALID_PACKET_ID,
    MEESHO_TECHNICAL,
    meeshoTechnicalError,
    SNAPDEAL_INVALID_AWB,
    FLIPKART_TAT_EXPIRED,
    flipkartWindowExpired,
};
