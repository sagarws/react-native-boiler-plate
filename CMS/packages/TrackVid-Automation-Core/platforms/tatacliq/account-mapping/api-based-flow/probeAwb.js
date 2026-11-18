// -----------------------------------------------------------------------------
// Tata CliQ — does this login hold this return?
// -----------------------------------------------------------------------------
// The question account mapping and Refill both ask, and on Tata CliQ it costs
// more than one call: a return is visible only to the SLAVE that owns it, and
// the portal's pick is server-side session state. So "does this login hold this
// AWB" is really "does any of this login's slaves hold it", and the probe
// sweeps them.
//
// ONE SEARCH ANSWERS EVERYTHING. The eligibility response carries the forward
// AWB, the transaction id, the invoice and whether a CRM ticket already
// exists — so a probe that found the return has already learned every field
// Refill could want, and asking again would be a second call for an answer in
// hand. That is why this returns the row rather than a bare boolean.
//
// Ordered by the caller: the desktop hands slaves most-recently-useful first
// (see its `slavesOf`), and claims arrive in batches from one warehouse, so a
// sweep is usually one search rather than several.
//
// NO STATUS. The row shows a CRM ticket NUMBER when one exists, which answers
// "already claimed" — but nothing captured so far reports where that ticket now
// stands, so `statusChange` is not offered for this platform. See
// common/refillConfig.js.
// -----------------------------------------------------------------------------

const { findReturn } = require("../../claim-management/api-based-flow/claimApiFlow");
const { setSlaveSession } = require("../../common/slaveSync");

/**
 * Ask one logged-in Tata CliQ page whether any of its slaves owns this AWB.
 *
 * @param {object} page a signed-in page — see common/login + common/sessionStore
 * @param {object} input
 * @param {string} input.reverseAwb the return AWB to look for
 * @param {Array<{ id: string, name: string, code: string|null }>} input.slaves
 *        the login's slaves, most-recently-useful first
 * @param {object} [options]
 * @param {object} [options.logger]
 * @returns {Promise<{
 *   found: boolean,
 *   slave: { id: string, name: string, code: string|null }|null,
 *   forwardAwb: string|null,
 *   transId: string|null,
 *   crmTicket: string|null,
 *   claimable: boolean,
 *   searched: string[]
 * }>}
 *   `searched` names the slaves actually tried. A miss on one warehouse is a
 *   different fact from a miss on all of them, and a caller cannot tell which
 *   from `found: false` alone.
 */
async function probeTataCliqAwb(page, { reverseAwb, slaves = [] }, { logger } = {}) {
    const awb = String(reverseAwb || "").trim();
    const miss = {
        found: false,
        slave: null,
        forwardAwb: null,
        transId: null,
        crmTicket: null,
        claimable: false,
        searched: [],
    };

    if (!awb) return miss;

    if (slaves.length === 0) {
        logger?.warn?.(
            "⚠️ [tatacliq/probe] this login has no slaves stored — run Sync slaves for it first"
        );

        return miss;
    }

    const searched = [];

    for (const slave of slaves) {
        try {
            await setSlaveSession(page, slave);
        } catch (err) {
            // A slave that cannot be selected is not a miss — the session may
            // have died mid-sweep, and reporting "not on this account" would
            // send the mapping run on to the next login with a wrong answer.
            throw new Error(`Could not switch to slave ${slave.name}: ${err.message}`);
        }

        searched.push(slave.name);

        const row = await findReturn(page, awb);

        if (row.found) {
            logger?.info?.(`🔎 [tatacliq/probe] ${awb} is on slave ${slave.name}`);

            return {
                found: true,
                slave,
                forwardAwb: row.forwardAwb,
                transId: row.transId,
                crmTicket: row.crmTicket,
                claimable: row.claimable,
                searched,
            };
        }
    }

    return { ...miss, searched };
}

module.exports = { probeTataCliqAwb };
