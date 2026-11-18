// -----------------------------------------------------------------------------
// Tata CliQ slave sync — the slaves visible to one credential
// -----------------------------------------------------------------------------
// A Tata CliQ seller holds SLAVES (warehouses / fulfilment nodes), and a return
// is only visible to the slave that owns it. The portal makes the operator pick
// one before searching, and the pick is SERVER-SIDE STATE:
//
//   GET /faces/jsp/userResponse.jsp?flag=SlavesUnderSeller&Value={query}
//         → <ul class="slaveList"><li id="58020">wms-prozo-blr (129602-1101225062)</li></ul>
//   GET /faces/jsp/omsPageNavigation.jsp?flag=setSession&type=SLV&id=58020&text={label}
//         → the session now belongs to that slave; later calls carry no slave id
//
// That is the same shape as AJIO's POB: a per-credential list of ids that every
// later call is scoped to, which nothing in the login response reports. So it is
// stored the same way — on the credential, beside `pobIds` — and refreshed by an
// explicit "Sync slaves", not guessed per run. See platforms/ajio/common/pobSync.
//
// WHY IN-PAGE. sellerzone.tatacliq.com sits behind Cloudflare (the capture
// carries a /cdn-cgi/challenge-platform request), and the slave pick is session
// state — so these run inside the logged-in page, exactly as every AJIO call
// does, rather than as bare HTTPS requests.
//
// THE RESPONSE IS HTML, not JSON. Tata CliQ's seller portal is a JSP app: every
// endpoint answers text/html, and the id lives in an attribute. Parsed with one
// anchored regex over the `<li>` tags rather than a DOM library, because the
// consumers bundle (Trackvid-CMS's Electron main process) and a parser is a
// dependency the other runner would also have to carry.
//
// Verified from services/api-network-records (12).json (2026-09-17).
// -----------------------------------------------------------------------------

const ORIGIN = process.env.TATACLIQ_PORTAL_URL || "https://sellerzone.tatacliq.com";

/** The slave list is filtered server-side by this query; empty asks for all. */
const SLAVE_LIST_PATH = "/faces/jsp/userResponse.jsp?flag=SlavesUnderSeller&Value=";

/**
 * The portal's own "Slave list" screen, which is PAGED and complete.
 *
 * `SlavesUnderSeller` above is the type-ahead behind a search box, and an empty
 * query does not mean "everything" to it — it answers with NINE. This seller
 * has at least forty, so a claim swept nine of them, missed the one that owned
 * the return, and reported "not on any of 9 slaves" — which was true, and the
 * wrong nine.
 *
 * Verified against services/api-network-records (12).json (2026-09-17): pages
 * 2, 3 and 4 of this view carried thirty distinct slaves, twenty-six of which
 * the type-ahead never returns.
 */
const SLAVE_PAGE_PATH = "/faces/jsp/pageNavigation.jsp";

/** Rows per page, as the portal's own screen asks for them. */
const SLAVE_PAGE_SIZE = 10;

/**
 * A slave on the paged screen:
 *
 *   <div class="product-details-info-1">
 *     <h2>Guntur IKON Mall</h2>
 *     <ul><li>Guntur IKON Mall(129602-217)</li>
 *
 * NO NUMERIC ID HERE — that is the whole awkwardness. `setSlaveSession` takes
 * the id, and only the type-ahead carries it, so this view answers WHICH slaves
 * exist and the type-ahead is then asked for the id of each one it did not
 * already return.
 */
const SLAVE_ROW = /<li\b[^>]*>\s*([^<(]{1,120}?)\s*\(\s*([A-Za-z0-9-]+)\s*\)\s*<\/li>/gi;
const SET_SESSION_PATH = "/faces/jsp/omsPageNavigation.jsp?flag=setSession&type=SLV";

/**
 * `<li id="58020">wms-prozo-blr (129602-1101225062)</li>`
 *
 * The id is numeric and internal; the text is what the portal shows and what
 * `setSession` echoes back in its own `text` parameter. Both are kept: the id
 * is what the call takes, the name is what an operator recognises and what a
 * CMS row can be matched against.
 */
const SLAVE_LI = /<li\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;

/** `wms-prozo-blr (129602-1101225062)` → the code in the brackets. */
const SLAVE_CODE = /\(([^)]+)\)\s*$/;

