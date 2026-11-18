/**
 * @param {object} ctx  a logged-in Delhivery API context (`loginDelhiveryApi`)
 * @param {string} awb
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeDelhiveryAwb(ctx: object, awb: string): Promise<{
    found: boolean;
    details: object | null;
}>;
