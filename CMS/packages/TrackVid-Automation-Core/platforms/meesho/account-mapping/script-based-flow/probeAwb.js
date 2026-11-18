/**
 * Meesho — does this supplier account hold this AWB?
 *
 * The only platform here with no API to ask. Meesho's supplier endpoints are
 * keyed on the SUB-ORDER NUMBER end to end — the claim form is filled by it,
 * the ticket search takes it, and `awb_number` is nothing but a text box on
 * the payload. So an unmapped row, which by definition has no sub-order number
 * either, cannot be placed through any endpoint at all.
 *
 * The supplier portal's own Returns screen can: it searches by "Order ID, SKU
 * or AWB Number" and lists only the signed-in supplier's returns. One row in
 * the results table means the AWB is this account's; an empty table means it
 * is not. That is the whole test.
 *
 * The row is CAPTURED as well as counted. It carries the sub-order number —
 * the identifier every other Meesho automation needs and the one this row is
 * missing — plus the SKU, the return type and the dates. Nothing consumes them
 * yet; they are recorded because the page has already been loaded and paid
 * for, and a second visit later to read what was on screen now would be the
 * expensive mistake.
 */

const { meeshoId } = require("../../common/identifiers.js");

const ORIGIN = "https://supplier.meesho.com";
const SEARCH_PATH = "/panel/v3/new/fulfillment/pcbev/returns/search-returns";

/** The search box, by its placeholder — Meesho's class names are generated. */
const SEARCH_INPUT = 'input[placeholder*="AWB" i]';
/** Rendered by the results grid; `aria-label="sticky table"` is stable across builds. */
const RESULTS_TABLE = 'table[aria-label="sticky table"]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The URL pressing Enter in that box produces. */
function searchUrl(awb) {
    return `${ORIGIN}${SEARCH_PATH}?q=${encodeURIComponent(meeshoId(awb))}`;
}

/**
 * Reads whatever the results table holds, as data rather than as markup.
 *
 * Positional, because every class on that table is a generated hash and every
 * cell's inner structure differs — the header order is the only stable
 * contract, and it is asserted rather than assumed: a table whose first header
 * is not "Product Details" is not the table this was written against, and
 * reading it positionally would invent a sub-order number out of a price.
 */
async function readResultRows(page) {
    return page.evaluate(
        (tableSelector) => {
            const table = document.querySelector(tableSelector);

            if (!table) return { ok: false, reason: "no results table", rows: [] };

            const headers = [...table.querySelectorAll("thead th")].map((th) =>
                (th.textContent || "").trim()
            );

            if (!/product\s*details/i.test(headers[0] || "")) {
                return { ok: false, reason: `unexpected columns: ${headers.join(" | ")}`, rows: [] };
            }

            const text = (node) => (node?.textContent || "").trim();
            const after = (cell, label) => {
                const line = [...cell.querySelectorAll("p")]
                    .map((p) => text(p))
                    .find((value) => value.toLowerCase().startsWith(label.toLowerCase()));

                return line ? line.slice(label.length).replace(/^[:\s]+/, "") : null;
            };

            const rows = [...table.querySelectorAll("tbody tr")].map((tr) => {
                const cells = [...tr.querySelectorAll("td")];
                const product = cells[0];
                const dateCell = cells[3];

                return {
                    productName: product ? text(product.querySelector("p")) : null,
                    sellerSku: product ? after(product, "SKU ID") : null,
                    category: product ? after(product, "Category") : null,
                    // "Qty: 1 | Size: Free Size" — kept whole; splitting it here
                    // would bake in a format nothing has asked for yet.
                    quantityAndSize: product ? after(product, "Qty") : null,
                    subOrderNumber: text(cells[1]) || null,
                    status: text(cells[2]) || null,
                    // Two lines: the date, then a chip naming the return type
                    // ("Courier Return (RTO)").
                    createdOrPickedUp: dateCell ? text(dateCell.querySelector("div > div")) : null,
                    returnType: dateCell ? text(dateCell.querySelector("[aria-disabled]")) : null,
                    expectedOrDeliveredOn: text(cells[4]) || null,
                    returnReason: text(cells[5]) || null,
                };
            });

            return { ok: true, reason: null, rows };
        },
        RESULTS_TABLE
    );
}

/**
 * @param {object} page  a signed-in Meesho Puppeteer page
 * @param {string} awb
 * @param {object} [options]
 * @param {number} [options.settleMs]  how long the grid is given to render
 * @param {object} [options.logger]
 * @returns {Promise<{found: boolean, details: object|null}>}
 */
async function probeMeeshoAwb(page, awb, { settleMs = 4000, logger } = {}) {
    // The same spelling the API path searches with — the Returns screen behind
    // this box runs the same text match, so a lower-cased waybill can come back
    // empty against a return that is on the account.
    const wanted = meeshoId(awb);

    await page.goto(searchUrl(wanted), { waitUntil: "networkidle2", timeout: 60000 });

    // The deep link IS what pressing Enter produces, so it is tried first — one
    // navigation instead of a navigation plus a keystroke race. But Meesho has
    // shipped builds that render the screen empty until the box is actually
    // typed in, so the box is checked and driven when the link alone did not
    // take.
    const typed = await page
        .$eval(SEARCH_INPUT, (input) => input.value || "")
        .catch(() => null);

    if (typed === null) {
        // No search box at all: this is not the Returns screen. Almost always a
        // session that has bounced to the login page, and reporting it as "not
        // this account" would silently blame the data.
        throw new Error("Meesho Returns search box not found — the session may have expired");
    }

    if (typed.trim() !== wanted) {
        logger?.info?.(`⌨️ Meesho: typing ${wanted} into the returns search`);

        await page.click(SEARCH_INPUT, { clickCount: 3 });
        await page.keyboard.type(wanted, { delay: 60 });
        await page.keyboard.press("Enter");
    }

    // The grid re-renders in place — no navigation to wait on — so the table is
    // polled rather than awaited once.
    const deadline = Date.now() + settleMs;
    let table = await readResultRows(page);

    while (!table.ok && Date.now() < deadline) {
        await sleep(500);
        table = await readResultRows(page);
    }

    if (!table.ok) {
        // No table is Meesho's empty state, which is a real "no". It is also
        // what a still-loading screen looks like, which is why the poll above
        // ran first.
        logger?.info?.(`🔎 Meesho: no returns row for ${wanted} (${table.reason})`);

        return { found: false, details: null };
    }

    // Meesho searches on order id and SKU too, so a hit is only OURS if the row
    // count is real; the table itself is scoped to the signed-in supplier.
    if (table.rows.length === 0) return { found: false, details: null };

    const [first] = table.rows;

    logger?.info?.(
        `✅ Meesho: ${wanted} found — suborder ${first.subOrderNumber || "?"} (${table.rows.length} row(s))`
    );

    return {
        found: true,
        details: {
            // The identifier the row was missing, and the reason this is worth
            // capturing rather than counting.
            subOrderNumber: first.subOrderNumber || null,
            sellerSku: first.sellerSku || null,
            status: first.status || null,
            returnType: first.returnType || null,
            rowCount: table.rows.length,
            rows: table.rows,
        },
    };
}

module.exports = { probeMeeshoAwb, searchUrl, SEARCH_INPUT, RESULTS_TABLE };
