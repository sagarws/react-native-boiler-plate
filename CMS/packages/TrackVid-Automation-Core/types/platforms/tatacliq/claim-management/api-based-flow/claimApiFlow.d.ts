import { ORIGIN } from "../../common/slaveSync";
/** The page the portal makes these calls from; sent as the Referer. */
export const QC_PAGE: string;
/** What the portal's search dropdown sends for a reverse-AWB search. */
export const SEARCH_BY_REVERSE_AWB: "revAwb";
/** How many images the submit expects, and which of them the modal stars. */
export const REQUIRED_IMAGE_SLOTS: number;
/**
 * Does this reverse AWB exist at all?
 *
 * The portal asks this before the row, and it is kept for the same reason: a
 * typo'd AWB should cost one cheap call, not a 22 KB parse.
 *
 * ⚠️ UNVERIFIED SIGNAL. In the capture this answered 200 with an EMPTY body for
 * an AWB that does exist, so there is nothing here to tell present from absent
 * — which means a `false` cannot be trusted and is not returned. Until a
 * not-found capture exists, this reports only whether the call itself worked,
 * and `findReturn` is what actually decides. Do not turn this into a gate.
 */
export function globalSearchExists(page: any, reverseAwb: any): Promise<{
    ok: any;
    body: any;
}>;
/**
 * Read the return out of the eligibility HTML.
 *
 * FROM IDS, NOT COLUMNS. The portal stamps the data into element ids, and those
 * are what this reads:
 *
 *   removeCIRInward_{transId}     the transaction id — what the submit takes
 *   Inward_{transId}              the QC Fail button
 *   qcPassCIR_{transId}           the QC Pass button
 *   commonPopper_{awb} + class FWD / REV   the two AWBs, labelled
 *
 * Column order would be the obvious way to read the rest, and is the way that
 * breaks when the portal adds a column. The product name and invoice are taken
 * positionally because they have no id — so they are best-effort, and nothing
 * load-bearing depends on them.
 *
 * @returns {{
 *   found: boolean, transId: string|null, forwardAwb: string|null,
 *   reverseAwb: string|null, crmTicket: string|null, claimable: boolean,
 *   productName: string|null, invoiceNumber: string|null
 * }}
 */
export function parseReturnRow(html: any): {
    found: boolean;
    transId: string | null;
    forwardAwb: string | null;
    reverseAwb: string | null;
    crmTicket: string | null;
    claimable: boolean;
    productName: string | null;
    invoiceNumber: string | null;
};
/**
 * Find a return by its reverse AWB, under whichever slave the session is set to.
 *
 * Returns the parsed row and the raw HTML — the caller keeps the HTML because a
 * row that did not parse is a report worth the markup, and because the QC
 * sub-reason list for a reason is in there.
 */
export function findReturn(page: any, reverseAwb: any, { selectDD }?: {
    selectDD?: string;
}): Promise<{
    html: any;
    found: boolean;
    transId: string | null;
    forwardAwb: string | null;
    reverseAwb: string | null;
    crmTicket: string | null;
    claimable: boolean;
    productName: string | null;
    invoiceNumber: string | null;
}>;
/**
 * Upload one proof image, and return the name the submit must list.
 *
 * Built in the page from base64 rather than fetched there: the images live in
 * TrackVid's S3 and the portal's origin cannot read them (CORS), so the bytes
 * come from the caller. Same shape as AJIO's `uploadClaimAttachment`.
 *
 * Content-Type is deliberately NOT set — the browser writes the multipart
 * boundary, and setting the header by hand produces a body the portal cannot
 * parse.
 *
 * The response is the stored path:
 *   /images/courierInbound/slave_{code}/{transId}/{transId}_{n}.png
 * and `imagesList` on the submit wants only the file name, so that is what
 * comes back.
 *
 * @param {object} page
 * @param {object} input
 * @param {string} input.transId
 * @param {number} input.slot      1-6, see IMAGE_SLOTS — positional, per the portal
 * @param {string} input.base64    the image bytes
 * @param {string} input.fileName  what to call it in the form
 * @param {string} [input.mimeType]
 * @returns {Promise<{ fileName: string, path: string }>}
 */
export function uploadProofImage(page: object, { transId, slot, base64, fileName, mimeType }: {
    transId: string;
    slot: number;
    base64: string;
    fileName: string;
    mimeType?: string;
}): Promise<{
    fileName: string;
    path: string;
}>;
/**
 * Submit the QC failure — the call that raises the claim.
 *
 * Everything is a query parameter, including the images and the videos; the
 * portal sends no body. `qcFail` repeats `qcFailCIRDD` because the portal
 * sends both.
 *
 * @param {object} page
 * @param {object} input
 * @param {string} input.transId      from `parseReturnRow`
 * @param {string} input.reason       a QC_REASONS code
 * @param {string} [input.subReason]  required for the reasons that take one
 * @param {string[]} [input.imagesList]  the upload responses' file names
 * @param {string} [input.packagingVideoUrl]
 * @param {string} [input.unboxingVideoUrl]
 * @param {string} [input.comment]    max 200 chars, per the portal's input
 * @returns {Promise<{ ok: boolean, ticketId: string|null, raw: string }>}
 */
export function submitQcFail(page: object, input: {
    transId: string;
    reason: string;
    subReason?: string;
    imagesList?: string[];
    packagingVideoUrl?: string;
    unboxingVideoUrl?: string;
    comment?: string;
}): Promise<{
    ok: boolean;
    ticketId: string | null;
    raw: string;
}>;
export { ORIGIN };
