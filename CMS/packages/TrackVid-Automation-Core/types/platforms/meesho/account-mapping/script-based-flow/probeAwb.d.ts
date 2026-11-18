/**
 * @param {object} page  a signed-in Meesho Puppeteer page
 * @param {string} awb
 * @param {object} [options]
 * @param {number} [options.settleMs]  how long the grid is given to render
 * @param {object} [options.logger]
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeMeeshoAwb(page: object, awb: string, { settleMs, logger }?: {
    settleMs?: number;
    logger?: object;
}): Promise<{
    found: boolean;
    details: object | null;
}>;
/** The URL pressing Enter in that box produces. */
export function searchUrl(awb: any): string;
/** The search box, by its placeholder — Meesho's class names are generated. */
export const SEARCH_INPUT: "input[placeholder*=\"AWB\" i]";
/** Rendered by the results grid; `aria-label="sticky table"` is stable across builds. */
export const RESULTS_TABLE: "table[aria-label=\"sticky table\"]";
