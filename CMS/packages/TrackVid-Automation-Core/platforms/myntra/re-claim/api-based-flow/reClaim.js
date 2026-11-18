/**
 * Myntra re-claim — disputing a claim Myntra has already decided.
 *
 * A rejected SPF claim is not the end of it: the partner portal lets a seller
 * reopen one with an argument and the same proofs, and Myntra re-validates.
 * `createFwTicket` is that reopen. It is a DIFFERENT call from the one that
 * raises a claim in the first place, and it works on a ticket that exists.
 *
 * WHAT THE SPREADSHEET CANNOT SUPPLY. A row carries the ticket, the argument
 * for reopening it and optionally a category — and the dispute needs the order,
 * the return, the tracking id, the SKU, the style and the proof URLs, none of
 * which are in it. Those are read back from Myntra by ticket id, which is also
 * the only way to be sure they still match what Myntra holds. So a row from the
 * sheet is an INSTRUCTION, not a payload: fetch, build, dispute, re-fetch.
 *
 * Verified against real request/response captures (2026-09-10).
 */

const axios = require("axios");
const { authError } = require("../../../../common/apiError");
const { logApiFailure } = require("../../../../common/apiResponseLogger");

const API_BASE = "https://partnersapi.myntrainfo.com";
const REQ_TIMEOUT_MS = Number(process.env.MYNTRA_API_TIMEOUT_MS || 60000);

const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/**
 * The columns this flow READS. Three, of the fourteen a Myntra rejection export
 * carries — the rest are the operator's to look at and are passed through on
 * `raw` untouched.
 *
 *   ticketId      which ticket to reopen. Nothing can be done without it.
 *   RR Remarks    the argument for reopening THIS ticket, sent as the dispute's
 *                 `description`. Myntra refuses a dispute without one.
 *   issueCategory optional. Overrides the category the ticket already has, for
 *                 an operator deliberately re-filing under a different one;
 *                 blank keeps Myntra's own.
 *
 * Narrowed from the full export on purpose. A column this flow does not use is
 * a column an operator can be asked to fill in wrongly, and the template is
 * generated from this list — so the sheet asks for exactly what is read.
 */
const SHEET_COLUMNS = ["ticketId", "RR Remarks", "issueCategory"];

/**
 * The two a row is useless without. `issueCategory` is deliberately absent —
 * it has a working fallback, and demanding it would make the operator name a
 * category Myntra already knows.
 */
const REQUIRED_SHEET_COLUMNS = ["ticketId", "RR Remarks"];

/** The sheet column the dispute's `description` comes from. */
const DESCRIPTION_COLUMN = "RR Remarks";

/**
 * Writes a blank rejection export — the sheet `readReClaimSheet` reads.
 *
 * Built from SHEET_COLUMNS rather than its own list, so the template an operator
 * downloads and the columns the parser looks for cannot drift apart. That
 * matters more here than for most templates: a header this code does not
 * recognise is not rejected, it is carried through as one of the operator's own
 * columns — so a typo in a hand-written template looks like a thin row rather
 * than a mistake in the file.
 *
 * Only `ticketId` is load-bearing; every other column is what Myntra's own
 * export carries, and is shown back to the operator as it comes.
 *
 * @param {string} outputPath
 * @returns {string} outputPath
 */
function writeReClaimTemplate(outputPath) {
    const XLSX = require("xlsx");

    const sheet = XLSX.utils.aoa_to_sheet([SHEET_COLUMNS]);

    // The remarks column holds a paragraph, not a value. At the same width as
    // the others it reads as a truncated cell and invites a one-line answer.
    sheet["!cols"] = SHEET_COLUMNS.map((column) => ({
        wch: column === DESCRIPTION_COLUMN ? 70 : Math.max(18, column.length + 6),
    }));

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, sheet, "Rejections");
    XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });

    return outputPath;
}

const text = (value) => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();

    return String(value).trim();
};

const cookieHeader = (jar) =>
    Object.entries(jar || {})
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");

/** The portal's own headers. `x-myntra-app-name` is what routes the request. */
const headers = (jar) => ({
    accept: "application/json",
    "accept-language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
    "content-type": "application/json",
    origin: "https://partners.myntrainfo.com",
    referer: "https://partners.myntrainfo.com/",
    "user-agent": UA,
    "x-myntra-app-name": "partners",
    "x-requested-with": "XMLHttpRequest",
    cookie: cookieHeader(jar),
});

/**
 * Reads a rejection export.
 *
 * Header names are matched loosely — case, spaces and underscores are ignored —
 * because this sheet is exported, re-saved and edited by hand before it gets
 * here, and refusing "Ticket Id" for not being "ticketId" would reject the file
 * for a difference nobody can see.
 *
 * Every row keeps its ORIGINAL cells alongside the normalised ones: the table
 * shows the operator their own sheet, and a column this code does not know
 * about is still theirs to read.
 */
