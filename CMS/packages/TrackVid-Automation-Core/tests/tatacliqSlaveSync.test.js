const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const {
    parseSlavePage,
    fetchSlaveDirectory,
    fetchAllSlaves,
} = require(path.resolve(__dirname, "..", "platforms/tatacliq/common/slaveSync.js"));

/**
 * Finding ALL of a seller's slaves, not the nine the search box volunteers.
 *
 * `SlavesUnderSeller` is the type-ahead behind a search box. An empty query
 * does not mean "everything" to it — it answers with nine. This seller has at
 * least forty, so a claim swept nine, missed the slave that owned the return,
 * and reported "11259158429540 is not on any of 9 slaves", which was true and
 * about the wrong nine. The return was on Guntur IKON Mall (129602-217), which
 * the type-ahead never returned.
 *
 * The paged list screen is the complete answer and carries no numeric id; the
 * type-ahead carries the id and is incomplete. Neither is sufficient alone,
 * which is what `fetchAllSlaves` is for.
 *
 * The markup here is the portal's own, from
 * services/api-network-records (12).json (page 4, 2026-09-17), trimmed and with
 * the contact details taken out.
 */

/** One slave, as the paged screen draws it. */
const row = (name, code) => `
   <div class="listing-view">
    <div class="product-details">
     <div class="product-details-info-1">
      <h2>${name}</h2>
      <ul>
       <li>${name}(${code})</li>
       <li>slave@example.invalid</li>
      </ul>
     </div>
    </div>
   </div>`;

const pageOf = (slaves) => slaves.map(([name, code]) => row(name, code)).join("\n");

const PAGES = {
    1: pageOf([["HSR NIFT", "129602-173"], ["CMH Road", "129602-177"]]),
    2: pageOf([["Guntur IKON Mall", "129602-217"], ["New Bel Road", "129602-216"]]),
    // Past the end the portal repeats the last page rather than emptying, which
    // is why the walk stops on "added nothing" and not on "no rows".
    3: pageOf([["Guntur IKON Mall", "129602-217"], ["New Bel Road", "129602-216"]]),
};

/** A page whose fetch answers from PAGES, and records what was asked for. */
const fakePage = (asked, typeAhead = () => "") => ({
    evaluate: async (fn, url) => {
        asked.push(String(url));

        const match = String(url).match(/navCurCounter=(\d+)/);

        if (match) return PAGES[Number(match[1])] ?? PAGES[3];

        const value = decodeURIComponent((String(url).split("Value=")[1] ?? "").trim());

        return typeAhead(value);
    },
});

test("reads every slave off one page of the portal's own list screen", () => {
    const slaves = parseSlavePage(PAGES[2]);

    assert.deepEqual(slaves, [
        { name: "Guntur IKON Mall", code: "129602-217" },
        { name: "New Bel Road", code: "129602-216" },
    ]);
});

test("walks the pages, and stops when one adds nothing new", async () => {
    const asked = [];
    const directory = await fetchSlaveDirectory(fakePage(asked), { maxPages: 10 });

    assert.deepEqual(
        directory.map((slave) => slave.code),
        ["129602-173", "129602-177", "129602-217", "129602-216"]
    );
    // Four pages asked for, not ten: 1, 2, then 3 which repeats 2 and ends it.
    assert.equal(asked.length, 3);
});

test("resolves the id of a slave the type-ahead never volunteered", async () => {
    const asked = [];
    // The type-ahead: nine for an empty query — none of them Guntur — and the
    // real answer when asked for one by name.
    const typeAhead = (value) => {
        if (!value) return '<li id="1001">HSR NIFT (129602-173)</li>';

        return value === "Guntur IKON Mall"
            ? '<li id="2217">Guntur IKON Mall (129602-217)</li>'
            : `<li id="9${value.length}">${value} (129602-000)</li>`;
    };

    const slaves = await fetchAllSlaves(fakePage(asked, typeAhead), {
        logger: { info() {}, warn() {} },
        maxPages: 10,
    });

    const guntur = slaves.find((slave) => slave.code === "129602-217");

    // THE WHOLE POINT: it is in the list, and it carries the id that
    // `setSlaveSession` needs — which the list screen does not publish.
    assert.ok(guntur, "the slave holding the AWB must be in the result");
    assert.equal(guntur.id, "2217");
    // And the one the type-ahead did volunteer is not asked for again.
    assert.ok(slaves.some((slave) => slave.code === "129602-173"));
});

test("leaves out a slave whose id cannot be resolved, and says which", async () => {
    const warnings = [];
    const asked = [];
    // Every by-name lookup comes back empty: the slaves exist on the list
    // screen but nothing can be searched under them.
    const slaves = await fetchAllSlaves(fakePage(asked, (value) => (value ? "" : "")), {
        logger: { info() {}, warn: (message) => warnings.push(message) },
        maxPages: 10,
    });

    assert.deepEqual(slaves, []);
    // Named, not silently dropped: a list carrying entries that cannot be used
    // would make the next "not on any slave" impossible to read.
    assert.match(warnings.join(" "), /129602-217/);
});


// -----------------------------------------------------------------------------
// The cost of resolving ids, which used to have no ceiling
// -----------------------------------------------------------------------------

/**
 * A directory of `count` slaves the type-ahead never volunteers, and a
 * type-ahead that answers nothing — the shape of the real failure.
 */
