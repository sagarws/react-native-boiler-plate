/**
 * Asks, repeatedly, whether a ticket exists for this sub-order.
 *
 * The search is passed IN so this can be exercised without a portal: what is
 * worth pinning is the waiting and the giving up, not Meesho's endpoint.
 *
 * @param {(subOrderNumber: string) => Promise<unknown[]>} search
 * @param {string} sub
 * @param {object} [options]
 * @param {number[]} [options.delays] milliseconds before each read
 * @returns {Promise<{ticketId: string, meeshoStatus: string|null, cmsStatus: string|null}|null>}
 */
export function recoverTicket(search: (subOrderNumber: string) => Promise<unknown[]>, sub: string, { delays, log }?: {
    delays?: number[];
}): Promise<{
    ticketId: string;
    meeshoStatus: string | null;
    cmsStatus: string | null;
} | null>;
/**
 * Meesho says a ticket already exists — go and find it, or say ME5.
 *
 * THE ID IS NOT IN MEESHO'S SENTENCE. Its API sends the template unrendered —
 * `Ticket {{ticket_id}} has already been raised for this issue.` — so there is
 * nothing to parse out of it and the ticket has to be searched for. (The
 * script flow sees a real number there, because the portal interpolates it.)
 *
 * BOTH NUMBERS ARE TRIED. The pre-flight dedupe already searched by the row's
 * sub-order before filing; if Meesho's own differs, that difference is the
 * likeliest reason the first search came back empty — and the corrected number
 * is the one its ticket is filed under.
 *
 * WHEN NOTHING IS FOUND it ends in ME5 rather than the original refusal.
 * Meesho is certain a ticket exists and no search can produce it: two facts
 * that cannot both be acted on. Reporting the refusal reads as a plain failure
 * and invites a retry — and retrying is exactly how the ticket Meesho will not
 * show becomes two tickets for one return.
 *
 * MODULE-LEVEL, not a closure inside the flow, so the decision that stands
 * between "record the ticket" and "raise a duplicate" can be tested without a
 * browser and a live seller account.
 *
 * @param {object} input
 * @param {(sub: string) => Promise<unknown[]>} input.search
 * @param {(string|null)[]} input.candidates sub-order numbers to look under
 * @returns {Promise<object>} the claim result carrying the ticket
 * @throws when no ticket can be found — code MEESHO_ALREADY_RAISED_NO_TICKET
 */
export function recordExistingMeeshoTicket({ search, candidates, sub, correctedSubOrder, filedAwb, log, delays, }: {
    search: (sub: string) => Promise<unknown[]>;
    candidates: (string | null)[];
}): Promise<object>;
/**
 * How long to keep asking whether the ticket appeared, after a submit that
 * answered 500.
 *
 * Three reads over about eleven seconds. Meesho's ticket list did not show a
 * ticket one second after such a failure on a claim that HAD been filed, and
 * the cost of being wrong in the other direction is a duplicate dispute on the
 * same return — so the wait is worth it, and it only ever happens on a claim
 * that has already failed.
 */
export const VERIFY_DELAYS_MS: number[];
/**
 * One CMS row → one filed Meesho ticket.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, meeshoStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 */
export function fileMeeshoClaim(ctx: any, configEntry: any, awbNumber: any, tempDir: any, credentials: any, options?: {}): Promise<any>;
/**
 * Download a CMS URL, upload it to Meesho, return the GCS URL.
 *
 * Returns null when the url is missing or a placeholder; throws UPLOAD_FAILED
 * when a real URL fails, because silently dropping evidence produces a ticket
 * the reviewer will reject for missing proof.
 */
export function downloadAndUpload(ctx: any, url: any, tag: any, awbNumber: any, tempDir: any, options?: {}): Promise<any>;
/** Meesho pads empty image slots with a URL ending in "undefined". */
export function isPlaceholderUrl(url: any): boolean;
export function downloadToFile(url: any, filename: any, tempDir: any): Promise<string>;
/**
 * What an attachment is called when Meesho receives it.
 *
 * Its own function because it is a RULE, not a string: every identifier Meesho
 * is sent goes through `meeshoId` — upper-cased, and corrected to Meesho's own
 * spelling when the return was found under another — and this was the last
 * place the raw value leaked through. A claim reached the portal as
 * "r2485756038fp_video_….mp4": the row's AWB in the wrong case, on a ticket
 * carrying it in the right one.
 *
 * Falls back to the value as given when it is not a string Meesho would accept,
 * because a badly-named attachment is still better than no evidence.
 */
export function attachmentName(awbNumber: any, tag: any): string;
