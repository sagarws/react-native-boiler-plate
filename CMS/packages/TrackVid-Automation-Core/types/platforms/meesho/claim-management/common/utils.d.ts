/**
 * Helper function to download file from URL to temp folder.
 * Optional saveCtx = { companyId, companyName, awbNumber } mirrors the file
 * into resource/Reports/{Company}/{Date}/{AWB}/ when SAVE_RESOURCE=true.
 */
export function downloadFile(url: any, filename: any, tempPath: any, saveCtx?: any): Promise<any>;
/**
 * Fill Sub Order Number
 */
export function fillSubOrderNumber(page: any, subOrderNumber: any): Promise<void>;
/**
 * Fill AWB Number
 */
export function fillAwbNumber(page: any, awbNumber: any): Promise<void>;
/**
 * Select Logistics Partner Name (dropdown)
 * Used for "Return/RTO product not received but marked delivered - Need Proof of Delivery" claim type
 */
export function selectLogisticsPartner(page: any, courierPartner: any): Promise<void>;
export function selectStateOfPacket(page: any, stateOfPacket: any): Promise<void>;
/**
 * Select State of the packet (dropdown)
 */
/**
 * Pick a value from one of Meesho's dropdowns, by the LABEL above it.
 *
 * Meesho rebuilt these controls: they used to be MUI, and the old code found
 * them by hunting for `.MuiBox-root` and a `.css-ie6h5v` arrow. Those classes
 * are gone. The replacement is a plain ARIA listbox — a
 * `button[aria-haspopup="listbox"]` holding the value in a `<span>`, and
 * options as `div[role="option"]` — with Tailwind classes that will be churned
 * again the next time the design changes.
 *
 * So this navigates by ROLE and LABEL, not by class. `aria-haspopup`,
 * `role="option"` and the label's `for` are contract, not styling: they are
 * what a screen reader uses, and they survive a redesign that renames every
 * class in the file.
 *
 * @param {string} labelText  the visible label, e.g. "State of the packet"
 * @param {string} optionText the option to pick, e.g. "Intact"
 */
export function selectFromLabelledListbox(page: any, labelText: string, optionText: string): Promise<void>;
/**
 * Fill Packet ID
 */
export function fillPacketId(page: any, packetId: any): Promise<void>;
/**
 * Upload Barcode Image
 */
export function uploadBarcodeImage(page: any, barcodeImage: any, tempPath: any, saveCtx?: any): Promise<void>;
/**
 * Upload Product Images
 */
export function uploadProductImages(page: any, productImages: any, tempPath: any, saveCtx?: any): Promise<void>;
/**
 * Upload Reverse Waybill
 */
export function uploadReverseWaybill(page: any, reverseWaybill: any, tempPath: any, saveCtx?: any): Promise<void>;
/**
 * Upload Unpacking Video
 */
export function uploadUnpackingVideo(page: any, unpackingVideo: any, tempPath: any, saveCtx?: any): Promise<void>;
/**
 * Fill Description
 */
export function fillDescription(page: any, description: any): Promise<void>;
/**
 * Upload Attachments (PDF)
 */
export function uploadAttachments(page: any, attachments: any, tempPath: any, saveCtx?: any): Promise<void>;
/**
 * Fill Callback Number
 */
export function fillCallbackNumber(page: any, callbackNumber: any): Promise<void>;
/**
 * Handle Advertisement Popup
 */
export function handleAdvertisementPopup(page: any): Promise<void>;
/**
 * Navigate to Claims and click Raise Claim, then select reason and Raise a Ticket.
 * Retries up to 3 times by going Home and re-entering Claims if Raise Claim is not found.
 */
export function navigateToClaims(page: any, claimReason: any): Promise<boolean>;
/**
 * Check whether Submit button is enabled. Throws if it remains disabled.
 */
export function checkSubmitButtonEnable(page: any): Promise<void>;
/**
 * Perform Submit button click action.
 */
export function submitAction(page: any): Promise<void>;
export function captureAwbFieldHelperError(page: any): Promise<any>;
/**
 * Look for a MUI error helper text rendered directly under the AWB Number field
 * (e.g. "You can create this ticket only if your return order has been delivered...").
 * Returns the trimmed text or null when no such helper is present.
 */
/**
 * Has Meesho already got a ticket for this AWB?
 *
 * After the AWB is entered the form answers, inline:
 *
 *   Ticket [7788934011637] has already been raised for this issue.
 *   Please reply on the same ticket.
 *
 * That is not a failure and it is not something to push past. The claim EXISTS —
 * filling in the rest of the form and submitting would either be rejected or,
 * worse, raise a second ticket for one return. What the CMS actually needs is
 * the number Meesho just showed us, so the row can be updated and closed.
 *
 * Read by ROLE and TEXT, not by class: the message sits in a
 * `[data-error="true"]` block whose Tailwind classes have already churned once
 * (see selectFromLabelledListbox). The sentence and the button holding the
 * number are the stable parts.
 *
 * POLLS, because the answer is not instant. Meesho validates the AWB on its
 * server and renders this a second or two after the field is filled — a single
 * read the moment typing finishes finds an empty form and the run sails past it
 * into a claim that cannot be submitted.
 *
 * @param {object} [options]
 * @param {number} [options.waitMs=0] how long to keep looking. 0 reads once,
 *        for callers that only want to know what is on screen right now.
 * @returns {Promise<{ticketId: string, message: string}|null>}
 */
export function readAlreadyRaisedTicket(page: any, { waitMs, intervalMs }?: {
    waitMs?: number;
    intervalMs?: number;
}): Promise<{
    ticketId: string;
    message: string;
} | null>;
