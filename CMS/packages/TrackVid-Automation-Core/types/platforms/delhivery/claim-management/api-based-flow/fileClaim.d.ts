/**
 * One CMS row → one filed Delhivery ticket.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, delhiveryStatus }.
 * Every throw is stage-tagged (see claimFailure.STAGE) so the caller can
 * classify the failure without re-parsing the message.
 */
export function fileDelhiveryClaim(ctx: any, configEntry: any, awbNumber: any, tempDir: any, options?: {}): Promise<{
    ticketId: any;
    alreadyExisted: boolean;
    cmsStatus: any;
    delhiveryStatus: any;
}>;
export function recoverTicketAfterFailure(ctx: any, awbNumber: any, failure: any, options?: {}): Promise<{
    publicTicketId: any;
    ticketStatus: any;
    ticketCount: number;
    raw: any;
}>;
export const NO_RECOVERY_CODES: Set<string>;
/** Delhivery pads empty slots with a URL ending in "undefined". */
export function isPlaceholderUrl(url: any): boolean;
export function downloadToFile(url: any, filename: any, tempDir: any): Promise<string>;
export function delhiveryFilenameFor(url: any, i: any): string;
export function contentTypeFor(fileName: any): "image/png" | "image/jpeg" | "application/pdf" | "video/mp4" | "video/quicktime" | "video/webm" | "application/octet-stream";
