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
export function fetchAllSlaves(page: any, { logger, maxPages, budgetMs }?: {
    logger?: Console;
    maxPages?: number;
    budgetMs?: number;
}): Promise<any[]>;
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
export function fetchSlaveDirectory(page: any, { maxPages, seller }?: {
    maxPages?: number;
    seller?: string;
}): Promise<{
    name: string;
    code: string;
}[]>;
/**
 * Every slave on one page of the portal's own list screen, as `{ name, code }`.
 *
 * Pure, and exported for tests. No id: see SLAVE_ROW.
 */
export function parseSlavePage(html: any): {
    name: string;
    code: string;
}[];
export const ORIGIN: string;
/**
 * Parse the slave list out of the portal's HTML. Pure, and exported for tests.
 *
 * @param {string} html the `SlavesUnderSeller` response
 * @returns {{ id: string, name: string, code: string|null }[]}
 *   `name` is the full label the portal shows ("wms-prozo-blr (129602-…)");
 *   `code` is the bracketed part on its own, which is what the seller's own
 *   paperwork tends to carry.
 */
export function parseSlaveList(html: string): {
    id: string;
    name: string;
    code: string | null;
}[];
/**
 * Ask the portal which slaves this credential can see.
 *
 * @param {object} page a logged-in puppeteer page on sellerzone.tatacliq.com
 * @param {{ query?: string }} [options] `query` narrows the list server-side,
 *        the way the portal's own type-ahead does. Omit it for everything.
 * @returns {Promise<{ id: string, name: string, code: string|null }[]>}
 */
export function fetchSlaves(page: object, { query }?: {
    query?: string;
}): Promise<{
    id: string;
    name: string;
    code: string | null;
}[]>;
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
export function setSlaveSession(page: any, slave: any): Promise<boolean>;
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
export function findSlave(slaves: Array<{
    id: string;
    name: string;
    code: string | null;
}>, wanted: string): {
    id: string;
    name: string;
    code: string | null;
} | null;
