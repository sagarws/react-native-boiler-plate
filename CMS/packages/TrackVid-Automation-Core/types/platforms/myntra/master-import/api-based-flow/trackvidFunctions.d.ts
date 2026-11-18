import { getCompaniesUsingMasterData } from "../../../../common/trackvidQueries";
export const getUsersByCompanyId: typeof getAdminUserByCompanyId;
export function updateMasterSyncDate(companyIds: any, platform?: string, { field }?: {
    field?: string;
}): Promise<any[]>;
export function importMyntraDataToTrackVid({ reportType, filePath, user }: {
    reportType: any;
    filePath: any;
    user: any;
}): Promise<any>;
import { getAdminUserByCompanyId } from "../../../../common/trackvidQueries";
export { getCompaniesUsingMasterData };
