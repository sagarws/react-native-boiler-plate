/**
 * Page through whichever POB endpoint this credential is entitled to and
 * collect every POB id, one per record returned.
 *
 * @param {object} page      Puppeteer page already carrying the AJIO session
 * @param {string} userId    Seller userId from the cached session
 * @param {object} [opts]
 * @param {boolean} [opts.enterpriseLevel=false]  credential.IsEnterPriceLevel —
 *        true routes to pobsFromUserId, false (the default) to work-places.
 * @returns {Promise<{ pobIds: string[], parentIds: string[], stores: Array<{id,parentId,storeName}>, totalElements: number|null, source: string }>}
 */
export function syncPobIds(page: object, userId: string, { enterpriseLevel, logger }?: {
    enterpriseLevel?: boolean;
}): Promise<{
    pobIds: string[];
    parentIds: string[];
    stores: Array<{
        id: any;
        parentId: any;
        storeName: any;
    }>;
    totalElements: number | null;
    source: string;
}>;
export const PAGE_SIZE: 20;
export const WORK_PLACES_PAGE_SIZE: 5;
export const PROJECTIONS: string[];
