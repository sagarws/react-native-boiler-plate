/**
 * One readable line out of an error body, however the gateway chose to answer.
 *
 * Flipkart's upload endpoint does not always answer JSON. Under load it returns
 * an Apache error PAGE, and dumping 300 characters of it into the claim's error
 * put this in the CMS's Script Error column:
 *
 *   HTTP 503 "<HTML><HEAD>\n<TITLE>Internal Server Error</TITLE>\n</HEAD>
 *   <BODY>\n<H1>Internal Server Error - Write</H1>\nThe server encountered an
 *   internal error or misconfiguration and was unable to…
 *
 * — which an operator has to read like markup to learn one fact: the write
 * failed. The title and the heading ARE that fact, so they are what is kept.
 *
 * @param {*} data an axios response body: object, string, HTML page, anything
 * @param {number} [max] how much of a non-HTML body to keep
 */
export function httpBodySummary(data: any, max?: number): string;
/** What the upload endpoint accepts. Flipkart's own list, from the rejection above. */
export const ALLOWED_UPLOAD_EXTENSIONS: string[];
/**
 * Extensions a Flipkart claim can NEVER carry — video, audio, documents.
 *
 * A DENY LIST, deliberately, and not the inverse of the allow list above. An
 * S3 key with no extension at all is a perfectly ordinary image here, and
 * "everything not on the allow list" would silently drop it — filing a claim
 * with less proof than the operator attached, which is how a dispute is lost
 * quietly. Only what is KNOWN to be unattachable is left behind; anything else
 * still goes to the uploader, which fails loudly by name if Flipkart refuses.
 */
export const UNATTACHABLE_EXTENSIONS: string[];
/** The extension of a URL's last path segment, lowercased. "" when there is none. */
export function extensionOf(url: any): string;
/** Can this file never be attached to a Flipkart claim? */
export function isUnattachable(url: any): boolean;
/**
 * Split a CMS row's evidence into what Flipkart can take and what it cannot.
 *
 * @param {string[]} urls `configEntry.evidenceImages`, in the order given
 * @returns {{ uploadable: string[], rejected: {url: string, ext: string}[] }}
 *   `rejected` is for the caller to REPORT — by name, in the run's log and its
 *   result — never to drop in silence. The whole point of separating them here
 *   is that both halves stay visible.
 */
export function partitionEvidence(urls: string[]): {
    uploadable: string[];
    rejected: {
        url: string;
        ext: string;
    }[];
};
