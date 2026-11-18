/**
 * The seller account a claim should be filed from, or null.
 *
 * `null` is a real answer, not a failure: Nykaa carries no per-row account —
 * the server falls back to the company's single verified Nykaa login — so a
 * caller that gets null should look the account up by platform rather than
 * treat the claim as broken.
 *
 * @param {string} platform  platform key, any casing
 * @param {object} doc       the claim document from /cms/find-by-awb
 * @returns {string|null}
 */
export function claimAccountUsername(platform: string, doc: object): string | null;
/** Platforms with no per-row account — resolve by company login instead. */
export function usesCompanyWideAccount(platform: any): boolean;
export namespace ACCOUNT_FIELDS {
    let ajio: string[];
    let meesho: string[];
    let snapdeal: string[];
    let myntra: string[];
    let nykaa: string[];
    let flipkart: string[];
    let delhivery: string[];
    let xbees: string[];
    let tatacliq: string[];
    let amazon: string[];
}
