/**
 * @param {object} ctx  a logged-in Xbees API context (`loginXbeesApi`)
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeXbeesAwb(ctx: object, awb: string): Promise<{
    found: boolean;
    details: object | null;
}>;
