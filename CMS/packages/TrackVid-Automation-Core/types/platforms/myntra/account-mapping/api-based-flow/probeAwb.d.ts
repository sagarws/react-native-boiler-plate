/**
 * @param {object} ctx  a Myntra API context — `{ jar }` from `loginMyntraApi`
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeMyntraAwb(ctx: object, awb: string): Promise<{
    found: boolean;
    details: object | null;
}>;
