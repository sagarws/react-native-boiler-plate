/**
 * Write one workbook, one sheet per entry.
 *
 * @param {string} outputPath
 * @param {Array<{ name: string, columns: string[], rows: Array<Array<*>> }>} sheets
 *        A sheet with no rows is still written — "nothing failed" is an answer,
 *        and a missing sheet reads like the report was cut short.
 * @returns {string} outputPath
 */
export function writeReportWorkbook(outputPath: string, sheets?: Array<{
    name: string;
    columns: string[];
    rows: Array<Array<any>>;
}>): string;
