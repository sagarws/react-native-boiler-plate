/**
 * AJIO's own dropship reports, read a page at a time.
 *
 * The seller portal's "View Reports" screen is backed by two paged JSON
 * endpoints — one per direction of a shipment — and this is a READ of exactly
 * those. It exists so an operator can check what AJIO actually holds for a date
 * range without leaving the app or downloading a workbook: the master import
 * beside it pulls the same data as xlsx for storage, which answers a different
 * question and answers it slowly.
 *
 * Both endpoints are POSTs despite being reads. `page`, `size`, `from` and `to`
 * go in the QUERY STRING; the places of business go in a form-urlencoded BODY
 * as one comma-separated `pobIds` value. Sending the POBs as a query parameter
 * returns an empty list rather than an error, which is the failure mode worth
 * knowing about: it looks like "this seller had no orders".
 *
 * Driven from inside a logged-in page, like every other AJIO call: Akamai wants
 * the browser's own HttpOnly `bff_session` and its real TLS fingerprint.
 */

/**
 * The two reports, and the columns worth showing of each.
 *
 * A row carries forty-odd fields; a table that showed them all would be
 * unreadable and one that showed five would be useless. These are the ones an
 * operator checking master data against a claim actually reads — identifiers
 * first, then status, then money — and the raw row is returned alongside so
 * nothing is lost for a caller that wants more.
 */
const REPORTS = {
    forward: {
        label: "Forward Report",
        path: "/malekith/vision/v1/dropship/order/report",
        listKey: "orderList",
        columns: [
            { key: "orderNo", label: "Order No" },
            { key: "orderDate", label: "Order Date" },
            { key: "awbNumber", label: "AWB Number" },
            { key: "sellerSKU", label: "Seller SKU" },
            { key: "itemCode", label: "Jio Code" },
            { key: "ean", label: "EAN" },
            { key: "styleCode", label: "Style Code" },
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty" },
            { key: "orderStatus", label: "Order Status" },
            { key: "shipmentStatus", label: "Shipment Status" },
            { key: "slaStatus", label: "SLA" },
            { key: "carrier", label: "Carrier" },
            { key: "shipmentDate", label: "Shipment Date" },
            { key: "dispatchDate", label: "Dispatch Date" },
            { key: "purchaseOrderNumber", label: "PO No" },
            { key: "sellerInvoiceNo", label: "Seller Invoice" },
            { key: "customerInvoiceNo", label: "Customer Invoice" },
            { key: "totalValue", label: "Total Value" },
            { key: "brand", label: "Brand" },
            { key: "pobId", label: "POB" },
        ],
    },
    return: {
        label: "Return Report",
        path: "/malekith/vision/v1/dropship/rtv/report",
        listKey: "rtvList",
        columns: [
            { key: "returnOrderNo", label: "Return Order No" },
            { key: "returnAwbNo", label: "Return AWB" },
            { key: "returnCreateDate", label: "Return Date" },
            { key: "sellerSku", label: "Seller SKU" },
            { key: "jioCode", label: "Jio Code" },
            { key: "ean", label: "EAN" },
            { key: "returnStatus", label: "Return Status" },
            { key: "returnType", label: "Type" },
            { key: "returnQty", label: "Qty" },
            { key: "custReturnReason", label: "Reason" },
            { key: "returnCarrierName", label: "Carrier" },
            { key: "returnDeliveredDate", label: "Delivered On" },
            { key: "custOrderNo", label: "Customer Order" },
            { key: "fwdShipmentId", label: "Fwd Shipment" },
            { key: "fwdAwbNo", label: "Fwd AWB" },
            { key: "fwdPoNo", label: "Fwd PO" },
            { key: "returnValue", label: "Return Value" },
            { key: "creditNoteNo", label: "Credit Note" },
            { key: "sellerName", label: "Seller" },
            { key: "pobId", label: "POB" },
        ],
    },
};

/** The report types this can read. */
const REPORT_TYPES = Object.keys(REPORTS);

/** One report's descriptor — label, columns — or null for an unknown type. */
function reportDescriptor(type) {
    return REPORTS[String(type || "").toLowerCase().trim()] || null;
}

