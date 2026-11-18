/**
 * @param {object}   page              a signed-in AJIO Puppeteer page
 * @param {string}   awb               the return AWB
 * @param {object}   options
 * @param {string[]} options.pobIds    the places of business on THIS account
 * @param {import("../../../../common/accountMapping").RecentFirst} [options.recentPobs]
 * @param {object}   [options.logger]
 * @returns {Promise<{found: boolean, scope: {pobId: string}|null, details: object|null}>}
 */
export function probeAjioAwb(page: object, awb: string, { pobIds, recentPobs, logger }?: {
    pobIds: string[];
    recentPobs?: import("../../../../common/accountMapping").RecentFirst;
    logger?: object;
}): Promise<{
    found: boolean;
    scope: {
        pobId: string;
    } | null;
    details: object | null;
}>;
/** The [from, to] the vision list is scoped to. */
export function searchWindow(days?: number): {
    from: any;
    to: any;
};
/**
 * Same default as the claim flow's own search window, and overridable by the
 * same variable — a return the claim could find must not be one the mapping
 * calls missing.
 */
export const SEARCH_WINDOW_DAYS: number;
