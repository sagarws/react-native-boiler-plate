/**
 * File one claim on an already signed-in page.
 *
 * @param {object} page  Puppeteer page, signed in to the supplier portal
 * @param {object} configEntry
 * @param {object} options
 * @param {string} options.tempDir  where evidence is downloaded — the caller's,
 *        because the two runners keep theirs in different places.
 * @returns {Promise<{status: string, ticketId: string|null, message: string}>}
 *          status: 'success' | 'already_raised' | 'help_center_failed' | 'dry_run' | 'failed'
 */
export function fileMeeshoClaimByScript(page: object, configEntry: object, { tempDir, companyId, logger }?: {
    tempDir: string;
}): Promise<{
    status: string;
    ticketId: string | null;
    message: string;
}>;
/**
 * The form data a claim's config entry describes.
 *
 * Kept beside the filling rather than in each runner: the mapping from CMS
 * field names to Meesho's form is part of the sequence, and two copies of it
 * drift the moment one portal field is renamed.
 */
export function toFormData(configEntry: any, companyId: any): {
    typeOfClaim: any;
    courierPartner: any;
    subOrderNumber: string;
    awbNumber: string;
    stateOfPacket: any;
    packetId: any;
    barcodeImage: any;
    productImage: any;
    reverseWaybill: any;
    unpackingVideo: any;
    description: any;
    attachments: any;
    callbackNumber: any;
    companyId: any;
};
export function fillRaiseTicketForm(page: any, formData: any, tempDir: any): Promise<boolean>;
/**
 * The ticket number Meesho holds for a sub-order.
 *
 * Used two ways: to read back the ticket a claim just raised, and to resolve
 * the one Meesho says already exists.
 *
 * The route is My Tickets → search by sub-order → read the first row. What
 * changed, and what broke this, is the middle step: it used to click a
 * `<p>Search by Sub Order ID</p>` label to reveal the field. That label is
 * gone — the input is simply there now, placeheld "Search by Sub Order ID or
 * Ticket ID" — so the old code bailed with "wrong page?" while looking at the
 * right page.
 */
export function getMeeshoTicketId(page: any, subOrderNumber: any): Promise<any>;
export function checkSubOrderValidation(page: any): Promise<any>;
