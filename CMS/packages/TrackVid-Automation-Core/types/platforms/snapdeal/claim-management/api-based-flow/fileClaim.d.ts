/**
 * One CMS row → one filed dispute.
 *
 * `vocab` is a caller-owned cache ({ issueCategories: [] }) so a batch fetches
 * the issue-category list once rather than per claim. Pass the same object for
 * every claim in a run. Snapdeal serves a different list per RETURN TYPE, so
 * this fills `issueCategoriesByType` on the same object — two kinds of return
 * in one batch need two lists, and one cache would serve the first kind's ids
 * to the second.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, snapdealStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 */
export function fileSnapdealClaim(ctx: any, configEntry: any, awbNumber: any, tempDir: any, vocab: any, credentialUsername: any, options?: {}): Promise<{
    ticketId: any;
    alreadyExisted: boolean;
    cmsStatus: any;
    snapdealStatus: any;
}>;
/**
 * Download every asset on one CMS row into `tempDir`.
 *
 * Snapdeal groups images by role (outer / inner / POD / product) rather than a
 * single evidence array. Each role can hold up to 2 URLs; the video is one URL.
 * Placeholder and duplicate URLs are skipped without a network call.
 *
 * Throws EVIDENCE_MISSING when nothing attachable came back — filing a dispute
 * with no images is rejected by the portal anyway, and failing here gives the
 * operator the real reason.
 */
export function materializeAttachments(configEntry: any, awbNumber: any, tempDir: any, options?: {}): Promise<{
    localImages: {
        localPath: string;
        displayName: any;
    }[];
    videoLocal: string;
}>;
/**
 * The dispute already on this suborder, or null. Null too when there is no
 * suborder to ask about. Throws AUTH_EXPIRED like any other call.
 */
export function findExistingDispute(ctx: any, subOrderId: any, log?: Console): Promise<any>;
/**
 * True for a submit failure that leaves it UNKNOWN whether the case was made:
 * a 5xx, or the connection dying before a response. A 4xx, a session expiry or
 * an explicit `success:false` all mean it was not.
 */
export function isAmbiguousSubmitFailure(err: any): boolean;
/**
 * Snapdeal pads every image slot to a fixed length and fills the empty ones
 * with a URL ending in "undefined". Those are not fetchable and must not be
 * counted as evidence.
 */
export function isPlaceholderImageUrl(url: any): boolean;
export function imageNameFromUrl(url: any, fallback: any): any;
export function downloadToFile(url: any, filename: any, tempDir: any, { exactName }?: {
    exactName?: boolean;
}): Promise<string>;
