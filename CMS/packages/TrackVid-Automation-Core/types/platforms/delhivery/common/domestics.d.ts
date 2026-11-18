/**
 * Every Domestic account this session can act on.
 *
 * Uses the session's access token as-is. On a 401 with a refresh token at hand
 * it refreshes ONCE and retries — the token lives ten minutes, and a caller
 * reading a stored session may well hold an expired one. The refreshed tokens
 * come back as `refreshed` so the caller can store them; this function never
 * writes anywhere.
 *
 * @param {object} ctx  a Delhivery session context — accessToken, tokenType,
 *                      and for the refresh: refreshToken, realm, clientId
 * @returns {Promise<{ domestics: {id: string, name: string, serviceType: string|null}[],
 *                     refreshed: object|null }>}
 * @throws when the gateway refuses the session or answers anything but 200
 */
export function listDelhiveryDomestics(ctx: object): Promise<{
    domestics: {
        id: string;
        name: string;
        serviceType: string | null;
    }[];
    refreshed: object | null;
}>;
/**
 * One gateway row → a Domestic entry, or null when it is not one a claim can use.
 *
 * Pure, exported for tests.
 */
export function domesticFromMapping(row: any): {
    id: string;
    name: string;
    serviceType: string;
};
export const LIST_URL: "https://ucp-app-gateway.delhivery.com/web/api/company/configurations/list_client_mappings";
