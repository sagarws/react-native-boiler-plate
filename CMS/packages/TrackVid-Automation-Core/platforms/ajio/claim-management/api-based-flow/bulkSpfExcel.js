/**
 * Excel I/O for the bulk SPF claim — reading the operator's sheet, writing the
 * results report, and generating the blank template they start from.
 *
 * `xlsx` is an optional peer, so it is required inside each function that needs
 * it rather than at module scope: a consumer that only imports this module for
 * its constants must not need the dependency installed.
 *
 * Header detection is deliberately plain string work rather than regexes —
 * these headers come from client spreadsheets and are matched loosely, and a
 * loose regex over an unknown header set is how the AWB column gets picked up
 * as the return-order column.
 */

const path = require("path");
const fs = require("fs");

const RESULT_COLUMNS = [
    "Return AWB",
    "SKU", // one row PER ARTICLE — a multi-article return produces several
    "Claim Type",
    "Order Status",
    "Result", // Success | Failed | Help Center Failed | Not Claimable | Skipped | Pending
    "Reason", // why it was skipped, or how it failed
    "Ticket Number",
    "Error",
    "Timestamp",
];

/** The columns the template hands the operator. */
const TEMPLATE_COLUMNS = ["Return Order No", "Seller SKU"];

/**
 * The desktop app's template. It files straight from the sheet with no master
 * data behind it, so the sheet has to carry the POB the return lives under —
 * the same columns AJIO's own return report has, under the same names, so the
 * report can be uploaded unedited.
 *
 * EITHER identifier is enough. "RT Number" is AJIO's name for the return order
 * number and is preferred when present — it resolves the return directly,
 * skipping the AWB search, which is the only way to reach a self-ship return
 * (no AWB exists) or one older than the search window. "Return AWB" still
 * works on its own, and when both are filled in the AWB is what the results
 * sheet reports under.
 */
const SHEET_ONLY_TEMPLATE_COLUMNS = ["RT Number", "Return AWB", "Client SKU ID / EAN", "POB ID"];

/**
 * Does this header name the return-order column?
 *
 * "RT Number" is one of them. It is what AJIO's own return report calls the
 * return order number — the same value its search endpoints hand back as
 * `returnOrderNo` / `returnOrderId` — and this reader used to ignore the column
 * on the assumption it was something else. That meant every claim from AJIO's
 * own report went the long way round: search the AWB to obtain an id the sheet
 * had been carrying all along.
 *
 * Matched exactly rather than by substring: "rt" is two letters and appears
 * inside plenty of unrelated headers.
 *
 * Excludes anything containing "awb" so it can never claim the AWB column,
 * which is a separate (and less preferred) way of identifying the same return.
 */
function isReturnOrderHeader(header) {
    const s = String(header).trim().toLowerCase();

    if (s === "ron" || s === "return order no" || s === "return order number") return true;
    if (s === "return_order_no" || s === "returnorderno") return true;
    if (s === "rt number" || s === "rt no" || s === "rtnumber" || s === "rt_number" || s === "rt") return true;

    return s.includes("return") && s.includes("order") && !s.includes("awb") && (s.includes("no") || s.includes("number"));
}

/** Lowercased, trimmed, with runs of spaces collapsed — "Client SKU ID /  EAN" → "client sku id / ean". */
const normalise = (header) => String(header).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The FORWARD shipment's AWB. AJIO's return reports carry it beside the return
 * AWB ("Outward AWB No" next to "Return AWB"), and it identifies the original
 * delivery, not the return — resolving a claim by it matches nothing, or the
 * wrong record.
 */
const isForwardAwb = (s) => /\b(outward|outbound|forward|fwd)\b/.test(s);

/** Does this header name the return AWB column? Never the forward (outward) AWB. */
function isAwbHeader(header) {
    const s = normalise(header);

    if (!s.includes("awb") || isForwardAwb(s)) return false;
    if (s === "awb" || s === "return_order_awb_no") return true;

    return s.includes("return") || s.includes("no") || s.includes("number");
}

/** Does this header name a SKU column? */
function isSkuHeader(header) {
    const s = normalise(header);

    if (s === "sku" || s === "order_seller_sku") return true;

    return s.includes("sku");
}

