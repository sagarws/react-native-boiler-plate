/**
 * One CMS row → one filed Xbees dispute.
 *
 * `vocab` is a caller-owned cache ({ }) so a batch fetches the reason tree once
 * rather than per claim. Pass the same object for every claim in a run.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, xbeesStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 */
export function fileXbeesClaim(ctx: any, configEntry: any, awbNumber: any, tempDir: any, vocab: any, options?: {}): Promise<{
    ticketId: any;
    alreadyExisted: boolean;
    cmsStatus: any;
    xbeesStatus: any;
}>;
/** Xbees pads empty image slots with a URL ending in "undefined". */
export function isPlaceholderUrl(url: any): boolean;
export function downloadToFile(url: any, filename: any, tempDir: any): Promise<string>;
export function contentTypeFor(fileName: any): "image/png" | "image/jpeg" | "video/mp4" | "video/quicktime" | "video/webm" | "application/octet-stream";
export namespace CMS_TO_PHOTO_SLOT {
    let Top: string;
    let Bottom: string;
    let Right: string;
    let Left: string;
}
