import { getCompaniesUsingMasterData } from "../../../../common/trackvidQueries";
export const getUsersByCompanyId: typeof getAdminUserByCompanyId;
/**
 * Stamp the sync date on the CREDENTIALS that succeeded (not the whole company).
 * See masterDataImport/utils/trackvidFunctions.js for the full rationale — one
 * company-level date meant a single failing account held back all its siblings.
 *
 * The company-level `masterDataSync` is no longer written; the field and its
 * existing values are left in place to be removed separately.
 *
 * @param {Array<{companyId: string, credentialId: string, username?: string}>} credentials
 * @param {string} [platform="SNAPDEAL"]
 */
export function updateMasterSyncDate(credentials: Array<{
    companyId: string;
    credentialId: string;
    username?: string;
}>, platform?: string, { field }?: {
    field?: string;
}): Promise<any[]>;
export function importSnapdealDataToTrackVid({ reportType, filePath, user }: {
    reportType: any;
    filePath: any;
    user: any;
}): Promise<any>;
import { getAdminUserByCompanyId } from "../../../../common/trackvidQueries";
export { getCompaniesUsingMasterData };
