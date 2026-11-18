/**
 * Sorts the operator's rows into "will be claimed" and "will not, and here is
 * why" — and builds the claim config for the ones that will.
 *
 * PURE. No database, no network, no environment. The caller supplies the
 * MasterImport records and a way to look up a credential, because the two
 * runners get those from different places and neither can be assumed here:
 *
 *   Automated-Scripts  reads Mongo directly
 *   Trackvid-CMS       asks TrackVid-BE, and resolves the password locally
 *                      from its own copy of the company document
 *
 * That split is the whole reason this is a separate module: the sorting rules
 * are identical in both runners and must never be written twice, but the way
 * the data arrives is not shareable at all.
 */

const {
    CLAIMABLE_STATUSES,
    contentForClaimType,
    contentForOrderStatus,
    claimTypeForOrderStatus,
    isTypeMismatch,
} = require("./bulkSpfTemplates");

const AWB_FIELD = "return_order_AWB_no";
const RON_FIELD = "return_order_no";

/** Which MasterImport field the sheet's identifier column matches. */
const idFieldFor = (byRon) => (byRon ? RON_FIELD : AWB_FIELD);

/**
 * Flatten a company document's login groups into `username -> credential`.
 *
 * A company can hold SEVERAL AJIO accounts, and a return is claimable only by
 * the one that owns it — `masterImport.ajio_account_email` names which. Picking
 * "the company's AJIO login" would sign in as the wrong seller and the return
 * would not be found under its POB.
 */
function buildLoginMap(company) {
    const map = new Map();

    for (const group of company?.settings?.eCommercePlatformLoginInfo || []) {
        for (const info of group?.info || []) {
            if (!info?.username) continue;

            map.set(String(info.username).trim().toLowerCase(), {
                username: info.username,
                password: info.password,
                accountType: info.accountType,
                _id: info._id,
            });
        }
    }

    return map;
}

const emptyBuckets = () => ({
    claimable: [],
    alreadyClaimed: [],
    wrongStatus: [],
    typeMismatch: [],
    notFound: [],
    noCredentials: [],
    skuNotFound: [],
    conflict: [],
});

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
function bucketRows({
    rows,
    records,
    findCredential,
    byRon = false,
    claimTypeSource = "order-status",
    companyName = () => undefined,
}) {
    const idField = idFieldFor(byRon);
    const buckets = emptyBuckets();
    const groupsByAccount = new Map();
    const companyCounts = new Map();

    // One identifier can map to SEVERAL records: a single return may contain
    // several articles, each its own MasterImport row and each its own claim.
    const recordsById = new Map();

    for (const record of records || []) {
        const key = String(record[idField] || "").trim();

        if (!key) continue;
        if (!recordsById.has(key)) recordsById.set(key, []);

        recordsById.get(key).push(record);
    }

    // The same identifier under more than one company is ambiguous, and guessing
    // would file another company's claim from this company's account.
    const conflicted = new Set();

    for (const [key, group] of recordsById) {
        if (new Set(group.map((record) => String(record.companyId))).size > 1) conflicted.add(key);
    }

    // An article already targeted by an earlier row is not claimed twice, even
    // if a later row names it again.
    const seenRecords = new Set();

    for (const row of rows || []) {
        const key = String(row.id).trim();
        const wantedSku = String(row.sku || "").trim();

        if (conflicted.has(key)) {
            const first = (recordsById.get(key) || [])[0];

            buckets.conflict.push({
                awb: row.id,
                sku: wantedSku,
                claimType: row.claimType || "",
                masterImportId: "",
                orderStatus: first?.order_status,
            });

            continue;
        }

        const all = recordsById.get(key);

        if (!all || !all.length) {
            buckets.notFound.push({ awb: row.id, sku: wantedSku, claimType: row.claimType || "", masterImportId: "" });

            continue;
        }

        // A SKU narrows the row to one article; no SKU takes every article.
        const matched = wantedSku
            ? all.filter((record) => String(record.order_seller_SKU || "").trim() === wantedSku)
            : all;

        if (wantedSku && !matched.length) {
            buckets.skuNotFound.push({ awb: row.id, sku: wantedSku, claimType: row.claimType || "", masterImportId: "" });

            continue;
        }

        for (const record of matched) {
            const sku = record.order_seller_SKU || "";
            const masterImportId = String(record._id);

            if (seenRecords.has(masterImportId)) continue;

            seenRecords.add(masterImportId);

            const base = {
                awb: row.id,
                sku,
                masterImportId,
                orderStatus: record.order_status,
                claimType: "",
            };

            // Already has a ticket: this is what makes a re-run of the same file
            // safe — it claims only what is left.
            if (record.ticketNumber) {
                buckets.alreadyClaimed.push({ ...base, ticketNumber: record.ticketNumber });

                continue;
            }

            const fromRow = claimTypeSource === "row";
            const claimType = fromRow ? String(row.claimType || "").trim().toUpperCase() : claimTypeForOrderStatus(record.order_status);
            const content = fromRow ? contentForClaimType(claimType) : contentForOrderStatus(record.order_status);

            base.claimType = claimType || "";

            if (!content) {
                buckets.wrongStatus.push(base);

                continue;
            }

            // Server path only: a record at some other status is not claimable
            // and there is nobody to ask.
            if (!fromRow && !CLAIMABLE_STATUSES.includes(record.order_status)) {
                buckets.wrongStatus.push(base);

                continue;
            }

            // Operator path: file what was asked, but say so when the record's
            // own status implies the other claim type. Unflagged, this is a
            // ticket raised under the wrong sub-type — and AJIO has no way back
            // from that except a duplicate.
            if (fromRow && isTypeMismatch(claimType, record.order_status)) {
                buckets.typeMismatch.push(base);

                continue;
            }

            const companyId = String(record.companyId);
            const accountEmail = String(record.ajio_account_email || "").trim().toLowerCase();
            const credentials = findCredential(accountEmail, companyId);

            if (!credentials) {
                buckets.noCredentials.push({
                    ...base,
                    account: record.ajio_account_email,
                    company: companyName(companyId),
                });

                continue;
            }

            // The shape `raiseClaim` expects — the same one the BE builds for a
            // single claim, assembled here instead.
            const configEntry = {
                awbNumber: record[AWB_FIELD] || record.return_order_no || "",
                masterImportId: record._id,
                sku,
                sixSideImages: [],
                claimType,
                emailTemplate: content.emailTemplate,
                typeOfClaim: content.typeOfClaim,
                subIssueType: content.subIssueType,
                imageUrl: content.imageUrl,
                temp_ticket: null,
                pobid: record.POB_ID || "",
                order_no: record.order_no,
                return_order_no: record.return_order_no,
                forwardAWB: record.order_FWD_AWB_no,
                order_seller_SKU: sku,
                return_order_reason: record.return_order_reason,
                order_status: record.order_status,
            };

            const groupKey = `${companyId}::${accountEmail}`;

            if (!groupsByAccount.has(groupKey)) {
                groupsByAccount.set(groupKey, {
                    credentials,
                    companyId,
                    companyName: companyName(companyId),
                    accountEmail,
                    configArr: [],
                });
            }

            groupsByAccount.get(groupKey).configArr.push(configEntry);

            if (!companyCounts.has(companyId)) {
                companyCounts.set(companyId, { companyId, name: companyName(companyId), claimable: 0 });
            }

            companyCounts.get(companyId).claimable++;

            buckets.claimable.push({
                ...base,
                account: record.ajio_account_email,
                company: companyName(companyId),
            });
        }
    }

    return {
        groups: Array.from(groupsByAccount.values()),
        buckets,
        companies: Array.from(companyCounts.values()),
    };
}

