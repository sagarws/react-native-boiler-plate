/**
 * Submit a ticket-report generation request. Returns the requestId.
 * from/to accepted as YYYY-MM-DD or YYYY/MM/DD (normalised to slashes).
 */
export function submitTicketRequest(page: any, { userId, pobIds, from, to }: {
    userId: any;
    pobIds: any;
    from: any;
    to: any;
}): Promise<any>;
/**
 * Poll the download endpoint until the report is ready, then return the xlsx Buffer.
 * The endpoint returns 500 "Report not ready ... IN_PROGRESS" until CREATED, then 200 xlsx.
 * Returns { ok: true, buffer } on success; throws on hard failure or timeout.
 */
export function downloadTicketReport(page: any, { userId, requestId, maxWaitMs, pollIntervalMs, userLogger }?: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
}): Promise<{
    ok: boolean;
    noData: boolean;
    reason: any;
    buffer?: undefined;
    totalTickets?: undefined;
} | {
    ok: boolean;
    buffer: Buffer<ArrayBuffer>;
    totalTickets: any;
    noData?: undefined;
    reason?: undefined;
}>;
import { getUserId } from "../../master-import/api-based-flow/apiReportFlow";
import { getPobIds } from "../../master-import/api-based-flow/apiReportFlow";
/** Convert a YYYY-MM-DD (or any dayjs-parseable) date to the API's YYYY/MM/DD format. */
export function toSlashDate(d: any): string;
export { getUserId, getPobIds };
