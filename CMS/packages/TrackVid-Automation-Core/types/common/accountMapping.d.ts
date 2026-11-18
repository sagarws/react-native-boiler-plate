export namespace ACCOUNT_MAPPING {
    namespace ajio {
        let flow: string;
        let scope: string;
        let accountField: string;
    }
    namespace delhivery {
        let flow_1: string;
        export { flow_1 as flow };
        let scope_1: any;
        export { scope_1 as scope };
        let accountField_1: string;
        export { accountField_1 as accountField };
    }
    namespace flipkart {
        let flow_2: string;
        export { flow_2 as flow };
        let scope_2: any;
        export { scope_2 as scope };
        let accountField_2: string;
        export { accountField_2 as accountField };
    }
    namespace meesho {
        const flow_3: "api" | "script";
        export { flow_3 as flow };
        let scope_3: any;
        export { scope_3 as scope };
        let accountField_3: string;
        export { accountField_3 as accountField };
    }
    namespace myntra {
        let flow_4: string;
        export { flow_4 as flow };
        let scope_4: any;
        export { scope_4 as scope };
        let accountField_4: string;
        export { accountField_4 as accountField };
    }
    namespace snapdeal {
        let flow_5: string;
        export { flow_5 as flow };
        let scope_5: any;
        export { scope_5 as scope };
        let accountField_5: string;
        export { accountField_5 as accountField };
    }
    namespace tatacliq {
        let flow_6: string;
        export { flow_6 as flow };
        let scope_6: string;
        export { scope_6 as scope };
        let accountField_6: string;
        export { accountField_6 as accountField };
    }
    namespace xbees {
        let flow_7: string;
        export { flow_7 as flow };
        let scope_7: any;
        export { scope_7 as scope };
        let accountField_7: string;
        export { accountField_7 as accountField };
    }
}
/** Platform keys an AWB can be mapped on, lowercase. */
export const MAPPABLE_PLATFORMS: string[];
/** The descriptor for one platform, or null when it cannot be mapped. */
export function accountMappingFor(platform: any): any;
/**
 * Asks each account whether it holds this AWB, and stops at the first that does.
 *
 * @param {object}   input
 * @param {string}   input.awb        the return AWB to place
 * @param {string[]} [input.alternates]  other identifiers for the SAME return —
 *                                    a sub-order number, an order number. Passed
 *                                    to the probe, which may try them when the
 *                                    AWB finds nothing; a probe that ignores
 *                                    them behaves exactly as before.
 *
 *                                    They matter because a stale AWB misses on
 *                                    EVERY account, and the sweep then reports
 *                                    the row as belonging to nobody — which
 *                                    reads as a problem with the accounts rather
 *                                    than with the one number being asked about.
 * @param {any[]}    input.accounts   opaque account objects — whatever the consumer's
 *                                    credential record looks like; only `keyOf` reads them
 * @param {(account: any, awb: string, alternates: string[]) => Promise<{found: boolean, scope?: any, details?: any}>}
 *                   input.probe      one marketplace question, one answer
 * @param {(account: any) => string} [input.keyOf]  identity for ordering and reporting
 * @param {RecentFirst} [input.recent] shared across a batch so the sweep shortens
 * @param {object}   [input.logger]
 *
 * @returns {Promise<{
 *   matched: any|null, key: string|null, scope: any|null, details: any|null,
 *   attempts: {key: string, found: boolean, error: string|null}[],
 *   errors: {key: string, error: string}[]
 * }>}
 *
 * NEVER THROWS for a marketplace answer. "No" is an answer, and so is "this
 * account's session is dead" — one broken login must not stop the other two
 * from being asked, because the AWB probably belongs to one of them. The
 * errors are returned instead, so the caller can say "not found, but two of
 * five accounts could not be reached", which is a different thing from "not
 * found" and leads somewhere different.
 */
export function mapAwbToAccount({ awb, alternates, accounts, probe, keyOf, recent, logger }: {
    awb: string;
    alternates?: string[];
    accounts: any[];
    probe: (account: any, awb: string, alternates: string[]) => Promise<{
        found: boolean;
        scope?: any;
        details?: any;
    }>;
    keyOf?: (account: any) => string;
    recent?: RecentFirst;
    logger?: object;
}): Promise<{
    matched: any | null;
    key: string | null;
    scope: any | null;
    details: any | null;
    attempts: {
        key: string;
        found: boolean;
        error: string | null;
    }[];
    errors: {
        key: string;
        error: string;
    }[];
}>;
/**
 * One sentence saying what a failed mapping actually means.
 *
 * "Not found on any account" and "not found, but three of four accounts
 * refused to answer" look identical in a status column and call for opposite
 * responses — re-import the master data, versus fix the sessions. Naming the
 * unreachable accounts is the whole difference.
 */
export function describeMiss(awb: any, result: any): string;
/**
 * Keeps whatever answered last time at the front of the queue.
 *
 * This is the difference between a tool that finishes and one that is
 * abandoned. A sweep is O(accounts), and for AJIO O(accounts × places of
 * business) — a company with three logins and sixty POBs is 180 requests for
 * ONE claim. But claims cluster: the rows queued together are nearly always
 * the same seller's, on the same POB, because that is how a return batch
 * arrives. So after the first row resolves, every later row hits on its first
 * or second try and the sweep collapses to roughly one request.
 *
 * Deliberately NOT persisted. It is a hint about the batch in front of it, and
 * a stale hint from last week would just be the wrong first guess.
 */
export class RecentFirst {
    seen: any[];
    /** `items`, reordered so the most recently successful keys come first. */
    order(items: any, keyOf: any): any[];
    /** Records a key that just answered, at the front. */
    remember(key: any): void;
}