const stubbornPortal = (count, { perLookupMs = 0, asked = [] } = {}) => {
    const rows = Array.from({ length: count }, (_, i) => [`Slave ${i}`, `129545-CODE${i}`]);
    // One page of directory HTML; anything past it is empty, which is how the
    // walk knows to stop.
    const html = rows.map(([name, code]) => row(name, code)).join("\n");

    return {
        asked,
        page: {
            evaluate: async (fn, url) => {
                const target = String(url);

                if (/navCurCounter=/.test(target)) {
                    const match = target.match(/navCurCounter=(\d+)/);

                    return match && Number(match[1]) === 1 ? html : "";
                }

                asked.push(decodeURIComponent((target.split("Value=")[1] ?? "").trim()));

                if (perLookupMs) await new Promise((r) => setTimeout(r, perLookupMs));

                return "";
            },
        },
    };
};


test("tries the CODE before the name when resolving an id", async () => {
    // The type-ahead's own label carries the code — "Guntur IKON Mall
    // (129602-217)" — so the code is the precise query and the name is the
    // loose one. Asking by name alone resolved 0 of 373 on a real account.
    const asked = [];
    const portal = stubbornPortal(1, { asked });

    await fetchAllSlaves(portal.page, { logger: { info() {}, warn() {} }, maxPages: 2 });

    // The empty first call is the type-ahead's own "everything" query.
    const lookups = asked.filter(Boolean);

    assert.equal(lookups[0], "129545-CODE0", `asked by ${lookups[0]} first`);
    assert.ok(lookups.includes("Slave 0"), "never fell back to the name");
});

test("stops resolving when the time budget runs out", async () => {
    /*
     * THE HANG THIS ENDS. 373 slaves, one sequential lookup each, no ceiling:
     * eight minutes on a real run, before any work began, resolving none of
     * them. A session open must not be able to cost that.
     */
    const asked = [];
    const warnings = [];
    const portal = stubbornPortal(40, { perLookupMs: 10, asked });

    const started = Date.now();

    await fetchAllSlaves(portal.page, {
        logger: { info() {}, warn: (m) => warnings.push(m) },
        maxPages: 2,
        budgetMs: 60,
    });

    const elapsed = Date.now() - started;

    // Far short of 40 slaves × 2 queries × 10ms.
    assert.ok(elapsed < 500, `ran ${elapsed}ms — the budget did not stop it`);
    assert.match(warnings.join(" "), /stopped after/);
});

test("does not print three hundred codes into one log line", async () => {
    // The real run emitted every unresolved code — a wall that hid every other
    // line around it. The COUNT is the part anybody acts on.
    const warnings = [];
    const portal = stubbornPortal(30);

    await fetchAllSlaves(portal.page, {
        logger: { info() {}, warn: (m) => warnings.push(m) },
        maxPages: 2,
    });

    const line = warnings.join(" ");

    assert.match(line, /30 slave\(s\)/);
    assert.match(line, /and \d+ more/);
    assert.ok(line.length < 500, `log line is ${line.length} chars`);
});


// -----------------------------------------------------------------------------
// Whose slaves the directory is asked for
// -----------------------------------------------------------------------------

/**
 * THE 0-OF-373. `sellerNameSellerCode` was sent empty, and this screen is the
 * portal's GLOBAL slave directory — an empty filter returns every seller's
 * warehouses. On the account this came from that meant 373 rows carrying other
 * sellers' prefixes (129545-, 129236-, 100001-), and the type-ahead this login
 * owns has never heard of any of them.
 *
 * So all 364 id lookups asked the wrong search box about somebody else's
 * warehouse. Eight minutes, nothing resolved, and the claim then searched the
 * same nine slaves it started with — missing wms-prozo-mumbai, which held the
 * return.
 *
 * The portal's own request carries the seller (captured 2026-09-24) and answers
 * ten rows a page, every code prefixed 129602.
 */
test("asks the directory for THIS seller, not for everyone", async () => {
    const asked = [];
    const page = {
        evaluate: async (fn, url) => {
            const target = String(url);

            asked.push(target);

            // The type-ahead's nine, which is where the seller code comes from.
            if (!/navCurCounter=/.test(target)) {
                return '<li id="1001">Dilsukhnagar (129602-93)</li>';
            }

            return /navCurCounter=1\b/.test(target)
                ? row("wms-prozo-mumbai", "129602-1101223376")
                : "";
        },
    };

    await fetchAllSlaves(page, { logger: { info() {}, warn() {} }, maxPages: 3 });

    const directoryCalls = asked.filter((u) => /navCurCounter=/.test(u));

    assert.ok(directoryCalls.length > 0, "never read the directory");
    for (const url of directoryCalls) {
        assert.match(
            url,
            /sellerNameSellerCode=129602/,
            `asked the global directory: ${url}`
        );
    }
});

test("does not spend a lookup on another seller's warehouse", async () => {
    /*
     * Even scoped, the filter is a search field and may match loosely. A row
     * belonging to another seller cannot be resolved by this login's
     * type-ahead, so looking it up is a request spent to learn nothing — and
     * 364 of those is the eight minutes.
     */
    const lookups = [];
    const page = {
        evaluate: async (fn, url) => {
            const target = String(url);

            if (/navCurCounter=/.test(target)) {
                return /navCurCounter=1\b/.test(target)
                    ? [
                          row("Ours", "129602-500"),
                          row("Theirs", "129545-TCNSWC28"),
                          row("Also theirs", "129236-VH29822"),
                      ].join("\n")
                    : "";
            }

            const value = decodeURIComponent((target.split("Value=")[1] ?? "").trim());

            if (!value) return '<li id="1001">Dilsukhnagar (129602-93)</li>';

            lookups.push(value);

            return "";
        },
    };

    await fetchAllSlaves(page, { logger: { info() {}, warn() {} }, maxPages: 3 });

    // Only our own unresolved slave was asked about.
    assert.ok(
        lookups.every((q) => !/TCNSWC28|VH29822/.test(q)),
        `looked up another seller's warehouse: ${lookups}`
    );
});