/**
 * The first header matching the most specific tier that matches at all.
 *
 * Column ORDER must not decide which column is used. AJIO's return report
 * lists "Outward AWB No" several columns before "Return AWB", and a plain
 * `headers.find(isAwbHeader)` took whichever came first — every row was then
 * resolved by the forward AWB and nothing matched.
 */
function pickHeader(headers, tiers) {
    for (const tier of tiers) {
        const found = headers.find((header) => tier(normalise(header)));

        if (found) return found;
    }

    return null;
}

/** POB ID columns — "POB ID" in AJIO's return report. */
const POB_TIERS = [
    (s) => s === "pob id" || s === "pobid" || s === "pob_id" || s === "pob",
    (s) => s.includes("pob"),
];

/** An existing ticket for the return — "Ticket No" in AJIO's return report. */
const TICKET_TIERS = [
    (s) => s === "ticket no" || s === "ticket number" || s === "ticket" || s === "ticketnumber",
    (s) => s.includes("ticket"),
];

/** Return AWB columns, most specific first. */
const AWB_TIERS = [
    (s) => s === "return awb" || s === "return awb no" || s === "return awb number" || s === "return_order_awb_no",
    (s) => s.includes("awb") && s.includes("return") && !isForwardAwb(s),
    isAwbHeader,
];

/**
 * SKU columns, most specific first. The template's "Seller SKU" wins; AJIO's
 * return report calls the same column "Client SKU ID / EAN".
 */
const SKU_TIERS = [
    (s) => s === "seller sku" || s === "sku" || s === "order_seller_sku",
    (s) => s.includes("client sku"),
    (s) => s.includes("sku") && s.includes("seller"),
    isSkuHeader,
];

/**
 * A bare "EAN" column — what an operator's own sheet often calls the article.
 *
 * Opt-in (`eanAsSku`), because only the desktop flow can use it: it files from
 * the sheet, and `selectReturnItem` matches the article on AJIO's `eanCode`.
 * The server's flow narrows master data by `order_seller_SKU`, which an EAN
 * never equals — there an EAN read as a SKU would turn every row skuNotFound.
 *
 * Without it, a sheet listing one row per article under "EAN" had no SKU
 * column at all: its rows de-duplicated on the return number alone, so a
 * five-article return was read as one row, and AJIO refused it as ambiguous.
 */
const isEanHeader = (s) => /(^|[^a-z])ean([^a-z]|$)/.test(s);

/**
 * Read the operator's sheet.
 *
 * Accepts EITHER a "Return Order No" column (preferred — it lets the claim skip
 * AJIO's AWB search entirely, which is what makes self-ship and 60-day-old
 * returns resolvable) OR a "Return AWB No" column, plus an optional
 * "Seller SKU".
 *
 * Also accepts AJIO's own return report as-is — "Code/ Con, Class, Channel
 * Invoice No, Client SKU ID / EAN, Outward AWB No, …, RT Number, Return AWB,
 * POB ID, Remarks, Ticket No" — reading "RT Number" (its name for the return
 * order number), "Return AWB", "Client SKU ID / EAN", "POB ID" and "Ticket No",
 * and ignoring every other column. The outward AWB is never mistaken for the
 * return AWB; see isForwardAwb.
 *
 * A blank SKU means "every article of this return"; a SKU present means "only
 * that one". Rows are de-duplicated on (id + sku), so the same article listed
 * twice is claimed once.
 *
 * Nothing is dropped silently: a row read but not returned — a repeat of an
 * earlier row, or one with no return number — comes back in `dropped`, with its
 * sheet row number and the reason, so a caller can report every row it was
 * given. A row with every cell empty is not a record and is not reported.
 *
 * @param {string} inputPath
 * @param {{ claimType?: string, eanAsSku?: boolean }} [options] `claimType` is
 *        stamped onto every row — for the desktop app, where the upload slot
 *        the file came from IS the choice. `eanAsSku` reads a bare "EAN" column
 *        as the SKU when no SKU column exists (desktop only; see isEanHeader).
 * Rows also carry `pobid` and `ticketNumber` when the sheet has those columns
 * (empty strings otherwise). The server's master-data flow ignores those two;
 * the desktop app files from them.
 *
 * @returns {{ rows: Array, ids: string[], idHeader: string, skuHeader: string|null,
 *            pobHeader: string|null, ticketHeader: string|null, byRon: boolean,
 *            dropped: Array<{ rowNumber: number, id: string, ron: string, awb: string,
 *              sku: string, claimType: string|null, pobid: string, ticketNumber: string,
 *              kind: "duplicate"|"noId", reason: string }> }}
 */
