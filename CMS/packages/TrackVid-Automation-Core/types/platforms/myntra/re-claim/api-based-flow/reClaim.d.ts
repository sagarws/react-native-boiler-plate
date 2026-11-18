/**
 * The columns this flow READS. Three, of the fourteen a Myntra rejection export
 * carries — the rest are the operator's to look at and are passed through on
 * `raw` untouched.
 *
 *   ticketId      which ticket to reopen. Nothing can be done without it.
 *   RR Remarks    the argument for reopening THIS ticket, sent as the dispute's
 *                 `description`. Myntra refuses a dispute without one.
 *   issueCategory optional. Overrides the category the ticket already has, for
 *                 an operator deliberately re-filing under a different one;
 *                 blank keeps Myntra's own.
 *
 * Narrowed from the full export on purpose. A column this flow does not use is
 * a column an operator can be asked to fill in wrongly, and the template is
 * generated from this list — so the sheet asks for exactly what is read.
 */
export const SHEET_COLUMNS: string[];
/**
 * The reason a DISPUTE is filed under. Always this.
 *
 * Not the claim's own return reason — that is the customer's ("Found a better
 * price on Myntra") and stays on the ticket untouched. This is the reason for
 * REOPENING it, and Myntra's portal sends "Others" for every one: the capture's
 * own response echoes it back as `ticketDisputedReturnReason: "Others"` beside
 * a claim whose `returnReason` is something else entirely.
 *
 * Fixed rather than defaulted, deliberately. A caller that could pass its own
 * would be a caller that could send a value the portal never sends, and the
 * only way to find out that Myntra minds is to spend a seller's one reopen
 * discovering it.
 */
export const DISPUTE_RETURN_REASON: "Others";
/**
 * Reads a rejection export.
 *
 * Header names are matched loosely — case, spaces and underscores are ignored —
 * because this sheet is exported, re-saved and edited by hand before it gets
 * here, and refusing "Ticket Id" for not being "ticketId" would reject the file
 * for a difference nobody can see.
 *
 * Every row keeps its ORIGINAL cells alongside the normalised ones: the table
 * shows the operator their own sheet, and a column this code does not know
 * about is still theirs to read.
 */
export function readReClaimSheet(inputPath: any): {
    rows: {
        description: any;
        raw: any;
        rowNumber: number;
        ticketId: any;
        issueCategory: any;
    }[];
    missing: string[];
};
/**
 * Writes a blank rejection export — the sheet `readReClaimSheet` reads.
 *
 * Built from SHEET_COLUMNS rather than its own list, so the template an operator
 * downloads and the columns the parser looks for cannot drift apart. That
 * matters more here than for most templates: a header this code does not
 * recognise is not rejected, it is carried through as one of the operator's own
 * columns — so a typo in a hand-written template looks like a thin row rather
 * than a mistake in the file.
 *
 * Only `ticketId` is load-bearing; every other column is what Myntra's own
 * export carries, and is shown back to the operator as it comes.
 *
 * @param {string} outputPath
 * @returns {string} outputPath
 */
export function writeReClaimTemplate(outputPath: string): string;
/**
 * The two a row is useless without. `issueCategory` is deliberately absent —
 * it has a working fallback, and demanding it would make the operator name a
 * category Myntra already knows.
 */
export const REQUIRED_SHEET_COLUMNS: string[];
/** The sheet column the dispute's `description` comes from. */
export const DESCRIPTION_COLUMN: "RR Remarks";
/**
 * The dispute payload for a ticket, from what Myntra currently holds.
 *
 * @param {object} claim  a row from `fetchClaimByTicketId`
 * @param {object} input
 * @param {string} input.description     the seller's argument — the whole point
 * @param {string} [input.issueCategory] overrides the claim's own, from the sheet
 */
export function buildFwTicketPayload(claim: object, { description, issueCategory }?: {
    description: string;
    issueCategory?: string;
}): {
    ticketId: number;
    description: string;
    orderId: number;
    returnId: number;
    trackingId: string;
    skuId: number;
    styleId: number;
    issueCategory: string;
    returnReason: string;
    attachments: string[];
};
/**
 * Reopens a ticket.
 *
 * @returns {Promise<{ok: boolean, message: string, row: object|null}>}
 *
 * Myntra answers 200 with a `status` envelope, and a business refusal —
 * "already disputed", "outside the dispute window" — arrives inside it rather
 * than as an HTTP error. So the envelope is the verdict, not the status code.
 */
export function createFwTicket(jar: any, payload: any): Promise<{
    ok: boolean;
    message: string;
    row: object | null;
}>;
export const API_BASE: "https://partnersapi.myntrainfo.com";
