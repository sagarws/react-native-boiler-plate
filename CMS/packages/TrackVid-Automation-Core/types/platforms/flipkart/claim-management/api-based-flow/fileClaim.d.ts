/**
 * One CMS row → one filed claim. Returns the Flipkart claim id.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 *
 * approvedAmount on the result is set only for a claim Flipkart has APPROVED.
 *
 * @returns {Promise<import("./flipkartApiTypes").FiledFlipkartClaim>}
 */
export function fileFlipkartClaim(ctx: any, configEntry: any, awbNumber: any, tempDir: any, vocab: any, credentialUsername: any, options?: {}): Promise<import("./flipkartApiTypes").FiledFlipkartClaim>;
/**
 * Download every remote asset for one CMS row into `tempDir`.
 *
 * Contract: EVERY image in configEntry.evidenceImages must land on disk, once.
 * No padding, no duplicates, no silent skips — a download that fails throws with
 * the offending image's name so the AWB fails loudly and the CMS row gets fixed.
 * Returns { shippingPath, evidencePaths, perClaimFiles }.
 */
export function materializeAttachments(configEntry: any, awbNumber: any, tempDir: any, options?: {}): Promise<{
    shippingPath: any;
    evidencePaths: {
        path: any;
        name: any;
    }[];
    perClaimFiles: any;
}>;
export const DEFAULT_PRODUCT_TYPE: "Main Product";