/** AJIO caps the page size; 100 is what its own screen asks for. */
const MAX_PAGE_SIZE = 100;

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
async function fetchDropshipReport(page, {
    reportType,
    pobIds = [],
    from,
    to,
    pageNumber = 0,
    size = 50,
    businessModel = "B2C",
    returnOrderNo = "",
    orderNo = "",
    userLogger,
}) {
    const report = reportDescriptor(reportType);

    if (!report) throw new Error(`Unknown report type "${reportType}"`);
    if (!from || !to) throw new Error("fetchDropshipReport: from and to are required");
    if (pobIds.length === 0) {
        // Not an empty result — a question that was never asked. AJIO answers an
        // empty POB list with an empty order list, which reads exactly like "this
        // seller had nothing", so it is refused here instead.
        throw new Error("No POB ids for this account — run Sync POBs in Monitor first");
    }

    const capped = Math.min(Math.max(1, Number(size) || 50), MAX_PAGE_SIZE);
    const url =
        `${report.path}?page=${Math.max(0, Number(pageNumber) || 0)}&size=${capped}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        // A QUERY parameter, unlike the POBs — this is where AJIO's own screen
        // puts it, and the filter is applied server-side within the window.
        (String(returnOrderNo || "").trim()
            ? `&returnOrderNo=${encodeURIComponent(String(returnOrderNo).trim())}`
            : "") +
        // The FORWARD report's equivalent, and it is a different parameter name
        // on a different path — `orderNo` on dropship/order/report. Same shape
        // otherwise: a query filter, POBs in the body.
        (String(orderNo || "").trim()
            ? `&orderNo=${encodeURIComponent(String(orderNo).trim())}`
            : "");
    // Form-urlencoded, in the BODY. As a query parameter this returns an empty
    // list rather than an error.
    const body = `pobIds=${encodeURIComponent(pobIds.join(","))}`;

    const res = await page.evaluate(
        async (u, payload, model) => {
            try {
                const r = await fetch(u, {
                    method: "POST",
                    headers: {
                        Accept: "application/json, text/plain, */*",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "X-Tenant": "AJIO",
                        businessModel: model,
                    },
                    body: payload,
                    credentials: "include",
                });
                const text = await r.text();

                return { status: r.status, text: text.slice(0, 5_000_000) };
            } catch (e) {
                return { status: -1, text: String(e) };
            }
        },
        url,
        body,
        businessModel
    );

    /*
     * "NO RECORDS" IS AN ANSWER, NOT A FAILURE.
     *
     * AJIO replies `404 {"errorCode":404,"errorMessage":"No records found..."}`
     * for a window that holds nothing — which is the ordinary case when a
     * lookup walks back month by month. Treated as an error, the FIRST empty
     * window ended the whole search: a return order created on 2 September was
     * reported "Return Report failed: HTTP 404" because the newest window — the
     * one it was never in — answered first.
     *
     * Narrowed to that body on purpose. A 404 from a path AJIO no longer serves
     * is a real fault and must still be loud; only "there is nothing here"
     * counts as an empty page.
     */
    const saysNoRecords =
        res.status === 404 && /no\s+records/i.test(String(res.text || ""));

    if (saysNoRecords) {
        userLogger?.info?.(
            `📄 AJIO ${report.label}: ${from}..${to} holds no records`
        );

        return { rows: [], pageNumber: Number(pageNumber) || 0, totalPages: 0, totalRows: 0 };
    }

    if (res.status < 200 || res.status >= 300) {
        throw new Error(
            `${report.label} failed: HTTP ${res.status} ${String(res.text || "").slice(0, 200)}`
        );
    }

    let json;

    try {
        json = JSON.parse(res.text);
    } catch (err) {
        throw new Error(`${report.label} returned a non-JSON body: ${String(res.text).slice(0, 200)}`);
    }

    const result = json.result || {};
    const rows = Array.isArray(result[report.listKey]) ? result[report.listKey] : [];

    userLogger?.info?.(
        `📄 AJIO ${report.label}: page ${result.pageNumber ?? pageNumber} of ` +
        `${result.totalPages ?? "?"} — ${rows.length} row(s)`
    );

    return {
        rows,
        pageNumber: typeof result.pageNumber === "number" ? result.pageNumber : Number(pageNumber) || 0,
        totalPages: typeof result.totalPages === "number" ? result.totalPages : 0,
        /**
         * How many rows AJIO says the WINDOW holds, not how many it will serve.
         *
         * Carried because `totalPages` alone cannot tell a finished month from a
         * truncated one. AJIO answers 100 for every month — 100 pages at the
         * 100-row cap above is exactly 10,000 rows, the usual server-side
         * result-window limit — so a month with 25,000 orders reports the same
         * "100 of 100" as one with 9,000 and the reader stops, complete and
         * short by 15,000 rows with nothing to say so.
         *
         * Null when the field is absent: "unknown" and "none" are different
         * answers, and a caller must not read a missing count as zero.
         */
        totalElements: typeof result.totalElements === "number" ? result.totalElements : null,
        columns: report.columns,
    };
}

/** AJIO refuses a report window wider than 31 days, inclusive of both ends. */
const MAX_WINDOW_DAYS = 31;

/**
 * yyyy-mm-dd for a UTC-midnight Date.
 *
 * @param {Date} date
 * @returns {string}
 */
const isoDay = (date) => date.toISOString().slice(0, 10);

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
function returnSearchWindows({ months = 5, now = Date.now() } = {}) {
    const DAY = 24 * 60 * 60 * 1000;
    // Today as IST sees it, pinned to UTC midnight so the arithmetic below is
    // whole days on every machine's timezone.
    const ist = new Date(now + 330 * 60 * 1000);
    let to = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    const windows = [];

    for (let i = 0; i < Math.max(1, Number(months) || 1); i += 1) {
        const from = to - (MAX_WINDOW_DAYS - 1) * DAY;

        windows.push({ from: isoDay(new Date(from)), to: isoDay(new Date(to)) });
        to = from - DAY;
    }

    return windows;
}

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
async function findReturnOrder(page, { returnOrderNo, pobIds = [], months, userLogger }) {
    const wanted = String(returnOrderNo || "").trim();

    if (!wanted) throw new Error("findReturnOrder: returnOrderNo is required");

    const { AJIO_RETURN_SEARCH_MONTHS, AJIO_RETURN_SEARCH_MAX_PAGES } = require("../../../../common/constants.js");

    // Newest window first — see `returnSearchWindows`. A return order filed
    // last week is found on the first request; one from five months ago costs
    // the full walk, which is the right way round.
    const windows = returnSearchWindows({ months: months || AJIO_RETURN_SEARCH_MONTHS });
    const matches = (row) =>
        String(row?.returnOrderNo || "").trim().toUpperCase() === wanted.toUpperCase();
    let searched = 0;
    let pagesRead = 0;

    for (const window of windows) {
        searched += 1;

        /*
         * EVERY PAGE OF THE WINDOW, not just the first.
         *
         * AJIO does apply `returnOrderNo` when it is sent this way — a filtered
         * window answers `totalPages: 1` with the order's lines — so in the
         * normal case this loop runs exactly once and costs nothing.
         *
         * It exists for the case where it does not: the same path serves the
         * report view unfiltered, where a month is 78 pages, and a single page
         * read would then search the newest 100 rows and call the rest absent.
         * A lookup that silently searches a hundredth of what it claims is the
         * worst way for this to fail, so the page count is honoured whatever
         * the server chose to do with the filter.
         */
        let totalPages = 1;

        for (let pageNumber = 0; pageNumber < totalPages; pageNumber += 1) {
            if (pagesRead >= AJIO_RETURN_SEARCH_MAX_PAGES) {
                userLogger?.warn?.(
                    `🔎 AJIO return ${wanted}: stopped after ${pagesRead} page(s) — ` +
                        `the ${AJIO_RETURN_SEARCH_MAX_PAGES}-page ceiling was reached`
                );

                return { rows: [], window: null, searched };
            }

            const answer = await fetchDropshipReport(page, {
                reportType: "return",
                pobIds,
                from: window.from,
                to: window.to,
                pageNumber,
                size: MAX_PAGE_SIZE,
                returnOrderNo: wanted,
                userLogger,
            });

            pagesRead += 1;

            // Read from the FIRST answer of each window, not assumed: a window
            // with nothing in it reports 0, and the loop then ends after one
            // request rather than walking a page count from the month before.
            if (pageNumber === 0) totalPages = Math.max(1, answer.totalPages || 1);

            const rows = answer.rows.filter(matches);

            if (rows.length > 0) {
                userLogger?.info?.(
                    `🔎 AJIO return ${wanted}: ${rows.length} line(s) in ` +
                        `${window.from}..${window.to} (page ${pageNumber + 1} of ${totalPages})`
                );

                return { rows, window, searched };
            }

            // Short page means the server has no more, whatever it claimed.
            if (answer.rows.length < MAX_PAGE_SIZE) break;
        }
    }

    userLogger?.info?.(
        `🔎 AJIO return ${wanted}: not found in the last ${searched} window(s), ` +
            `${pagesRead} page(s) read`
    );

    return { rows: [], window: null, searched };
}

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
async function findForwardAwb(page, { orderNo, pobIds = [], months, on, userLogger }) {
    const wanted = String(orderNo || "").trim();

    if (!wanted) return { awbNumber: null, row: null, searched: 0 };

    const { AJIO_RETURN_SEARCH_MONTHS, AJIO_RETURN_SEARCH_MAX_PAGES } = require("../../../../common/constants.js");

    const anchor = on ? Date.parse(String(on)) : Date.now();
    const windows = returnSearchWindows({
        months: months || AJIO_RETURN_SEARCH_MONTHS,
        now: Number.isNaN(anchor) ? Date.now() : anchor,
    });
    const matches = (row) =>
        String(row?.orderNo || "").trim().toUpperCase() === wanted.toUpperCase();
    let searched = 0;
    let pagesRead = 0;

    for (const window of windows) {
        searched += 1;

        let totalPages = 1;

        for (let pageNumber = 0; pageNumber < totalPages; pageNumber += 1) {
            if (pagesRead >= AJIO_RETURN_SEARCH_MAX_PAGES) {
                userLogger?.warn?.(
                    `🔎 AJIO order ${wanted}: stopped after ${pagesRead} page(s) — ceiling reached`
                );

                return { awbNumber: null, row: null, searched };
            }

            const answer = await fetchDropshipReport(page, {
                reportType: "forward",
                pobIds,
                from: window.from,
                to: window.to,
                pageNumber,
                size: MAX_PAGE_SIZE,
                orderNo: wanted,
                userLogger,
            });

            pagesRead += 1;

            if (pageNumber === 0) totalPages = Math.max(1, answer.totalPages || 1);

            // The first line carrying an AWB wins. An order can have several
            // lines and they ship together, so the AWB is the same on each —
            // but a line can be cancelled and carry none, and that one must not
            // be read as "this order has no forward AWB".
            const row = answer.rows.filter(matches).find((entry) => {
                const awb = String(entry?.awbNumber || "").trim();

                return awb.length > 0;
            });

            if (row) {
                userLogger?.info?.(
                    `🔎 AJIO order ${wanted}: forward AWB ${row.awbNumber} in ` +
                        `${window.from}..${window.to}`
                );

                return { awbNumber: String(row.awbNumber).trim(), row, searched };
            }

            if (answer.rows.length < MAX_PAGE_SIZE) break;
        }
    }

    userLogger?.info?.(
        `🔎 AJIO order ${wanted}: no forward AWB in the last ${searched} window(s)`
    );

    return { awbNumber: null, row: null, searched };
}

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
async function buildReturnPobIndex(page, { pobIds = [], days, onProgress, userLogger } = {}) {
    const {
        AJIO_POB_FILL_DAYS,
        AJIO_RETURN_SEARCH_MAX_PAGES,
    } = require("../../../../common/constants.js");

    const span = Number(days) || AJIO_POB_FILL_DAYS;
    // 31 days is the widest window the report answers, so the span is covered
    // in that many whole windows — rounded up, never short.
    const windows = returnSearchWindows({ months: Math.ceil(span / MAX_WINDOW_DAYS) });
    const byAwb = new Map();
    let pagesRead = 0;

    for (const window of windows) {
        let totalPages = 1;

        for (let pageNumber = 0; pageNumber < totalPages; pageNumber += 1) {
            if (pagesRead >= AJIO_RETURN_SEARCH_MAX_PAGES) {
                userLogger?.warn?.(
                    `🔎 AJIO POB index: stopped after ${pagesRead} page(s) — ceiling reached`
                );

                return byAwb;
            }

            const answer = await fetchDropshipReport(page, {
                reportType: "return",
                pobIds,
                from: window.from,
                to: window.to,
                pageNumber,
                size: MAX_PAGE_SIZE,
                userLogger,
            });

            pagesRead += 1;

            if (pageNumber === 0) totalPages = Math.max(1, answer.totalPages || 1);

            for (const row of answer.rows) {
                const entry = {
                    pobId: String(row?.pobId || "").trim(),
                    returnOrderNo: String(row?.returnOrderNo || "").trim(),
                    // Carried because a sheet of RT numbers alone needs the AWB
                    // back: it is the column the claim and its report identify
                    // the row by.
                    returnAwbNo: String(row?.returnAwbNo || "").trim(),
                    sellerSku: String(row?.sellerSku || "").trim(),
                    ean: String(row?.ean || "").trim(),
                };

                /*
                 * KEYED BY BOTH THE AWB AND THE RETURN ORDER NUMBER.
                 *
                 * The sheet's identifier column is whatever the operator had:
                 * AJIO's report carries both, a courier list has only the AWB,
                 * and a sheet typed from the seller panel often has only the
                 * RT number — sometimes under the "Return AWB" heading. One
                 * index answering either spelling means the fill does not care
                 * which, and nothing has to guess from the shape of a string.
                 *
                 * Newest window first, so the first answer wins and a
                 * re-shipped return does not overwrite it with an older POB.
                 */
                for (const key of [
                    String(row?.returnAwbNo || "").trim().toUpperCase(),
                    entry.returnOrderNo.toUpperCase(),
                ]) {
                    if (key && !byAwb.has(key)) byAwb.set(key, entry);
                }
            }

            onProgress?.({ window, pageNumber, totalPages, found: byAwb.size });

            if (answer.rows.length < MAX_PAGE_SIZE) break;
        }
    }

    userLogger?.info?.(
        `🔎 AJIO POB index: ${byAwb.size} return AWB(s) across ${windows.length} window(s), ` +
            `${pagesRead} page(s)`
    );

    return byAwb;
}

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
async function findReturnPob(page, { returnOrderNo, returnAwb, pobIds = [], days, userLogger } = {}) {
    const wanted = String(returnOrderNo || "").trim();
    const wantedAwb = String(returnAwb || "").trim();

    if (!wanted && !wantedAwb) return null;

    const { AJIO_POB_FILL_DAYS } = require("../../../../common/constants.js");
    const { searchReturnRow } = require("../../claim-management/api-based-flow/updatedClaimApiFlow.js");

    const span = Number(days) || AJIO_POB_FILL_DAYS;

    /*
     * ONE WIDE WINDOW, not a slice per month.
     *
     * The 31-day ceiling belongs to the REPORT endpoint. This is the
     * manage-returns list, and it answers a 90-day range in a single request —
     * verified against the portal's own call,
     * `from=2026-07-08&to=2026-10-05`, which returns the match in one go.
     *
     * Slicing it into 31-day windows therefore tripled the request count for
     * nothing: the same POB was asked three times, and a return near a window
     * edge was still found only on whichever slice happened to hold it.
     */
    const to = isoDay(new Date());
    const from = isoDay(new Date(Date.now() - (span - 1) * 24 * 60 * 60 * 1000));
    const windows = [{ from, to }];
    const misses = [];

    for (const window of windows) {
        for (const pobId of pobIds) {
            let row = null;

            try {
                row = await searchReturnRow(page, {
                    pobid: pobId,
                    returnOrderNo: wanted,
                    returnAwb: wantedAwb,
                    from: window.from,
                    to: window.to,
                    userLogger,
                    misses,
                });
            } catch (error) {
                // One POB refusing is not the account's answer. Keep sweeping;
                // a genuine outage shows up as every POB missing.
                misses.push(`${pobId}: ${error?.message || error}`);
                continue;
            }

            if (row) {
                userLogger?.info?.(
                    `🔎 AJIO ${wanted || wantedAwb}: found under ${pobId} (${window.from}..${window.to})`
                );

                return {
                    pobId,
                    returnOrderNo: String(row.returnOrderNo || "").trim(),
                    returnAwbNo: String(row.returnAwbNo || "").trim(),
                    custOrderNo: String(row.custOrderNo || "").trim(),
                    returnCreateDate: String(row.returnCreateDate || "").trim(),
                    returnStatus: String(row.returnStatus || "").trim(),
                };
            }
        }
    }

    return null;
}

module.exports = {
    REPORTS,
    REPORT_TYPES,
    MAX_PAGE_SIZE,
    MAX_WINDOW_DAYS,
    reportDescriptor,
    fetchDropshipReport,
    returnSearchWindows,
    findReturnOrder,
    findForwardAwb,
    buildReturnPobIndex,
    findReturnPob,
};
