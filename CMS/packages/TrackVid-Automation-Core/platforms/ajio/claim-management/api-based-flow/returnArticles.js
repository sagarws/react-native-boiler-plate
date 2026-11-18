/**
 * The articles AJIO holds against a return AWB.
 *
 * A CMS row needs a seller SKU before it can be claimed: `raiseClaim` gates on
 * it (`selectReturnItem` refuses to pick an article when the return has several
 * and no SKU was given, because guessing files the claim against the wrong
 * item). Master data supplies it when master data has the row — and the rows
 * this exists for are the ones it does not.
 *
 * AJIO knows. The return-order detail carries every article on the return, each
 * with its own SKUs, product name and quantity, so the answer is two calls away
 * — the same two the claim flow itself opens with, reused here rather than
 * copied:
 *
 *   1. `resolveReturnOrderId`  return AWB  → returnOrderId   (vision or VMS)
 *   2. `getReturnOrderDetail`  returnOrderId → returnOrderItems[]
 *
 * This is a READ. It writes nothing, raises nothing and is safe to call on a
 * row an operator is merely looking at — which is what it is for: a picker,
 * where a person chooses the right article rather than an automation guessing.
 */

const {
    SKU_MATCH_FIELDS,
    getPobRecord,
    resolveReturnOrderId,
    getReturnOrderDetail,
} = require("./updatedClaimApiFlow");

/** Same default window and env override as the claim flow's own search. */
const SEARCH_WINDOW_DAYS = Number(process.env.CLAIM_SEARCH_WINDOW_DAYS) || 365;

const ymd = (date) => date.toISOString().slice(0, 10);

const text = (value) => (typeof value === "string" ? value.trim() : "");

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
const IMAGE_FIELDS = [
    "imageUrl", "imageURL", "image", "imageLink", "productImage",
    "productImageUrl", "thumbnailUrl", "thumbnail", "smallImage",
];

function imageOf(source) {
    for (const field of IMAGE_FIELDS) {
        const value = text(source?.[field]);

        if (/^https?:\/\//i.test(value)) return value;
    }

    return null;
}

/**
 * The article field each of the claim's match fields is flattened onto.
 *
 * `sellerSkuId` is renamed to `sellerSku` because that is the CMS row's own
 * field name; the rest keep AJIO's spelling. Built FROM `SKU_MATCH_FIELDS` so
 * the picker can only ever offer identifiers the claim will accept — a second
 * hand-written list is how the two drift apart and a stored SKU stops matching.
 */
const FIELD_ALIAS = { sellerSkuId: "sellerSku" };
const STORABLE_FIELDS = SKU_MATCH_FIELDS.map((field) => ({
    /** What the picker shows it as. */
    label: field,
    /** Where it lives on a flattened article. */
    key: FIELD_ALIAS[field] || field,
}));

/** How `selectReturnItem` compares — punctuation-insensitive, which is the widest match. */
const loose = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

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
function storableSku(article, articles = []) {
    const siblings = articles.filter((other) => other !== article);
    let fallback = null;

    for (const { label, key } of STORABLE_FIELDS) {
        const value = text(article?.[key]);

        if (!value) continue;

        const target = loose(value);
        const clashes = siblings.some((other) =>
            STORABLE_FIELDS.some(({ key: otherKey }) => {
                const otherValue = loose(other?.[otherKey]);

                return otherValue && otherValue === target;
            })
        );

        if (!clashes) return { value, field: label, unique: true };

        // Kept in case NOTHING on this article is unique — then the articles are
        // indistinguishable by identifier and any of them is as good a guess as
        // the operator can make.
        if (!fallback) fallback = { value, field: label, unique: false };
    }

    return fallback;
}

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
function findArticleBySku(articles, sku) {
    const target = loose(sku);

    if (!target) return null;

    return (
        (articles || []).find((article) =>
            STORABLE_FIELDS.some(({ key }) => {
                const value = loose(article?.[key]);

                return value && value === target;
            })
        ) || null
    );
}

/** One article on the return, flattened to what a person picking needs to see. */
function toArticle(item) {
    const product = item?.product || {};

    return {
        // The identifier the CMS row stores as `seller_sku`, and the first of
        // the five the claim flow matches on.
        sellerSku: text(product.sellerSkuId),
        // The other four, because AJIO returns the seller's own SKU on a
        // different one depending on the account — a picker showing only
        // sellerSkuId shows a blank row for those.
        sterlingSkuId: text(product.sterlingSkuId),
        itemCode: text(product.itemCode),
        eanCode: text(product.eanCode),
        scanCode: text(product.scanCode),
        productName: text(product.productName),
        imageUrl: imageOf(product) || imageOf(item),
        quantity: typeof item?.returnQuantity === "number" ? item.returnQuantity : null,
        returnItemId: text(item?.returnItemId),
    };
}

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
async function fetchReturnArticles(page, { sellerId, pobid, returnAwb, accountType, userLogger }) {
    const awb = text(returnAwb);
    const pob = text(pobid);

    if (!awb) throw new Error("fetchReturnArticles: returnAwb is required");
    if (!pob) throw new Error("fetchReturnArticles: pobid is required");

    const to = new Date();
    const from = new Date(to.getTime() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const record = await getPobRecord(page, sellerId, pob, { userLogger });
    // accountType only decides which endpoint is tried FIRST; resolveReturnOrderId
    // falls back to the other on a clean miss, so a POB served by the endpoint
    // the account is not tagged for still resolves.
    const preferVMS = accountType
        ? String(accountType).toUpperCase() === "VMS"
        : String(record.integrationType || "").toUpperCase().startsWith("VMS");

    const misses = [];
    const returnOrderId = await resolveReturnOrderId(page, {
        pobid: pob,
        returnAwb: awb,
        from: ymd(from),
        to: ymd(to),
        preferVMS,
        userLogger,
        misses,
    });

    if (!returnOrderId) {
        throw new Error(
            `No return found for AWB ${awb} under POB ${pob}` +
            (misses.length ? ` — ${misses.join("; ")}` : "")
        );
    }

    const detail = await getReturnOrderDetail(page, {
        returnOrderId,
        pobid: pob,
        integrationType: record.integrationType,
        userLogger,
    });

    const articles = (detail.returnOrderItems || []).map(toArticle);

    // Resolved once, here, so every consumer picks the same identifier — and so
    // the uniqueness test can see the whole return rather than one line of it.
    for (const article of articles) article.storable = storableSku(article, articles);

    userLogger?.info?.(
        `🧾 AJIO: ${awb} → return order ${returnOrderId}, ${articles.length} article(s)`
    );

    return {
        returnOrderId: text(detail.returnOrderId) || returnOrderId,
        orderId: text(detail.orderId) || null,
        articles,
    };
}

module.exports = {
    fetchReturnArticles,
    toArticle,
    storableSku,
    findArticleBySku,
    IMAGE_FIELDS,
    STORABLE_FIELDS,
};
