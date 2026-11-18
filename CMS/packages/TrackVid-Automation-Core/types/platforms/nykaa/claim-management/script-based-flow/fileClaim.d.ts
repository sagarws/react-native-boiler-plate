/**
 * File one claim on an already signed-in page.
 *
 * @param {object} page  a Puppeteer page, signed in to the dispute portal
 * @param {object} configEntry  the claim's config — see the server's runner header
 * @param {object} [options]
 * @returns {Promise<{status: string, ticketId: string|null, message: string}>}
 *          status: 'success' | 'help_center_failed' | 'dry_run' | 'failed'
 */
export function fileNykaaClaimByScript(page: object, configEntry: object, { logger }?: object): Promise<{
    status: string;
    ticketId: string | null;
    message: string;
}>;
/**
 * A CMS config entry in the shape `fillTicketForm` wants.
 *
 * Subject and Issue both come from `typeOfClaim` by product decision — Nykaa's
 * form asks for them separately and the claim only has the one answer.
 */
export function toFormData(configEntry: any): {
    subject: any;
    issue: any;
    vendorCode: any;
    skuId: any;
    reverseAwb: any;
    returnType: any;
    emailBody: any;
};
/**
 * Read the ticket number Nykaa just created.
 *
 * Four ways, in descending order of confidence. Best-effort on purpose: a
 * number we cannot read is NOT a claim that failed — the ticket exists at Nykaa
 * either way — and treating it as a failure would invite a retry that files a
 * second one for the same return.
 *
 * NOTE the URL's long number (…/ticket/77727001513200041) is Zoho's internal
 * id, not the one anybody quotes. The displayed id is `#`-prefixed.
 */
export function readTicketNumber(page: any): Promise<any>;
export const SUBMIT_SELECTOR: "button[data-id=\"ticket_save\"]";
