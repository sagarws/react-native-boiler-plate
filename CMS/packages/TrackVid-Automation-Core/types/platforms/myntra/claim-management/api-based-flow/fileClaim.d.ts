/**
 * One AWB, end to end.
 *
 * Returns { ticketId, alreadyExisted } — `alreadyExisted` is true when Myntra
 * already held a claim for this AWB, filed by an earlier run or by hand. Never
 * files a second one.
 */
export function fileMyntraClaim(jar: any, configEntry: any, awbNumber: any, tempDir: any, options?: {}): Promise<{
    ticketId: string;
    alreadyExisted: boolean;
}>;
/** Download a remote proof into tempDir, upload it to Myntra, return the URL. */
export function pushProof(jar: any, url: any, label: any, orderId: any, tempDir: any, options?: {}): Promise<any>;
export function isSelfExplanatory(err: any): boolean;
