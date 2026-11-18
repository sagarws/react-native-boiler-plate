export namespace TICKET_REPORT_COLUMNS {
    let success: string[];
    let failed: string[];
}
/**
 * Write a bulk-claim job's ticket report — two sheets, "Success" and "Failed".
 *
 * @param {string} outputPath
 * @param {{ success: Array<{awb: string, sku: string, ticketId: string}>,
 *           failed: Array<{awb: string, sku: string, reason: string}> }} rows
 * @returns {string} outputPath
 */
export function writeTicketReport(outputPath: string, { success, failed }?: {
    success: Array<{
        awb: string;
        sku: string;
        ticketId: string;
    }>;
    failed: Array<{
        awb: string;
        sku: string;
        reason: string;
    }>;
}): string;
export const RESULT_COLUMNS: string[];
/** The columns the template hands the operator. */
export const TEMPLATE_COLUMNS: string[];
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
export const SHEET_ONLY_TEMPLATE_COLUMNS: string[];
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
export function isReturnOrderHeader(header: any): boolean;
/** Does this header name the return AWB column? Never the forward (outward) AWB. */
export function isAwbHeader(header: any): boolean;
/** Does this header name a SKU column? */
export function isSkuHeader(header: any): boolean;
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
export function readRows(inputPath: string, options?: {
    claimType?: string;
    eanAsSku?: boolean;
}): {
    rows: any[];
    ids: string[];
    idHeader: string;
    skuHeader: string | null;
    pobHeader: string | null;
    ticketHeader: string | null;
    byRon: boolean;
    dropped: Array<{
        rowNumber: number;
        id: string;
        ron: string;
        awb: string;
        sku: string;
        claimType: string | null;
        pobid: string;
        ticketNumber: string;
        kind: "duplicate" | "noId";
        reason: string;
    }>;
};
/** Default report path next to the input: "<name>.results.xlsx". */
export function defaultOutputPath(inputPath: any): string;
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
export function writeResults({ outputPath, rows, sourcePath }: {
    outputPath: string;
    rows: any[];
    sourcePath?: string;
}): string;
export function writeTemplate(outputPath: any, { columns }?: {
    columns?: string[];
}): any;
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
export function writeFilledSheet(outputPath: any, rows: any): any;
