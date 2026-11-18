export function getCompaniesUsingMasterData(): Promise<any>;
export const getUsersByCompanyId: typeof getAdminUserByCompanyId;
/**
 * Stamp the sync date on the CREDENTIALS that actually succeeded.
 *
 * Replaces the old company-level `masterDataSync.ajio`. That single date meant one
 * failing account held back every other account in the same company — 4 healthy
 * logins re-pulled 89 days of history because the 5th failed. Each credential now
 * carries its own `masterDataSync`, so accounts advance independently.
 *
 * Targets the sub-document via arrayFilters:
 *   settings.eCommercePlatformLoginInfo.$[plat].info.$[acc].masterDataSync
 * matching the credential by its own _id — usernames are not unique across
 * platforms, and a company can hold the same login under two marketplaces.
 *
 * The company-level `masterDataSync` is intentionally NOT written any more. The
 * field and its existing values are left untouched (to be removed separately).
 *
 * `field` picks the credential field to stamp — `masterDataSync` by default.
 * The server passes `serverMasterDataSync`: the desktop app stamps
 * `masterDataSync` (through TrackVid-BE) for its own runs, and one shared field
 * meant whichever runner went first made the other skip the credential as
 * "already synced today". The meesho/snapdeal/myntra writers take the same option.
 *
 * @param {Array<{companyId: string, credentialId: string, username?: string}>} credentials
 * @param {string} [platform="AJIO"]  matched case-insensitively against eComPlatform
 */
export function updateMasterSyncDate(credentials: Array<{
    companyId: string;
    credentialId: string;
    username?: string;
}>, platform?: string, { field }?: {
    field?: string;
}): Promise<any[]>;
export function importMasterDataToTrackVid(reportType: any, filePath: any, user: any): Promise<any>;
import { getAdminUserByCompanyId } from "../../../../common/trackvidQueries";