function readRows(inputPath, options = {}) {
    const XLSX = require("xlsx");

    const workbook = XLSX.readFile(inputPath);
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) throw new Error("Input workbook has no sheets");

    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    if (!sheetRows.length) {
        return { rows: [], ids: [], idHeader: null, skuHeader: null, pobHeader: null, ticketHeader: null, byRon: false, dropped: [] };
    }

    const headers = Object.keys(sheetRows[0]);
    const ronHeader = headers.find(isReturnOrderHeader) || null;
    const awbHeader = pickHeader(headers, AWB_TIERS);
    // Provisional: the real choice is made below, once the rows can be read —
    // an empty column is not an identifier, whatever its heading says.
    const idHeader = ronHeader || awbHeader;

    if (!idHeader) {
        throw new Error(
            `Could not find a return identifier — "RT Number", "Return Order No" or ` +
                `"Return AWB" (an outward/forward AWB is not a return identifier). ` +
                `Found: ${headers.join(", ")}`
        );
    }

    /*
     * WHICH COLUMN ACTUALLY HOLDS THE IDENTIFIERS — decided by CONTENT, not by
     * which header exists.
     *
     * The template ships both columns, and an operator who has only return
     * order numbers reasonably types them under whichever heading they read
     * first — leaving the other column empty. Choosing by header alone then
     * picked the empty one and reported "That sheet has no rows" about a sheet
     * with twelve of them.
     *
     * So the RT column wins only when it has something in it. Nothing else
     * changes: a sheet with both columns filled behaves exactly as before.
     */
    const hasValues = (header) =>
        !!header && sheetRows.some((sheetRow) => String(sheetRow[header] ?? "").trim() !== "");
    const byRon = hasValues(ronHeader);
    const skuHeader = pickHeader(headers, options.eanAsSku ? [...SKU_TIERS, isEanHeader] : SKU_TIERS);
    const pobHeader = pickHeader(headers, POB_TIERS);
    const ticketHeader = pickHeader(headers, TICKET_TIERS);
    const cell = (sheetRow, header) => (header && sheetRow[header] != null ? String(sheetRow[header]).trim() : "");
    const claimType = options.claimType ? String(options.claimType).trim().toUpperCase() : null;

    // pairKey → the sheet row it was first read from, for naming a repeat.
    const seenPair = new Map();
    const seenId = new Set();
    const rows = [];
    const ids = [];
    const dropped = [];

    for (const sheetRow of sheetRows) {
        // Excel happily stores an order number as a number; everything downstream
        // compares it as a string.
        const chosenHeader = byRon ? ronHeader : awbHeader || ronHeader;
        const id = sheetRow[chosenHeader] == null ? "" : String(sheetRow[chosenHeader]).trim();
        // SheetJS's own (0-based, header = 0) index, so blank rows it skipped
        // do not shift the number; the Excel row is one more.
        const rowNumber = typeof sheetRow.__rowNum__ === "number" ? sheetRow.__rowNum__ + 1 : 0;
        const sku = skuHeader && sheetRow[skuHeader] != null ? String(sheetRow[skuHeader]).trim() : "";
        const droppedRow = (kind, reason) => ({
            rowNumber,
            id,
            ron: byRon ? id : cell(sheetRow, ronHeader),
            awb: byRon ? cell(sheetRow, awbHeader) : id,
            sku,
            claimType,
            pobid: cell(sheetRow, pobHeader),
            ticketNumber: cell(sheetRow, ticketHeader),
            kind,
            reason,
        });

        if (!id) {
            if (Object.values(sheetRow).some((value) => String(value ?? "").trim() !== "")) {
                dropped.push(droppedRow("noId", `No return number or return AWB on sheet row ${rowNumber}`));
            }

            continue;
        }

        const pairKey = `${id}::${sku}`;

        if (seenPair.has(pairKey)) {
            dropped.push(
                droppedRow(
                    "duplicate",
                    `Duplicate of sheet row ${seenPair.get(pairKey)} (same return${sku ? " and article" : ""}) — filed once, under that row`
                )
            );

            continue;
        }

        seenPair.set(pairKey, rowNumber);
        // BOTH, when the sheet has both — they do different jobs. The return
        // order number resolves the return at AJIO (and lets the claim skip the
        // AWB search); the AWB is what the results sheet, the write-back and the
        // operator identify the row by. They used to be mutually exclusive, so
        // AJIO's own report — which carries both — had its AWB discarded and
        // every row reported under an order number instead.
        rows.push({
            id,
            ron: byRon ? id : cell(sheetRow, ronHeader),
            awb: byRon ? cell(sheetRow, awbHeader) : id,
            sku,
            claimType,
            pobid: cell(sheetRow, pobHeader),
            ticketNumber: cell(sheetRow, ticketHeader),
        });

        if (!seenId.has(id)) {
            seenId.add(id);
            ids.push(id);
        }
    }

    return { rows, ids, idHeader, skuHeader, pobHeader, ticketHeader, byRon, dropped };
}