function readReClaimSheet(inputPath) {
    const XLSX = require("xlsx");

    const book = XLSX.readFile(inputPath, { cellDates: true });
    const sheetName = book.SheetNames[0];

    if (!sheetName) throw new Error("The workbook has no sheets");

    const raw = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: null, raw: false });

    const loose = (name) => String(name).toLowerCase().replace(/[\s_]+/g, "");
    const wanted = new Map(SHEET_COLUMNS.map((column) => [loose(column), column]));

    const rows = raw.map((entry, index) => {
        const normalised = {};

        for (const [key, value] of Object.entries(entry)) {
            const column = wanted.get(loose(key));

            if (column) normalised[column] = text(value);
        }

        return {
            // 1-based and counting the header, so it matches what the operator
            // sees in the spreadsheet's own row numbers.
            rowNumber: index + 2,
            ticketId: normalised.ticketId || "",
            issueCategory: normalised.issueCategory || "",
            ...normalised,
            // Under a name a caller can read. The column is "RR Remarks"
            // because that is the header of Myntra's own export; what it holds
            // here is the argument sent with the dispute.
            description: normalised[DESCRIPTION_COLUMN] || "",
            // Their sheet, verbatim — including columns this does not know.
            raw: entry,
        };
    });

    const missing = SHEET_COLUMNS.filter(
        (column) => !raw.some((entry) => Object.keys(entry).some((key) => loose(key) === loose(column)))
    );

    return { rows, missing };
}

/**
 * The reason a DISPUTE is filed under. Always this.
 *
 * Not the claim's own return reason — that is the customer's ("Found a better
 * price on Myntra") and stays on the ticket untouched. This is the reason for
 * REOPENING it, and Myntra's portal sends "Others" for every one: the capture's
 * own response echoes it back as `ticketDisputedReturnReason: "Others"` beside
 * a claim whose `returnReason` is something else entirely.
 *
 * Fixed rather than defaulted, deliberately. A caller that could pass its own
 * would be a caller that could send a value the portal never sends, and the
 * only way to find out that Myntra minds is to spend a seller's one reopen
 * discovering it.
 */
const DISPUTE_RETURN_REASON = "Others";

/**
 * The dispute payload for a ticket, from what Myntra currently holds.
 *
 * @param {object} claim  a row from `fetchClaimByTicketId`
 * @param {object} input
 * @param {string} input.description     the seller's argument — the whole point
 * @param {string} [input.issueCategory] overrides the claim's own, from the sheet
 */
function buildFwTicketPayload(claim, { description, issueCategory } = {}) {
    if (!claim) throw new Error("buildFwTicketPayload: no claim to dispute");
    if (!text(description)) throw new Error("A description is required to reopen a ticket");

    // Myntra stores the product proofs as ONE comma-separated string and the
    // shipping label separately; the dispute wants them as a flat array, label
    // first, exactly as the portal sends it.
    const attachments = [
        text(claim.shippingLabelProofUrl),
        ...text(claim.productProofUrl).split(",").map(text),
    ].filter(Boolean);

    const number = (value) => {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : null;
    };

    return {
        ticketId: number(claim.ticketId),
        description: text(description),
        orderId: number(claim.orderId),
        returnId: number(claim.returnId),
        trackingId: text(claim.trackingId),
        skuId: number(claim.skuId),
        styleId: number(claim.styleId),
        // The sheet's category wins when it has one: an operator re-filing under
        // a different category is making a deliberate choice, and the claim's
        // own value is what was already rejected.
        issueCategory: text(issueCategory) || text(claim.issueCategory),
        // Fixed. See DISPUTE_RETURN_REASON — this is the reason for reopening,
        // not the customer's reason for returning.
        returnReason: DISPUTE_RETURN_REASON,
        attachments,
    };
}

/**
 * Reopens a ticket.
 *
 * @returns {Promise<{ok: boolean, message: string, row: object|null}>}
 *
 * Myntra answers 200 with a `status` envelope, and a business refusal —
 * "already disputed", "outside the dispute window" — arrives inside it rather
 * than as an HTTP error. So the envelope is the verdict, not the status code.
 */
async function createFwTicket(jar, payload) {
    const url = `${API_BASE}/api/spf/createFwTicket`;

    const res = await axios.post(url, payload, {
        headers: headers(jar),
        validateStatus: () => true,
        timeout: REQ_TIMEOUT_MS,
    });

    if (res.status >= 400) {
        logApiFailure({
            platform: "myntra",
            step: "createFwTicket",
            method: "POST",
            url,
            status: res.status,
            data: res.data,
        });
    }

    if (res.status === 401 || res.status === 403) {
        throw authError("createFwTicket", res.status, JSON.stringify(res.data || ""));
    }

    const envelope = res.data?.status || {};
    const message = text(envelope.statusMessage) || `HTTP ${res.status}`;
    const ok = res.status === 200 && String(envelope.statusType || "").toUpperCase() === "SUCCESS";

    if (!ok && res.status >= 400) {
        throw new Error(`createFwTicket failed: ${message}`);
    }

    return {
        ok,
        message,
        row: Array.isArray(res.data?.data) ? res.data.data[0] || null : null,
    };
}

module.exports = {
    SHEET_COLUMNS,
    DISPUTE_RETURN_REASON,
    readReClaimSheet,
    writeReClaimTemplate,
    SHEET_COLUMNS,
    REQUIRED_SHEET_COLUMNS,
    DESCRIPTION_COLUMN,
    buildFwTicketPayload,
    createFwTicket,
    API_BASE,
};
