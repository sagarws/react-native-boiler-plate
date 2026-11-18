/**
 * @param {object} ctx  a Meesho API context — `{ jar, supplierId, supplierIdentifier }`
 * @param {string} awb
 * @param {string[]} [alternates]  other identifiers for the SAME return — a
 *   sub-order number, an order number — tried only when the AWB finds nothing.
 *
 *   Worth trying because a miss here is not only "not this account": a row whose
 *   AWB has gone stale misses on EVERY account, and the sweep then reports it as
 *   belonging to nobody. That reads as a data problem with the accounts when it
 *   is a data problem with the one number being asked about — and the sub-order
 *   number, which Meesho keys on and never changes, answers it.
 *
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
export function probeMeeshoApiAwb(ctx: object, awb: string, alternates?: string[]): Promise<{
    found: boolean;
    details: object | null;
}>;
import { ORIGIN } from "../../common/returnsSearch.js";
import { PATH } from "../../common/returnsSearch.js";
export { ORIGIN, PATH };
