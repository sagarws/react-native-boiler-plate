export namespace REPORTS {
    export namespace forward {
        let label: string;
        let path: string;
        let listKey: string;
        let columns: {
            key: string;
            label: string;
        }[];
    }
    export namespace _return {
        let label_1: string;
        export { label_1 as label };
        let path_1: string;
        export { path_1 as path };
        let listKey_1: string;
        export { listKey_1 as listKey };
        let columns_1: {
            key: string;
            label: string;
        }[];
        export { columns_1 as columns };
    }
    export { _return as return };
}
/** The report types this can read. */
export const REPORT_TYPES: string[];
/** AJIO caps the page size; 100 is what its own screen asks for. */
export const MAX_PAGE_SIZE: 100;
/** AJIO refuses a report window wider than 31 days, inclusive of both ends. */
export const MAX_WINDOW_DAYS: 31;
/** One report's descriptor — label, columns — or null for an unknown type. */
export function reportDescriptor(type: any): any;
/**
 * One page of a dropship report.
 *
 * @param {object}   page               a signed-in AJIO Puppeteer page
 * @param {object}   input
 * @param {string}   input.reportType   "forward" | "return"
 * @param {string[]} input.pobIds       the places of business to include
 * @param {string}   input.from         yyyy-mm-dd, inclusive
 * @param {string}   input.to           yyyy-mm-dd, inclusive
 * @param {number}   [input.pageNumber] zero-based, as AJIO counts
 * @param {number}   [input.size]
 * @param {string}   [input.businessModel]
 * @param {string}   [input.returnOrderNo] narrows the RETURN report to one
 *                                          return order ("RT…"). Empty asks for
 *                                          the whole window, as before.
 * @param {object}   [input.userLogger]
 *
 * @returns {Promise<{rows: object[], pageNumber: number, totalPages: number,
 *          totalElements: number|null, columns: object[]}>}
 */
export function fetchDropshipReport(page: object, { reportType, pobIds, from, to, pageNumber, size, businessModel, returnOrderNo, orderNo, userLogger, }: {
    reportType: string;
    pobIds: string[];
    from: string;
    to: string;
    pageNumber?: number;
    size?: number;
    businessModel?: string;
    returnOrderNo?: string;
    userLogger?: object;
}): Promise<{
    rows: object[];
    pageNumber: number;
    totalPages: number;
    totalElements: number | null;
    columns: object[];
}>;
/**
 * The windows to search, newest first: `months` back-to-back 31-day spans
 * ending today (IST), none overlapping.
 *
 * Thirty-one days rather than calendar months because that is AJIO's limit,
 * and a calendar month ending today would leave the 31st of a long month
 * between two windows.
 *
 * @param {{months?: number, now?: number}} [options]
 * @returns {{from: string, to: string}[]}
 */
export function returnSearchWindows({ months, now }?: {
    months?: number;
    now?: number;
}): {
    from: string;
    to: string;
}[];
/**
 * Every line of one AJIO return order, found wherever in the last few months
 * it was created.
 *
 * The return report only answers a window of at most 31 days, and an operator
 * filing a claim knows the return order number, not when it was raised. So the
 * windows are asked newest first, and the search stops at the first that
 * answers: every line of a return order shares its creation date, so the rest
 * of the order cannot be in an older window.
 *
 * A READ — nothing is written to AJIO.
 *
 * @param {object}   page                 a signed-in AJIO Puppeteer page
 * @param {object}   input
 * @param {string}   input.returnOrderNo  e.g. "RT229843479"
 * @param {string[]} input.pobIds         the account's places of business
 * @param {number}   [input.months]       how many 31-day windows to try
 * @param {object}   [input.userLogger]
 *
 * @returns {Promise<{rows: object[], window: {from: string, to: string}|null,
 *          searched: number}>}
 */
export function findReturnOrder(page: object, { returnOrderNo, pobIds, months, userLogger }: {
    returnOrderNo: string;
    pobIds: string[];
    months?: number;
    userLogger?: object;
}): Promise<{
    rows: object[];
    window: {
        from: string;
        to: string;
    } | null;
    searched: number;
}>;
/**
 * The forward AWB for one customer order number.
 *
 * WHY IT IS A SECOND LOOKUP. The return report answers with `fwdAwbNo`, and on
 * a good day that is the end of it. Often it is null — AJIO simply does not
 * carry the forward leg on the return line — and the claim needs it. The
 * forward report does have it, under `awbNumber`, keyed on the customer order
 * number the return line DID give us.
 *
 * SEARCHED BACKWARDS FROM THE RETURN, not from today. A forward order always
 * precedes its return, usually by days: a return created on 2 September came
 * from an order placed on 23 August. Anchoring the windows to the return's own
 * date puts the order in the first window instead of several windows back, and
 * stops the search wandering forward into months that cannot hold it.
 *
 * Same windows, same pagination and the same "no records is an answer" handling
 * as the return lookup — see `findReturnOrder`.
 *
 * @param {object}  input
 * @param {string}  input.orderNo  the customer order number, e.g. FN4581806548
 * @param {string} [input.on]      ISO day the return was created; defaults to today
 */
export function findForwardAwb(page: any, { orderNo, pobIds, months, on, userLogger }: {
    orderNo: any;
    pobIds?: any[];
    months: any;
    on: any;
    userLogger: any;
}): Promise<{
    awbNumber: string;
    row: any;
    searched: number;
}>;
/**
 * Every return AWB this account holds in the last few months, to its POB.
 *
 * WHAT IT IS FOR. The bulk claim needs a POB on every row — an AJIO return
 * lookup is scoped to one, and a row without it is never attempted. An operator
 * starting out has the AWB and nothing else, so this fills the gap.
 *
 * ONE SWEEP FOR THE WHOLE SHEET, NOT A SEARCH PER AWB, and that is the whole
 * design. The manage-returns endpoint answers one POB at a time
 * (`/return/pob/{POB}/list?returnAwbNo=…`), so asking it per AWB is
 * POBs × windows × rows: a 60-POB account and a 100-row sheet is eighteen
 * thousand requests. The REPORT endpoint takes every POB in one body and
 * answers with `returnAwbNo` AND `pobId` on each row — so one sweep of the
 * window builds an index that answers every row at once, in windows × pages.
 *
 * Returns a Map keyed by UPPER-CASED AWB, because sheets arrive in every case.
 */
export function buildReturnPobIndex(page: any, { pobIds, days, onProgress, userLogger }?: {
    pobIds?: any[];
}): Promise<Map<any, any>>;
/**
 * Find the POB holding one return, by asking the LIVE manage-returns list.
 *
 * THE FALLBACK TO `buildReturnPobIndex`, and only that. The index sweeps the
 * report — one request per window for every POB at once — and answers most of
 * a sheet for almost nothing. This asks per POB, so it costs POBs × windows
 * for ONE row: paying it for a whole sheet would be thousands of requests,
 * which is why it runs only for the rows the sweep could not place.
 *
 * WHAT IT ADDS. The report is a report: a return created yesterday is not in
 * it yet. This list is the one the seller portal itself renders, so it answers
 * for returns the sweep cannot see — which is exactly the kind a bulk claim is
 * usually about.
 *
 * NEWEST WINDOW FIRST, stopping at the first POB that answers.
 */
export function findReturnPob(page: any, { returnOrderNo, returnAwb, pobIds, days, userLogger }?: {
    pobIds?: any[];
}): Promise<{
    pobId: any;
    returnOrderNo: string;
    returnAwbNo: string;
    custOrderNo: string;
    returnCreateDate: string;
    returnStatus: string;
}>;
