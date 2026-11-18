/**
 * Every article on the return this AWB belongs to.
 *
 * @param {object} page      a signed-in AJIO Puppeteer page
 * @param {object} input
 * @param {string} input.sellerId    the account's seller id
 * @param {string} input.pobid       the place of business the return is under
 * @param {string} input.returnAwb
 * @param {string} [input.accountType]  "VMS" orders which search is tried first
 * @param {object} [input.userLogger]
 *
 * @returns {Promise<{
 *   returnOrderId: string, orderId: string|null, articles: object[]
 * }>}
 *
 * @throws when the AWB resolves to no return under this POB — a real answer
 *   ("this AWB is not here"), and one the caller must show rather than turn
 *   into an empty list that reads like "this return has no articles".
 */
export function fetchReturnArticles(page: object, { sellerId, pobid, returnAwb, accountType, userLogger }: {
    sellerId: string;
    pobid: string;
    returnAwb: string;
    accountType?: string;
    userLogger?: object;
}): Promise<{
    returnOrderId: string;
    orderId: string | null;
    articles: object[];
}>;
/** One article on the return, flattened to what a person picking needs to see. */
export function toArticle(item: any): {
    sellerSku: string;
    sterlingSkuId: string;
    itemCode: string;
    eanCode: string;
    scanCode: string;
    productName: string;
    imageUrl: string;
    quantity: any;
    returnItemId: string;
};
/**
 * Which identifier to store as this article's SKU — null when it has none.
 *
 * AJIO DOES NOT ALWAYS RETURN A SELLER SKU. A real return
 * (R2454715693AJI/DV00332648) came back with `sellerSkuId` empty and the
 * article identified by `sterlingSkuId`, `itemCode`, `eanCode` and `scanCode`
 * only. Refusing to store those would leave that article unpickable and the
 * claim unfileable — while `selectReturnItem` matches a stored SKU against all
 * five, so any of them works perfectly well at claim time.
 *
 * PREFERENCE, then UNIQUENESS. Candidates are tried in the claim's own field
 * order, most specific first, and the first that identifies exactly ONE article
 * on this return wins. That second test is the one that matters: an EAN can be
 * shared across two lines of the same style, and `selectReturnItem` takes the
 * FIRST article a value matches — so storing a shared identifier would file the
 * claim against a sibling. When nothing is unique the article is still
 * storable, and `unique: false` says so rather than the picker quietly
 * pretending otherwise.
 *
 * @param {object} article    a flattened article
 * @param {object[]} articles every article on the return, for the uniqueness test
 * @returns {{value: string, field: string, unique: boolean}|null}
 */
export function storableSku(article: object, articles?: object[]): {
    value: string;
    field: string;
    unique: boolean;
} | null;
/**
 * The article a stored SKU refers to — null when none of them does.
 *
 * Answers "is the SKU on this claim actually one of the articles AJIO holds
 * against its AWB", which is the question a bulk review is asking of every row.
 * A `null` for a row that HAS a SKU is the interesting case: the claim names an
 * article that is not on the return, so filing it would either fail the gate in
 * `selectReturnItem` or, worse, hit a different return entirely.
 *
 * Matched exactly as the claim itself matches — all five identifiers, and the
 * punctuation-insensitive form — so this cannot call a SKU wrong that
 * `raiseClaim` would have accepted.
 */
export function findArticleBySku(articles: any, sku: any): any;
/**
 * Where a product picture might be.
 *
 * NOT VERIFIED. Every field the AJIO detail response is known to carry on
 * `product` — sellerSkuId, sterlingSkuId, itemCode, eanCode, scanCode,
 * productName — comes from a capture; an image is not among them. So this
 * probes the names such a field plausibly has and takes the first that looks
 * like a URL, and the picker is built to work WITHOUT one: a chooser that only
 * functioned when an unconfirmed field happened to exist would be a chooser
 * that usually did not function. If a capture ever names the real field, put it
 * first and delete the rest.
 */
export const IMAGE_FIELDS: string[];
export const STORABLE_FIELDS: {
    /** What the picker shows it as. */
    label: string;
    /** Where it lives on a flattened article. */
    key: any;
}[];
