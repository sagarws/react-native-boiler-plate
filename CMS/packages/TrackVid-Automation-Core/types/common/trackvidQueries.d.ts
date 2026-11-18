/**
 * The one admin user for a company, or null. Used as the TrackVid identity that
 * an import is attributed to.
 */
export function getAdminUserByCompanyId(companyId: any): Promise<any>;
/**
 * Every company with settings.isUsingMasterData, with unverified credentials
 * stripped out in place.
 */
export function getCompaniesUsingMasterData(logger?: import("pino").Logger<never, boolean>): Promise<any>;
