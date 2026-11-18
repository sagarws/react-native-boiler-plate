/**
 * One CMS row → one filed Nykaa ticket.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, nykaaStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, and .code=RATE_LIMITED
 * when the dedupe check could not be completed — both are for the caller to
 * retry, never to report as a failed claim.
 */
export function fileNykaaClaim(ctx: any, configEntry: any, awbNumber: any, options?: {}): Promise<{
    ticketId: string;
    alreadyExisted: boolean;
    cmsStatus: string | RegExp;
    nykaaStatus: any;
}>;
/** CMS row → the vendor-portal ticket body. */
export function toTicketPayload(configEntry: any): {
    subject: any;
    issue: any;
    vendorCode: any;
    skuId: any;
    reverseAwb: any;
    returnType: any;
    description: any;
    evidenceUrl: any;
};
