/**
 * Log an error status. Call IMMEDIATELY after the await and BEFORE any
 * branching, so the body is printed no matter which branch consumes the
 * response — including branches that swallow the status and return a
 * normal-looking value (fetchClaimByTicketId's 400 -> { found: false }).
 */
export function logHttpError(step: any, res: any): void;
/**
 * Log a response the run could not use even though the status was fine.
 *
 * Myntra's "not claimable on this account" answer is an HTTP 200 carrying an
 * empty `data` array, not an error status — logHttpError never sees it, and
 * without this the run reports "Claim is not applicable" with nothing behind
 * it. `note` says why the body is being shown.
 */
export function logHttpBody(step: any, res: any, note: any): void;
/**
 * Where did the failure actually land?
 *
 * partnersapi is NOT consistent about this. The same "No valid orders found"
 * answer for the same AWB arrives either as a real HTTP 400, or as an HTTP 200
 * whose BODY carries the error:
 *
 *   HTTP 200 { status: { statusCode: 400, statusType: "ERROR",
 *                        statusMessage: "Error in fetching claim : No valid
 *                                        orders found ..." },
 *              data: [], stackTrace: [...] }
 *
 * Code that trusts res.status alone reads that second shape as a successful
 * call that returned no rows — which is a different business outcome with a
 * different message. Every status decision in the Myntra API flows goes
 * through here so both shapes are treated the same way.
 */
export function readStatus(res: any): {
    httpStatus: any;
    code: number;
    type: string;
    message: string;
    sessionExpired: boolean;
    isAuthExpired: boolean;
    effective: any;
    failed: boolean;
};
