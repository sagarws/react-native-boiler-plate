/**
 * Every HQ client this access token is allowed to act on, as bare uuids.
 * Empty array when the claim is absent (single-client legacy accounts).
 */
export function allowedHqClients(accessToken: any): string[];
export function companyIdFromToken(accessToken: any): any;
export function decodeJwtPayload(token: any): any;
export function normalizeHqClientId(entry: any): string;
export function probeHqClient(ctx: any, hqClientId: any): Promise<{
    ok: boolean;
    status: any;
    error?: undefined;
} | {
    ok: boolean;
    status: any;
    error: any;
}>;
/**
 * Resolve the `x-hq-client-id` for this session.
 *
 * @param {object} ctx      session ctx — needs accessToken/tokenType, and
 *                          hqClientId when one was already cached
 * @param {object} opts
 * @param {string} opts.username  for log lines
 * @returns {Promise<{hqClientId: string|null, source: string, candidates: string[]}>}
 */
export function resolveHqClientId(ctx: object, { username }?: {
    username: string;
}): Promise<{
    hqClientId: string | null;
    source: string;
    candidates: string[];
}>;
export const CLIENT_URN_PREFIX: "cms::client::";