/**
 * Split each account's claims into batches, keeping the account grouping so a
 * batch still signs in once. Chunking across accounts would mean a login per
 * batch instead of per account.
 */
function toBatches(groups, size) {
    const batches = [];

    for (const group of groups) {
        for (let i = 0; i < group.configArr.length; i += size) {
            batches.push({ ...group, configArr: group.configArr.slice(i, i + size) });
        }
    }

    return batches;
}

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
function sheetClaimEntries(rows) {
    const entries = [];
    const buckets = { alreadyClaimed: [], missingPob: [], unknownType: [] };

    for (const row of rows || []) {
        const base = {
            // The real return AWB when the sheet has one — AJIO's own report
            // carries both it and the RT Number. When the sheet is keyed by
            // return order number alone there is no AWB, and the order number
            // stands in so every row still keeps a distinct report key.
            // Either way `raiseClaim` skips the AWB search, because
            // `return_order_no` below is what resolves the return.
            awb: row.awb || row.id || "",
            ron: row.ron || "",
            sku: String(row.sku || "").trim(),
            claimType: String(row.claimType || "").trim().toUpperCase(),
            pobid: String(row.pobid || "").trim(),
            ticketNumber: String(row.ticketNumber || "").trim(),
        };

        // The report says a ticket already exists. Filing again is at best a
        // wasted AJIO round-trip and at worst a second ticket for the same return.
        if (base.ticketNumber) {
            buckets.alreadyClaimed.push(base);
            continue;
        }

        // Every AJIO return lookup is scoped to a POB; without one there is
        // nothing to search under.
        if (!base.pobid) {
            buckets.missingPob.push(base);
            continue;
        }

        const content = contentForClaimType(base.claimType);

        if (!content) {
            buckets.unknownType.push(base);
            continue;
        }

        entries.push({
            awbNumber: base.awb,
            // Present when the sheet is keyed by Return Order No: lets the claim
            // skip AJIO's AWB search (see bulkSpfRunner.claimOneArticle).
            return_order_no: base.ron,
            sku: base.sku,
            pobid: base.pobid,
            claimType: content.claimType,
            emailTemplate: content.emailTemplate,
            typeOfClaim: content.typeOfClaim,
            subIssueType: content.subIssueType,
            imageUrl: content.imageUrl,
            sixSideImages: [],
            temp_ticket: null,
            // No record behind the row — kept as empty strings so result rows and
            // reports keep their shape.
            masterImportId: "",
            order_status: "",
        });
    }

    return { entries, buckets };
}

module.exports = { AWB_FIELD, RON_FIELD, idFieldFor, buildLoginMap, bucketRows, sheetClaimEntries, toBatches, emptyBuckets };
