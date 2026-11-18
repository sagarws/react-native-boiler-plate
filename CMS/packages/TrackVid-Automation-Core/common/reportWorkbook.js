// -----------------------------------------------------------------------------
// A job's report as a workbook — one sheet per list
// -----------------------------------------------------------------------------
// Every batch automation ends with the same two lists: what went through, and
// what did not and why. Each one grew its own writer — the AJIO bulk claim's
// `writeTicketReport` hard-codes RETURN AWB / SELLER SKU / TICKET ID — so a
// second job type meant a second near-identical function, and the third would
// have meant a third.
//
// This is the same thing with the columns as an argument. The caller decides
// what a row is about; this decides what a readable .xlsx looks like, which is
// the part that was being copied.
//
// PLATFORM-AGNOSTIC on purpose, so it lives in common/: a report is not a
// marketplace concept, and both runners write them.
// -----------------------------------------------------------------------------

/** Widest a column is allowed to get. A refusal reason is a sentence. */
const MAX_WIDTH = 80;

/** Narrowest, so a short header still reads as a column. */
const MIN_WIDTH = 10;

const cell = (value) => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();

    return typeof value === "number" || typeof value === "boolean" ? value : String(value);
};

/**
 * Column widths from the content, which is the difference between a report an
 * operator reads and one they have to drag every column of.
 */
const widths = (columns, rows) =>
    columns.map((column, index) => ({
        wch: Math.min(
            MAX_WIDTH,
            Math.max(MIN_WIDTH, String(column).length + 2, ...rows.map((row) => String(cell(row[index])).length + 2))
        ),
    }));

/**
 * Write one workbook, one sheet per entry.
 *
 * @param {string} outputPath
 * @param {Array<{ name: string, columns: string[], rows: Array<Array<*>> }>} sheets
 *        A sheet with no rows is still written — "nothing failed" is an answer,
 *        and a missing sheet reads like the report was cut short.
 * @returns {string} outputPath
 */
function writeReportWorkbook(outputPath, sheets = []) {
    const XLSX = require("xlsx");

    if (!Array.isArray(sheets) || sheets.length === 0) {
        throw new Error("writeReportWorkbook: at least one sheet is required");
    }

    const workbook = XLSX.utils.book_new();

    for (const sheet of sheets) {
        const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
        const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
        const body = rows.map((row) => columns.map((_, index) => cell(row[index])));

        const worksheet = XLSX.utils.aoa_to_sheet([columns, ...body]);

        worksheet["!cols"] = widths(columns, body);
        // The header stays put while an operator scrolls a thousand refusals.
        worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

        // Excel refuses a sheet name over 31 characters or containing []:*?/\,
        // and fails the whole write rather than the sheet — so the name is
        // cleaned here instead of trusting every caller to know that.
        const name = String(sheet.name || "Sheet").replace(/[[\]:*?/\\]/g, " ").slice(0, 31);

        XLSX.utils.book_append_sheet(workbook, worksheet, name);
    }

    XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });

    return outputPath;
}

module.exports = { writeReportWorkbook };