const text = (value) =>
    String(value ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Parse the slave list out of the portal's HTML. Pure, and exported for tests.
 *
 * @param {string} html the `SlavesUnderSeller` response
 * @returns {{ id: string, name: string, code: string|null }[]}
 *   `name` is the full label the portal shows ("wms-prozo-blr (129602-…)");
 *   `code` is the bracketed part on its own, which is what the seller's own
 *   paperwork tends to carry.
 */
function parseSlaveList(html) {
    const out = [];
    const seen = new Set();

    for (const match of String(html || "").matchAll(SLAVE_LI)) {
        const id = match[1];
        const name = text(match[2]);

        if (!id || !name || seen.has(id)) continue;

        seen.add(id);
        out.push({ id, name, code: (name.match(SLAVE_CODE) || [, null])[1]?.trim() ?? null });
    }

    return out;
}

/**
 * Ask the portal which slaves this credential can see.
 *
 * @param {object} page a logged-in puppeteer page on sellerzone.tatacliq.com
 * @param {{ query?: string }} [options] `query` narrows the list server-side,
 *        the way the portal's own type-ahead does. Omit it for everything.
 * @returns {Promise<{ id: string, name: string, code: string|null }[]>}
 */
async function fetchSlaves(page, { query = "" } = {}) {
    const url = `${ORIGIN}${SLAVE_LIST_PATH}${encodeURIComponent(query)}`;
    const html = await page.evaluate(async (target) => {
        const res = await fetch(target, { credentials: "include", headers: { Accept: "text/html" } });

        return res.ok ? res.text() : "";
    }, url);

    return parseSlaveList(html);
}

/**
 * Every slave on one page of the portal's own list screen, as `{ name, code }`.
 *
 * Pure, and exported for tests. No id: see SLAVE_ROW.
 */
function parseSlavePage(html) {
    const out = [];
    const seen = new Set();

    for (const match of String(html || "").matchAll(SLAVE_ROW)) {
        const name = text(match[1]);
        const code = text(match[2]);

        // The row repeats the label inside an <h2> as well; key on the code,
        // which is the half that cannot be duplicated across slaves.
        if (!name || !code || seen.has(code)) continue;

        seen.add(code);
        out.push({ name, code });
    }

    return out;
}

/**
 * Walk the paged list screen until it stops producing slaves we have not seen.
 *
 * STOPS ON A PAGE THAT ADDS NOTHING, rather than on an empty one: the portal
 * answers a page past the end by repeating the last one rather than returning
 * zero rows, so "empty" never arrives and a loop waiting for it would run to
 * its cap every time.
 *
 * @returns {Promise<{ name: string, code: string }[]>}
 */
async function fetchSlaveDirectory(page, { maxPages = 40, seller = "" } = {}) {
    const byCode = new Map();

    for (let counter = 1; counter <= maxPages; counter += 1) {
        /*
         * SCOPED TO THE SELLER, which it was not.
         *
         * `sellerNameSellerCode` was sent EMPTY, and this screen is the
         * portal's global slave directory: an empty filter returns every
         * seller's warehouses. On this account that was 373 rows whose codes
         * carried other sellers' prefixes — 129545-, 129236-, 100001- — none of
         * which this login's type-ahead has ever heard of. So every one of the
         * 364 id lookups that followed was asking the wrong search box about
         * somebody else's warehouse, and all 364 came back empty.
         *
         * The portal's own request carries the seller, captured 2026-09-24:
         *
         *   sellerNameSellerCode=Wrogn Private Limited (129602)
         *
         * and answers 10 rows a page, every code prefixed 129602.
         */
        const url =
            `${ORIGIN}${SLAVE_PAGE_PATH}?flag=slaveListView` +
            `&sellerNameSellerCode=${encodeURIComponent(seller)}&slaveName=` +
            `&startDate=&endDate=&navCurCounter=${counter}` +
            `&invoke:action=SlaveListViewActionBean.searchAction&navRange=${SLAVE_PAGE_SIZE}` +
            `&flag=slaveListViewDetails`;

        let html = "";

        try {
            html = await page.evaluate(async (target) => {
                const res = await fetch(target, {
                    credentials: "include",
                    headers: { Accept: "text/html" },
                });

                return res.ok ? res.text() : "";
            }, url);
        } catch (err) {
            // One page failing is not an answer about the rest. Stop here and
            // return what was gathered; the caller still has the type-ahead's.
            break;
        }

        const before = byCode.size;

        for (const slave of parseSlavePage(html)) {
            if (!byCode.has(slave.code)) byCode.set(slave.code, slave);
        }

        if (byCode.size === before) break;
    }

    return [...byCode.values()];
}

/** Codes compared the way two people type them — case and spacing aside. */
const sameCode = (a, b) =>
    String(a || "").toLowerCase().replace(/\s+/g, "") ===
    String(b || "").toLowerCase().replace(/\s+/g, "");

/**
 * EVERY slave this credential can act on, with the ids `setSlaveSession` needs.
 *
 * Two sources, because neither is sufficient alone:
 *
 *   • the type-ahead carries the numeric id, and answers an empty query with
 *     nine whatever the seller actually has;
 *   • the paged list screen is complete and carries no id at all.
 *
 * So the directory says WHICH slaves exist and the type-ahead is asked, by
 * name, for the id of each one it did not already volunteer. That is one extra
 * call per unseen slave, paid once per sync rather than once per claim — and
 * the alternative is what this replaces: a claim sweeping nine slaves, missing
 * the one that held the return, and reporting the AWB as belonging to nobody.
 *
 * A slave whose id cannot be resolved is LEFT OUT and named in the log. It
 * could not be searched under even if it were kept, and a list carrying
 * entries that cannot be used would make the next failure harder to read.
 */
async function fetchAllSlaves(page, { logger = console, maxPages = 40, budgetMs = 90_000 } = {}) {
    const byCode = new Map();

    // The cheap call first: whatever it returns arrives complete, with ids.
    for (const slave of await fetchSlaves(page)) {
        if (slave.code) byCode.set(String(slave.code).toLowerCase(), slave);
    }

    /**
     * WHOSE SLAVES TO ASK FOR.
     *
     * Every slave code is `<sellerCode>-<slave>` — 129602-93, 129602-187 — so
     * the type-ahead's own answers name the seller this login belongs to. That
     * is the filter the directory screen needs, and sending it empty is what
     * made the sweep read every OTHER seller's warehouses instead.
     */
    const sellerCode = [...byCode.values()]
        .map((slave) => String(slave.code || "").split("-")[0])
        .find((prefix) => /^\d+$/.test(prefix)) || "";

    const directory = (await fetchSlaveDirectory(page, { maxPages, seller: sellerCode })).filter(
        // BELT AND BRACES. The filter above is a search field and may match
        // loosely; a row belonging to another seller cannot be resolved by this
        // login's type-ahead, so looking it up is a request spent to learn
        // nothing. Skipped rather than attempted.
        (entry) => !sellerCode || String(entry.code || "").startsWith(`${sellerCode}-`)
    );
    const unresolved = [];

    /**
     * A BUDGET, because this used to have none.
     *
     * One lookup per slave the type-ahead withheld, sequentially: on a seller
     * with 373 slaves that measured EIGHT MINUTES on a real run — and resolved
     * none of them, so the whole of it was spent to arrive back at the nine it
     * started with. An unbounded loop over a list whose size nobody controls
     * is not a sweep, it is a hang with a progress bar.
     *
     * The cap is on WALL CLOCK rather than count: what matters is how long a
     * caller waits, and a portal that has slowed down should cost the same
     * ceiling as one that has not.
     */
    const deadline = Date.now() + budgetMs;
    let ranOut = false;

    for (const entry of directory) {
        if (byCode.has(String(entry.code).toLowerCase())) continue;

        if (Date.now() >= deadline) {
            ranOut = true;
            unresolved.push(entry.code);

            continue;
        }

        /*
         * THE CODE FIRST, THEN THE NAME.
         *
         * The type-ahead's own label carries the code — "Guntur IKON Mall
         * (129602-217)" — and `parseSlaveList` reads it back out of there. So
         * the code is the precise query and the name is the loose one: two
         * warehouses can share a name, and a name with punctuation in it is
         * exactly what a search box narrows badly on. Asking by name alone is
         * what resolved 0 of 373.
         */
        let hit = null;

        for (const query of [entry.code, entry.name]) {
            if (!query) continue;

            let matches = [];

            try {
                matches = await fetchSlaves(page, { query });
            } catch (err) {
                continue;
            }

            hit = matches.find((candidate) => sameCode(candidate.code, entry.code)) ?? null;

            if (hit) break;
        }

        if (hit) byCode.set(String(hit.code).toLowerCase(), hit);
        else unresolved.push(entry.code);
    }

    if (unresolved.length > 0) {
        // The codes are TRUNCATED. Three hundred of them is not a log line, it
        // is a wall that hides every other line around it — and the count is
        // the part anybody acts on.
        const shown = unresolved.slice(0, 12).join(", ");
        const rest = unresolved.length > 12 ? `, and ${unresolved.length - 12} more` : "";

        logger?.warn?.(
            `⚠️ [tatacliq/slaves] ${unresolved.length} slave(s) are on the portal's list but their ` +
                `id could not be resolved, so they cannot be searched under: ${shown}${rest}` +
                (ranOut ? ` — stopped after ${Math.round(budgetMs / 1000)}s` : "")
        );
    }

    logger?.info?.(
        `🏬 [tatacliq/slaves] ${byCode.size} slave(s) — ${directory.length} on the portal's list screen`
    );

    return [...byCode.values()];
}

/**
 * Make this slave the one the session searches under.
 *
 * Every later call — the AWB search, the eligibility read, the submit — carries
 * NO slave id and relies on this having been done. So a runner that files for
 * two slaves must call this between them, and a runner that files for one must
 * still call it at least once: a session with no slave set searches nothing.
 *
 * `text` is sent because the portal sends it. It is the label, not an id, and
 * nothing appears to key on it — but a parameter the portal always includes is
 * not one to start omitting on a hunch.
 *
 * @returns {Promise<boolean>} whether the call answered at all. The portal
 *          returns an empty 200 body either way, so this is not proof the slave
 *          was accepted — the search that follows is.
 */
async function setSlaveSession(page, slave) {
    const id = String(slave?.id || "").trim();

    if (!id) throw new Error("setSlaveSession: a slave id is required");

    const url =
        `${ORIGIN}${SET_SESSION_PATH}&id=${encodeURIComponent(id)}` +
        `&text=${encodeURIComponent(slave.name || "")}`;

    return page.evaluate(async (target) => {
        const res = await fetch(target, { credentials: "include", headers: { Accept: "text/html" } });

        return res.ok;
    }, url);
}

/**
 * Which stored slave a return belongs to, by name or code.
 *
 * A CMS row carries the slave the seller's own data names; the portal takes the
 * numeric id. Matched on the code first (it is the unambiguous half of the
 * label) then on the whole name, both case- and space-insensitively, because
 * the two sides are typed by different people.
 *
 * @param {Array<{ id: string, name: string, code: string|null }>} slaves
 * @param {string} wanted
 * @returns {{ id: string, name: string, code: string|null }|null}
 */
function findSlave(slaves, wanted) {
    const needle = String(wanted || "").toLowerCase().replace(/\s+/g, "");

    if (!needle) return null;

    const norm = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");

    return (
        (slaves || []).find((slave) => slave.code && norm(slave.code) === needle) ||
        (slaves || []).find((slave) => norm(slave.name) === needle) ||
        (slaves || []).find((slave) => norm(slave.name).includes(needle)) ||
        null
    );
}

module.exports = {
    fetchAllSlaves,
    fetchSlaveDirectory,
    parseSlavePage,
    ORIGIN,
    parseSlaveList,
    fetchSlaves,
    setSlaveSession,
    findSlave,
};