/** Default report path next to the input: "<name>.results.xlsx". */
function defaultOutputPath(inputPath) {
    const ext = path.extname(inputPath);

    return path.join(path.dirname(inputPath), `${path.basename(inputPath, ext)}.results.xlsx`);
}

function resultSheet(XLSX, resultRows) {
    // AN "Attempt" COLUMN only when the rows carry one — the desktop counts
    // which filing produced each row (1, +1 per Retry); the server's rows do
    // not, and its report keeps exactly the columns it always had.
    const withAttempt = resultRows.some((row) => Number.isInteger(row && row.attempt));
    const aoa = [withAttempt ? [...RESULT_COLUMNS, "Attempt"] : RESULT_COLUMNS];

    for (const row of resultRows) {
        aoa.push([
            row.awb || "",
            row.sku || "",
            row.claimType || "",
            row.orderStatus || "",
            row.result || "",
            row.reason || "",
            row.ticketNumber || "",
            row.error || "",
            row.timestamp || "",
            ...(withAttempt ? [Number.isInteger(row.attempt) && row.attempt > 0 ? row.attempt : 1] : []),
        ]);
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa);

    sheet["!cols"] = [
        { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 18 },
        { wch: 30 }, { wch: 16 }, { wch: 50 }, { wch: 22 },
        ...(withAttempt ? [{ wch: 9 }] : []),
    ];

    return sheet;
}

/**
 * Write (or rewrite) the "Results" sheet.
 *
 * Called after EVERY article with the full accumulated results, so a crash
 * three hours into a run leaves a report of what had been done rather than
 * nothing. That is why the write is atomic: a half-written workbook is worse
 * than a stale one, and an operator with the file open must not be able to
 * corrupt it.
 *
 * @param {object} options
 * @param {string}  options.outputPath  where to write — never the operator's original
 * @param {Array}   options.rows        every result so far
 * @param {string} [options.sourcePath] a workbook whose other sheets are carried
 *        across, so the server's report still contains the client's own sheet.
 *        Omitted by the desktop app, which merges two uploads into one report
 *        and so has no single source.
 */
function writeResults({ outputPath, rows, sourcePath = null }) {
    const XLSX = require("xlsx");

    let workbook;

    if (sourcePath && fs.existsSync(sourcePath)) {
        workbook = XLSX.readFile(sourcePath);

        // Drop a previous Results sheet so this rewrites rather than appends.
        if (workbook.SheetNames.includes("Results")) {
            delete workbook.Sheets["Results"];
            workbook.SheetNames = workbook.SheetNames.filter((name) => name !== "Results");
        }
    } else {
        workbook = XLSX.utils.book_new();
    }

    XLSX.utils.book_append_sheet(workbook, resultSheet(XLSX, rows), "Results");

    // Write beside the target then rename over it. rename() within a filesystem
    // is atomic, so a reader either sees the previous report or the new one.
    const tempPath = `${outputPath}.tmp`;

    XLSX.writeFile(workbook, tempPath, { bookType: "xlsx" });
    fs.renameSync(tempPath, outputPath);

    return outputPath;
}

