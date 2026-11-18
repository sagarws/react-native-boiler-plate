export const ORIGIN: "https://supplier.meesho.com";
export const IDENTITY_UA: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
export const SUPPLY_DATA_PATH: "/api/container/supplier/prefetch-supply-data";
/**
 * Evaluated INSIDE a signed-in page — Puppeteer's login and the desktop app's
 * capture both run this, so "what a session is" has one definition.
 *
 * Resolves to `{ supplierId, supplierIdentifier }` or `{ error }`.
 *
 * A string because Trackvid-CMS has no Puppeteer: it evaluates this with
 * webContents.executeJavaScript. Self-contained for the same reason — it cannot
 * close over anything in this module.
 */
export const IDENTITY_PAGE_SCRIPT: string;
/**
 * The same question over plain HTTP, for a stored session that carries cookies
 * and nothing else. Repairs it without opening a browser — which is the whole
 * point: a session whose cookies still work should never cost a sign-in.
 *
 * Headers are built here, exactly as the portal sends them, rather than taken
 * from the caller: this endpoint's are different from every other call's, and
 * the one time they were shared it cost a sign-in per account.
 *
 * @param {{ jar: Record<string,string>, supplierIdentifier?: string|null }} record
 * @param {{ timeout?: number, userAgent?: string }} [options]
 * @returns {Promise<{ supplierId: number|null, supplierIdentifier: string|null }>}
 */
export function fetchSupplierIdentity(record: {
    jar: Record<string, string>;
    supplierIdentifier?: string | null;
}, { timeout, userAgent }?: {
    timeout?: number;
    userAgent?: string;
}): Promise<{
    supplierId: number | null;
    supplierIdentifier: string | null;
}>;
/**
 * Pull { supplierId, supplierIdentifier } out of a prefetch-supply-data body.
 * Prefers the `supplier` block and falls back to the token's mapping, which is
 * what answers when the request was made without a known slug.
 * @returns {{ supplierId: number|null, supplierIdentifier: string|null }}
 */
export function identityFromSupplyData(body: any, preferredIdentifier?: any): {
    supplierId: number | null;
    supplierIdentifier: string | null;
};
/**
 * The supplier's ids as the session's OWN cookies carry them — no network.
 *
 * The portal sets `current_az_identifier` (the slug, e.g. "dg97w") and `s_id`
 * (the numeric id, e.g. 3438) on every signed-in browser, and a captured jar
 * keeps them. A stored session that lost its `supplierIdentifier` was stuck
 * without this: the identity endpoint below REFUSES a request with no
 * identifier (HTTP 403 "Identifier not present or invalid"), so it could not
 * repair itself, and every call keyed on the identifier — opening a ticket —
 * answered HTTP 204 with nothing in it (observed 2026-10-30).
 *
 * @param {Record<string, string>|Array<{name: string, value: string}>} jar
 * @returns {{ supplierId: number|null, supplierIdentifier: string|null }}
 */
export function identityFromCookies(jar: Record<string, string> | Array<{
    name: string;
    value: string;
}>): {
    supplierId: number | null;
    supplierIdentifier: string | null;
};
/**
 * The slug out of a panel URL: https://supplier.meesho.com/panel/v3/new/<module>/<slug>/…
 * The SPA redirects to one of these after login, so it is a free second source.
 * @param {string} url
 * @returns {string|null}
 */
export function identifierFromUrl(url: string): string | null;
