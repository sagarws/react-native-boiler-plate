/**
 * @param {object} ctx  a logged-in Flipkart API context (`loginFlipkartApi`)
 * @param {string} awb  the tracking id on the CMS row
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeFlipkartAwb(ctx: object, awb: string): Promise<{
    found: boolean;
    details: object | null;
}>;
