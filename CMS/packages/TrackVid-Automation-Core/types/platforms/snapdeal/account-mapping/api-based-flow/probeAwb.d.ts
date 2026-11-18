/**
 * @param {object} ctx  a logged-in Snapdeal API context (`loginSnapdealApi`)
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeSnapdealAwb(ctx: object, awb: string): Promise<{
    found: boolean;
    details: object | null;
}>;
