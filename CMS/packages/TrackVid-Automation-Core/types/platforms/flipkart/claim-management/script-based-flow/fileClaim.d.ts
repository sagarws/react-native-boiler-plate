/**
 * File one claim.
 *
 * @param {object} driver  signed in, on the SPF Claims page
 * @param {object} configEntry  the claim's config — see the server's runner header
 * @param {object} options
 * @param {{username: string}} options.credentials
 * @param {string} options.tempDir   where downloaded evidence goes
 * @param {string} [options.companyId] for the debug resource saver
 * @param {(driver: object, awb: string, kind: string) => Promise<void>} [options.onFailure]
 *        Called before recovery — the server saves a screenshot here.
 * @returns {Promise<{status: string, ticketId: string|null, cmsStatus: string|null, message: string}>}
 *          status: 'success' | 'help_center_failed' | 'salvaged' | 'dry_run' | 'failed'
 */
export function fileFlipkartClaimByScript(driver: object, configEntry: object, options?: {
    credentials: {
        username: string;
    };
    tempDir: string;
    companyId?: string;
    onFailure?: (driver: object, awb: string, kind: string) => Promise<void>;
}): Promise<{
    status: string;
    ticketId: string | null;
    cmsStatus: string | null;
    message: string;
}>;
export function isTaggedError(err: any): boolean;
export function cleanErrorMessage(err: any): string;
/**
 * The message stored on the claim: the code, then the plain sentence.
 *
 * Untagged failures are returned unchanged — a code invented for every
 * unrecognised error would be a code that means nothing.
 */
export function describeFailure(err: any): {
    message: string;
    terminal: boolean;
};
/**
 * The Flipkart failures an operator is expected to recognise on sight.
 *
 * The stripped message reads perfectly well on its own — "14 days window to
 * claim SPF has passed" — but a claims list is scanned, not read, and two
 * failures that look similar at a glance need something to tell them apart in
 * the width of a column. A short code does that, and gives ops something to say
 * to each other that is shorter than the sentence.
 *
 * Matched against the RAW message, before the tags are stripped: the tag is
 * what identifies the failure, and it is the first thing `cleanErrorMessage`
 * removes.
 *
 * `terminal` means the claim cannot be filed AT ALL — not now, not on a retry.
 * The caller uses it to move the row to "Failed to Proceed" straight away
 * rather than letting it burn its remaining attempts on something that will
 * never work.
 */
export const FAILURE_CODES: {
    code: string;
    match: RegExp;
    terminal: boolean;
}[];
