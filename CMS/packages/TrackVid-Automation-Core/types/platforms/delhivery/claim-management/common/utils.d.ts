export function buildDriver(): Promise<any>;
export function downloadFile(url: any, filename: any, tempPath: any): Promise<any>;
export function delhiveryLogin(driver: any, credentials: any): Promise<void>;
export function dismissNpsSurveyModal(driver: any, { waitMs, pollMs }?: {
    waitMs?: number;
    pollMs?: number;
}): Promise<boolean>;
export function pickDomesticAccount(driver: any, domesticName: any): Promise<void>;
export function openRaiseTicket(driver: any): Promise<void>;
export function pickShipmentIssueAndSub(driver: any, shipmentIssue: any, subcategory: any): Promise<void>;
export function enterAwbAndClaimType(driver: any, awbNumber: any, claimType: any): Promise<void>;
export function uploadUnboxingDocs(driver: any, filePaths: any): Promise<void>;
export function submitClaimDrawer(driver: any): Promise<void>;
export function getDelhiveryTicketId(driver: any, awbNumber: any): Promise<{
    ticketId: any;
    tab: string;
}>;
/**
 * Which row of the tickets table belongs to this waybill — run INSIDE the page.
 *
 * SERIALISED INTO THE BROWSER, so it must stay self-contained: no imports, no
 * closures, nothing from this module. Exported so a test can call it against a
 * faked table, because what it decides is which ticket number gets written onto
 * a claim.
 *
 * THE BUG IT EXISTS FOR. This used to read `tbody tr` — the FIRST row — the
 * instant after the search was submitted. The table on screen at that moment is
 * still the unfiltered list, so the first row is another parcel's ticket, and
 * that number went onto this claim: the AWB looks handled, its real ticket is
 * untracked, and somebody else's claim number is on the row.
 *
 * `stale` is the state that caused it — rows on screen, none of them this AWB —
 * and saying so is what lets the caller wait instead of guessing.
 *
 * @param {string} awb
 * @returns {{status: 'found', ticketId: string}|{status: 'empty'}|{status: 'loading'}|{status: 'stale', rows: number}}
 */
export function readTicketRow(awb: string): {
    status: "found";
    ticketId: string;
} | {
    status: "empty";
} | {
    status: "loading";
} | {
    status: "stale";
    rows: number;
};
/**
 * How long the ticket search is given to replace the table before it is read.
 *
 * The list is already on screen when the AWB is submitted, so a read taken too
 * soon is a read of the PREVIOUS results. Two seconds is what it takes in
 * practice; `DELHIVERY_TICKET_SEARCH_SETTLE_MS` moves it on a slow connection.
 */
export const SEARCH_SETTLE_MS: number;