/**
 * Write the blank template an operator fills in.
 *
 * Generated rather than shipped as a binary: a checked-in .xlsx is a file that
 * silently stops matching what `readRows` accepts.
 *
 * @param {string} outputPath
 * @param {{ columns?: string[] }} [options] defaults to the server's template
 */
/**
 * Write a filled copy of the sheet-only template.
 *
 * SAME COLUMNS, SAME ORDER as `SHEET_ONLY_TEMPLATE_COLUMNS`, because the file
 * this produces goes straight back into the NDR/DDR upload — a filled sheet
 * the bulk claim cannot read would be a worse answer than no file at all.
 *
 * A row that could not be filled keeps its POB blank and carries the reason in
 * a trailing column. Dropping those rows would hand back a shorter file with
 * no hint which AWBs went missing, and the operator would have to diff two
 * spreadsheets to find out.
 */
function writeFilledSheet(outputPath, rows) {
    const XLSX = require("xlsx");
    const header = [...SHEET_ONLY_TEMPLATE_COLUMNS, "Note"];
    const body = rows.map((row) => [
        row.rtNumber || "",
        row.awb || "",
        row.sku || "",
        row.pobId || "",
        row.note || "",
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);

    sheet["!cols"] = header.map((column) => ({ wch: Math.max(18, column.length + 6) }));

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, sheet, "Claims");
    XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });

    return outputPath;
}

function writeTemplate(outputPath, { columns = TEMPLATE_COLUMNS } = {}) {
    const XLSX = require("xlsx");

    const sheet = XLSX.utils.aoa_to_sheet([columns]);

    sheet["!cols"] = columns.map((column) => ({ wch: Math.max(18, column.length + 6) }));

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, sheet, "Claims");
    XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });

    return outputPath;
}

/** The desktop app's per-job ticket report: what was filed, and what was not. */
const TICKET_REPORT_COLUMNS = {
    success: ["RETURN AWB", "SELLER SKU", "TICKET ID"],
    failed: ["RETURN AWB", "SELLER SKU", "FAILED REASON"],
};

/**
 * Write a bulk-claim job's ticket report — two sheets, "Success" and "Failed".
 *
 * @param {string} outputPath
 * @param {{ success: Array<{awb: string, sku: string, ticketId: string}>,
 *           failed: Array<{awb: string, sku: string, reason: string}> }} rows
 * @returns {string} outputPath
 */
function writeTicketReport(outputPath, { success = [], failed = [] } = {}) {
    const XLSX = require("xlsx");

    const sheet = (columns, data) => {
        const ws = XLSX.utils.aoa_to_sheet([columns, ...data]);

        ws["!cols"] = columns.map((column, i) => ({
            wch: Math.min(80, Math.max(column.length + 2, ...data.map((row) => String(row[i] ?? "").length + 2))),
        }));

        return ws;
    };

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        sheet(TICKET_REPORT_COLUMNS.success, success.map((r) => [r.awb || "", r.sku || "", r.ticketId || ""])),
        "Success"
    );
    XLSX.utils.book_append_sheet(
        workbook,
        sheet(TICKET_REPORT_COLUMNS.failed, failed.map((r) => [r.awb || "", r.sku || "", r.reason || ""])),
        "Failed"
    );

    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });

    return outputPath;
}

module.exports = {
    TICKET_REPORT_COLUMNS,
    writeTicketReport,
    RESULT_COLUMNS,
    TEMPLATE_COLUMNS,
    SHEET_ONLY_TEMPLATE_COLUMNS,
    isReturnOrderHeader,
    isAwbHeader,
    isSkuHeader,
    readRows,
    defaultOutputPath,
    writeResults,
    writeTemplate,
    writeFilledSheet,
};
