/**
 * one row of `readRows`
 */
export type SheetInputRow = {
    id?: string;
    awb?: string;
    ron?: string;
    sku?: string;
    claimType?: string;
    pobid?: string;
    ticketNumber?: string;
};
/**
 * a sheet row that did not become a claim
 */
export type SheetRow = {
    awb: string;
    ron: string;
    sku: string;
    claimType: string;
    pobid: string;
    ticketNumber: string;
};
/**
 * the config `raiseClaim` takes
 */
export type SheetClaimEntry = {
    awbNumber: string;
    return_order_no: string;
    sku: string;
    pobid: string;
    claimType: string;
    emailTemplate: {
        subject: string;
        body: string;
    };
    typeOfClaim: string;
    subIssueType: string;
    imageUrl: string;
    sixSideImages: string[];
    temp_ticket: null;
    masterImportId: string;
    order_status: string;
};
export const AWB_FIELD: "return_order_AWB_no";
export const RON_FIELD: "return_order_no";
/** Which MasterImport field the sheet's identifier column matches. */
export function idFieldFor(byRon: any): "return_order_AWB_no" | "return_order_no";
/**
 * Flatten a company document's login groups into `username -> credential`.
 *
 * A company can hold SEVERAL AJIO accounts, and a return is claimable only by
 * the one that owns it — `masterImport.ajio_account_email` names which. Picking
 * "the company's AJIO login" would sign in as the wrong seller and the return
 * would not be found under its POB.
 */
export function buildLoginMap(company: any): Map<any, any>;
/**
 * @param {object} options
 * @param {Array}  options.rows     from `readRows` — { id, sku, claimType }
 * @param {Array}  options.records  MasterImport documents matching those ids
 * @param {(email: string, companyId: string) => object|null} options.findCredential
 *        The AJIO login for a record's `ajio_account_email`, or null if this
 *        machine has none. Whatever it returns becomes `group.credentials`, so
 *        a caller that resolves passwords later can return an id instead.
 *
 *        The company is passed as well as the email because the automation
 *        server runs across companies in one pass, and the same AJIO address
 *        can appear under two of them — matching on the address alone would
 *        sign in with the wrong company's stored password. The desktop app is
 *        single-company and ignores it.
 * @param {boolean} [options.byRon=false] the sheet was keyed by return order no
 * @param {"order-status"|"row"} [options.claimTypeSource="order-status"]
 *        Where NDR/DDR comes from. "order-status" derives it from the record and
 *        skips anything not at a claimable status — the automation server, which
 *        has no operator to ask. "row" takes the operator's choice and files it
 *        as asked, flagging (not overriding) a record whose status disagrees.
 * @param {(companyId: string) => string|undefined} [options.companyName]
 * @returns {{ groups: Array, buckets: object, companies: Array }}
 */
export function bucketRows({ rows, records, findCredential, byRon, claimTypeSource, companyName, }: {
    rows: any[];
    records: any[];
    findCredential: (email: string, companyId: string) => object | null;
    byRon?: boolean;
    claimTypeSource?: "order-status" | "row";
    companyName?: (companyId: string) => string | undefined;
}): {
    groups: any[];
    buckets: object;
    companies: any[];
};
/**
 * @typedef {object} SheetInputRow  one row of `readRows`
 * @property {string} [id]
 * @property {string} [awb]
 * @property {string} [ron]
 * @property {string} [sku]
 * @property {string} [claimType]
 * @property {string} [pobid]
 * @property {string} [ticketNumber]
 */
/**
 * @typedef {object} SheetRow  a sheet row that did not become a claim
 * @property {string} awb
 * @property {string} ron
 * @property {string} sku
 * @property {string} claimType
 * @property {string} pobid
 * @property {string} ticketNumber
 */
/**
 * @typedef {object} SheetClaimEntry  the config `raiseClaim` takes
 * @property {string} awbNumber
 * @property {string} return_order_no
 * @property {string} sku
 * @property {string} pobid
 * @property {string} claimType
 * @property {{ subject: string, body: string }} emailTemplate
 * @property {string} typeOfClaim
 * @property {string} subIssueType
 * @property {string} imageUrl
 * @property {string[]} sixSideImages
 * @property {null} temp_ticket
 * @property {string} masterImportId
 * @property {string} order_status
 */
/**
 * Claim entries built from the operator's sheet ALONE — no master data.
 *
 * For the desktop app, where the sheet is AJIO's own return report (or the
 * template shaped like it) and carries everything a claim needs:
 *   - the return            Return AWB, or Return Order No
 *   - the article           SKU / "Client SKU ID / EAN" (blank = the only article)
 *   - where it lives        POB ID
 *   - what to claim         the upload slot the file came in (NDR / DDR), which
 *                           also picks the email template, sub-issue and image
 *
 * What master data used to add is covered elsewhere: AJIO's own existing-ticket
 * check inside `raiseClaim` stops a duplicate, and the caller maps each POB to
 * the AJIO login that holds it. The server's `bucketRows` path is unchanged.
 *
 * Returns `entries` — the `raiseClaim` config shape, one per claimable row —
 * and `buckets`, the rows that could not become one and why.
 *
 * @param {SheetInputRow[]} rows from `readRows(path, { claimType })`
 * @returns {{ entries: SheetClaimEntry[], buckets: { alreadyClaimed: SheetRow[], missingPob: SheetRow[], unknownType: SheetRow[] } }}
 */
export function sheetClaimEntries(rows: SheetInputRow[]): {
    entries: SheetClaimEntry[];
    buckets: {
        alreadyClaimed: SheetRow[];
        missingPob: SheetRow[];
        unknownType: SheetRow[];
    };
};
/**
 * Split each account's claims into batches, keeping the account grouping so a
 * batch still signs in once. Chunking across accounts would mean a login per
 * batch instead of per account.
 */
export function toBatches(groups: any, size: any): any[];
export function emptyBuckets(): {
    claimable: any[];
    alreadyClaimed: any[];
    wrongStatus: any[];
    typeMismatch: any[];
    notFound: any[];
    noCredentials: any[];
    skuNotFound: any[];
    conflict: any[];
};
