/**
 * Fetch all companies that have opted into AJIO ticket auto-download.
 * Mirrors getCompaniesUsingMasterData but keyed on settings.<TICKET_COMPANY_FLAG>.
 */
export function getCompaniesUsingTicketAutoFetch(): Promise<any>;
/**
 * Fetch companies that have an AJIO login matching any of `usernames`.
 * Used by the TICKET_ONLY_USERNAMES test override to run a specific short list
 * (e.g. one normal + one enterprise account) without setting any opt-in flag.
 */
export function getCompaniesByAjioUsernames(usernames: any): Promise<any>;
/**
 * The admin user of a company — used as the TrackVid uploader identity.
 */
export function getAdminUserByCompanyId(companyId: any): Promise<any>;
/**
 * Upload a downloaded AJIO ticket report to TrackVid by calling BOTH bulk-status
 * APIs, one after the other, with the same .xlsx:
 *   1) POST /cms/bulk-status-update
 *   2) POST /master/bulk-status-update-return-dispute
 * Both take multipart { marketplace, file } and identify the company from the
 * bearer token (the company admin's accessToken). The file is deleted only if
 * BOTH calls succeed; otherwise it is kept on disk for retry.
 */
export function uploadTicketReportToTrackVid(filePath: any, user: any): Promise<{
    uploaded: boolean;
    skipped: boolean;
    filePath: any;
    error?: undefined;
    counts?: undefined;
} | {
    uploaded: boolean;
    error: string;
    skipped?: undefined;
    filePath?: undefined;
    counts?: undefined;
} | {
    uploaded: boolean;
    counts: {
        cms: {
            ok: any;
            updated: any;
            notFound: any;
            error: any;
        };
        rd: {
            ok: any;
            updated: any;
            notFound: any;
            error: any;
        };
    };
    skipped?: undefined;
    filePath?: undefined;
    error?: undefined;
} | {
    uploaded: boolean;
    counts: {
        cms: {
            ok: any;
            updated: any;
            notFound: any;
            error: any;
        };
        rd: {
            ok: any;
            updated: any;
            notFound: any;
            error: any;
        };
    };
    error: string;
    skipped?: undefined;
    filePath?: undefined;
}>;
