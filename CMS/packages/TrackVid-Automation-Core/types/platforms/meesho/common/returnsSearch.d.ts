/**
 * Search this account's returns for a free-text query — an AWB, a sub-order
 * number or an order number.
 *
 * @param {object} ctx  `{ jar, supplierId, supplierIdentifier }`
 * @param {string} query
 * @param {{ pageSize?: number, step?: string }} [options]
 * @returns {Promise<{ found: boolean, row: object|null, rows: object[], raw: object }>}
 *   `row` is the STRICT match — the row that actually carries the value asked
 *   for. `text_global` is a search and can answer with neighbours, so `data[0]`
 *   is never the answer.
 */
export function searchReturns(ctx: object, query: string, { pageSize, step }?: {
    pageSize?: number;
    step?: string;
}): Promise<{
    found: boolean;
    row: object | null;
    rows: object[];
    raw: object;
}>;
/**
 * The same search, asked with more than one identifier — first answer wins.
 *
 * WHY A SECOND QUESTION IS WORTH ASKING. The AWB on a CMS row is not always the
 * AWB Meesho is holding. A return that was re-booked gets a new waybill and the
 * row keeps the old one; a row scanned off a packet can carry the forward leg's
 * number; some rows never had one at all. In every one of those cases the search
 * answers `data: []`, and "not found" reads as "this parcel is not on this
 * account" — which is wrong, and leads somewhere completely different from the
 * truth, which is "this parcel is here under another number".
 *
 * The sub-order number is the identifier Meesho actually keys on, and it does
 * not change. So when the AWB finds nothing, asking again by sub-order number
 * costs one request and turns a dead end into a hit — and the row that comes
 * back carries `awb`, which is the CURRENT waybill, straight from Meesho.
 *
 * ORDER MATTERS. The AWB is asked first, because it is the more specific of the
 * two and the one the operator is looking at. The sub-order number is the
 * fallback, not the default.
 *
 * Blanks and repeats are skipped rather than sent: `text_global` with an empty
 * string is a request that cannot match, and asking the same value twice is a
 * second round-trip for an answer already in hand.
 *
 * @param {object} ctx
 * @param {{ awb?: string, subOrderNumber?: string, orderNumber?: string }} identifiers
 * @param {{ pageSize?: number, step?: string, logger?: object }} [options]
 * @returns {Promise<{ found: boolean, row: object|null, rows: object[], raw: object|null,
 *                     matchedBy: string|null, query: string|null, tried: string[] }>}
 *   `matchedBy` names WHICH identifier answered — the caller needs it to say
 *   "found by sub-order number; the AWB on this row is stale".
 */
export function findReturn(ctx: object, identifiers: {
    awb?: string;
    subOrderNumber?: string;
    orderNumber?: string;
}, { pageSize, step, logger }?: {
    pageSize?: number;
    step?: string;
    logger?: object;
}): Promise<{
    found: boolean;
    row: object | null;
    rows: object[];
    raw: object | null;
    matchedBy: string | null;
    query: string | null;
    tried: string[];
}>;
/**
 * Fill in supplierId / supplierIdentifier when the session arrived without them.
 *
 * A stored session is cookies plus these two ids, and a session that has the
 * cookies but not the ids is repairable in one HTTP call — see
 * supplierIdentity.js. It used to be a dead end here: the probe threw "session
 * carries no supplier id/identifier", the run counted the account as
 * unreachable, and every AWB came back unmapped.
 */
export function ensureIdentity(ctx: any): Promise<void>;
export const ORIGIN: "https://supplier.meesho.com";
export const PATH: "/api/fulfillment/returnRto/fetchReturnClaims";
