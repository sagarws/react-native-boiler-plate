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
export function probeTataCliqAwb(page: object, { reverseAwb, slaves }: {
    reverseAwb: string;
    slaves: Array<{
        id: string;
        name: string;
        code: string | null;
    }>;
}, { logger }?: {
    logger?: object;
}): Promise<{
    found: boolean;
    slave: {
        id: string;
        name: string;
        code: string | null;
    } | null;
    forwardAwb: string | null;
    transId: string | null;
    crmTicket: string | null;
    claimable: boolean;
    searched: string[];
}>;
