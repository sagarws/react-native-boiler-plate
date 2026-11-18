/**
 * @param {object}  cred
 * @param {string}  cred.companyId
 * @param {string}  cred.username        the AJIO login that failed
 * @param {string} [cred.trackVidEmail]  admin email; looked up when omitted
 * @param {string} [cred.platform]       defaults to "AJIO"
 * @param {object} [logger]              pino-style; falls back to console
 */
export function unverifyAjioCredential({ companyId, username, trackVidEmail, platform }?: {
    companyId: string;
    username: string;
    trackVidEmail?: string;
    platform?: string;
}, logger?: object): Promise<void>;
