export function getCompaniesUsingMasterData(): Promise<any>;
export const getUsersByCompanyId: typeof getAdminUserByCompanyId;
/**
 * Stamp the sync date on the CREDENTIALS that succeeded (not the whole company).
 * See masterDataImport/utils/trackvidFunctions.js for the full rationale.
 *
 * The company-level `masterDataSync` is no longer written; the field and its
 * existing values are left in place to be removed separately.
 *
 * @param {Array<{companyId: string, credentialId: string, username?: string}>} credentials
 * @param {string} [platform="MEESHO"]
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
