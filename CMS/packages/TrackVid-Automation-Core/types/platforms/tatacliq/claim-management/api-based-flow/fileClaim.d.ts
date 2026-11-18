/**
 * File one Tata CliQ claim.
 *
 * @param {object} page a logged-in page — see common/login + common/sessionStore
 * @param {object} input
 * @param {string} input.reverseAwb    the return AWB to claim against
 * @param {object} [input.slave]       `{ id, name }` when the caller has already
 *        resolved it. Otherwise pass `slaves`, with `slaveName` to pick one or
 *        without it to have them swept.
 * @param {Array}  [input.slaves]      the credential's stored slaves
 * @param {string} [input.slaveName]   which of them this return belongs to
 * @param {string} input.reason        a QC_REASONS code
 * @param {string} [input.subReason]   only Wrong Product takes one
 * @param {object} [input.images]      slot key → { base64, fileName, mimeType }
 * @param {string} [input.packagingVideoUrl]
 * @param {string} [input.unboxingVideoUrl]
 * @param {string} [input.comment]
 * @param {boolean} [input.allowIncompleteImages=false] file even though a
 *        required slot is empty. Off by default: the portal accepts it and a
 *        human rejects it days later.

 * @param {object} [options]
 * @param {object} [options.logger]
 * @returns {Promise<{
 *   status: 'success'|'already_claimed'|'not_found'|'not_claimable'|'failed',
 *   ticketId: string|null, transId: string|null, forwardAwb: string|null,
 *   message: string
 * }>}
 */
export function fileTataCliqClaim(page: object, input: {
    reverseAwb: string;
    slave?: object;
    slaves?: any[];
    slaveName?: string;
    reason: string;
    subReason?: string;
    images?: object;
    packagingVideoUrl?: string;
    unboxingVideoUrl?: string;
    comment?: string;
    allowIncompleteImages?: boolean;
}, { logger }?: {
    logger?: object;
}): Promise<{
    status: "success" | "already_claimed" | "not_found" | "not_claimable" | "failed";
    ticketId: string | null;
    transId: string | null;
    forwardAwb: string | null;
    message: string;
}>;
/**
 * Put the claim's images into the portal's six slots.
 *
 * THE SLOT IS THE MEANING. Slot 1 is the product image, slot 4 the packing slip
 * — the portal numbers them and a reviewer reads them by number, so an image in
 * the wrong slot is a claim arguing the wrong thing. The caller supplies them
 * keyed by slot (`{ productImage, productCode, brandMarking, packingSlip,
 * additional1, additional2 }`), which is what lets an operator rearrange them
 * upstream without this needing to know.
 *
 * THREE SHAPES ACCEPTED, because two callers supply different things and
 * neither should have to convert for the other: a plain URL string, `{ url }`,
 * or `{ base64, fileName, mimeType }` for a caller that already holds the
 * bytes. TrackVid-BE's claim config hands back URLs — the same way it does for
 * every other platform — so that is the normal path.
 *
 * @returns {{ ready: Array, missingRequired: string[] }}
 */
export function planUploads(images?: {}): {
    ready: any[];
    missingRequired: string[];
};
/**
 * The bytes for one slot.
 *
 * Fetched HERE rather than by the caller, so both runners behave identically —
 * the same reason AJIO's flow downloads its own attachment. A URL that cannot
 * be read is a hard failure: the alternative is a claim submitted listing an
 * image the portal never received.
 */
export function imageBytes(image: any): Promise<{
    base64: any;
    fileName: any;
    mimeType: any;
}>;
