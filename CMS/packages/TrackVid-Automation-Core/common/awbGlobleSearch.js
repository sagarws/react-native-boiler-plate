/**
 * "Which account holds this AWB?" — the marketplace endpoints that answer it,
 * and the shapes they answer in.
 *
 * Two platforms expose a search that takes an AWB and returns the return it
 * belongs to. They do the same job, are scoped the same way — to the supplier
 * the session belongs to, so a non-empty result IS the answer — and are read by
 * the same account-mapping run. What they do not share is a single field name.
 *
 * So the CAPTURED CONTRACT lives here, in one file, rather than as field names
 * scattered through two probes. Both were verified against real responses; the
 * captures are quoted below because the next person to touch this will be doing
 * so precisely because a field moved, and a shape nobody wrote down is one
 * nobody can check a change against.
 *
 * ─── Meesho ──────────────────────────────────────────────────────────────────
 * POST https://supplier.meesho.com/api/fulfillment/returnRto/fetchReturnClaims
 *   headers  identifier, client-type: d-web, client-package-version, cookie
 *   body     { screenType: "returns", size, page_pointer, cursor, filter_cursor,
 *              filters: { shipment_status: "search_return_rto", text_global: AWB },
 *              supplier_details: { identifier, id }, identifier,
 *              child_supplier_identifier: null, child_supplier_id: null }
 *
 *   { "cursor": "…", "count": { … }, "total_pages": 1,
 *     "data": [ {
 *       "order_num": "326241959666635776",
 *       "sub_order_num": "326241959666635776_1",
 *       "type": "RTO", "shipment_status": "In Transit",
 *       "carrier_name": "Valmo", "awb": "VL0085289175482",
 *       "product": { "name": "…", "sku": "subhi5667fanta", "meesho_pid": "8F7I1F4H5",
 *                    "quantity": 1, "variation": "Free Size", "category": "Sarees",
 *                    "image_urls": [ "…" ] } } ] }
 *
 * ─── Snapdeal ────────────────────────────────────────────────────────────────
 * GET https://seller.snapdeal.com/returns/globalSearch
 *       ?searchTerm=<AWB>&searchType=AWBNUMBER
 *   headers  x-requested-with: XMLHttpRequest, cookie
 *
 *   { "returnType": {
 *       "delivered": [ "Courier_Return" ], "status": { … },
 *       "returnsList": [ {
 *         "name": "VT NX Women …", "supc": "SDL797402349", "sku": "9034-Lemon-XL",
 *         "subOrderId": "74234371173", "awbNumber": "SF3919427089SDM",
 *         "statusOfItem": "DELIVERED", "courier": "Shadowfax",
 *         "sdReferenceNumber": "SLP5101875478", "sellingPrice": 799.0,
 *         "caseId": null, "zendeskTicketId": null } ] } }
 *
 * NOTE the spelling — `returnsList`, plural "returns" — and that the rows sit
 * TWO levels down. Both have been got wrong before.
 */

const { platformKey } = require("./platforms.js");

const text = (value) => (typeof value === "string" ? value.trim() : "");

/** Trimmed, case-insensitive. An empty value never matches. */
const same = (a, b) => {
    const x = text(a).toLowerCase();
    const y = text(b).toLowerCase();

    return !!x && x === y;
};

/**
 * Where each platform keeps its rows, what identifies one, and what a hit says.
 *
 * `matchOn` is a LIST for Meesho because its search is `text_global` — a free
 * text query matched against several fields, so an operator scanning a packet
 * can end up with any of the three in the AWB column. Snapdeal's search is
 * typed (`searchType=AWBNUMBER`), so only the AWB can have been the query.
 */
const SEARCH_SHAPES = {
    meesho: {
        rows: (body) => (Array.isArray(body?.data) ? body.data : []),
        matchOn: ["awb", "sub_order_num", "order_num"],
        read: (row) => ({
            // The identifier every other Meesho automation is keyed on, and the
            // one an unmapped claim is missing.
            subOrderNumber: text(row?.sub_order_num) || null,
            orderNumber: text(row?.order_num) || null,
            awbNumber: text(row?.awb) || null,
            sellerSku: text(row?.product?.sku) || null,
            productName: text(row?.product?.name) || null,
            status: text(row?.shipment_status) || null,
            returnType: text(row?.type) || null,
            carrier: text(row?.carrier_name) || null,
        }),
    },
    snapdeal: {
        // Two levels down, under a key spelled `returnsList`. The older
        // speculative paths are kept because unmigrated builds have answered
        // with them; only the first is confirmed.
        rows: (body) =>
            [body?.returnType?.returnsList, body?.returnsList, body?.data?.returnsList].find(
                Array.isArray
            ) || [],
        matchOn: ["awbNumber"],
        read: (row) => ({
            // Snapdeal calls it `subOrderId`. The claim flow derives its own at
            // filing time, so this is not a precondition the way Meesho's is —
            // it is stored because the search already answered with it.
            subOrderNumber: text(row?.subOrderId) || null,
            awbNumber: text(row?.awbNumber) || null,
            sellerSku: text(row?.sku) || null,
            supc: text(row?.supc) || null,
            productName: text(row?.name) || null,
            status: text(row?.statusOfItem) || null,
            courier: text(row?.courier) || null,
            reference: text(row?.sdReferenceNumber) || null,
            // Present when a dispute already exists — worth carrying out,
            // because the claim runner would otherwise rediscover it.
            disputeId: text(row?.disputeId || row?.caseId || row?.ticketId) || null,
        }),
    },
};

/** The platforms with an AWB search, lowercase. */
const SEARCHABLE_PLATFORMS = Object.keys(SEARCH_SHAPES);

const shapeFor = (platform) => SEARCH_SHAPES[platformKey(platform)] || null;

/** Every row in a response body, whatever the platform buries them under. */
function searchRows(platform, body) {
    const shape = shapeFor(platform);

    return shape ? shape.rows(body) : [];
}

/**
 * The row this query was actually about — null when none of them was.
 *
 * Never `rows[0]`. These are SEARCHES: they can answer with neighbours, and
 * taking the first would map a claim against whichever sorted first.
 */
function matchingRow(platform, rows, query) {
    const shape = shapeFor(platform);

    if (!shape) return null;

    return (
        (rows || []).find((row) => shape.matchOn.some((field) => same(row?.[field], query))) || null
    );
}

/** One row, flattened to the fields a mapping run stores or shows. */
function readSearchRow(platform, row) {
    const shape = shapeFor(platform);

    return shape && row ? shape.read(row) : null;
}

/**
 * Body → the matching row, already flattened. Null when nothing matched.
 *
 * The whole read in one call, so a probe holds no field names of its own.
 */
function findSearchRow(platform, body, query) {
    const row = matchingRow(platform, searchRows(platform, body), query);

    return row ? { ...readSearchRow(platform, row), raw: row } : null;
}

module.exports = {
    SEARCH_SHAPES,
    SEARCHABLE_PLATFORMS,
    searchRows,
    matchingRow,
    readSearchRow,
    findSearchRow,
};
