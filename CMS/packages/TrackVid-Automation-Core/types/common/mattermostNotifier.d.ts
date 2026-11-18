export function sendMattermostNotification({ webhookUrl, title, message, status, fields, }: {
    webhookUrl: any;
    title?: string;
    message?: string;
    status?: string;
    fields?: any[];
}): Promise<void>;
/**
 * @param {Array} configArray        report jobs that actually ran
 * @param {Array} failedUsers
 * @param {Array} skippedUsers       ran, but the platform returned no data
 * @param {Array} [alreadySyncedUsers] credentials NOT run because they had
 *        already synced today. These never enter configArray — without listing
 *        them here the report silently under-reports scope, and a run where
 *        everything was skipped would look like it never happened.
 *        Shape: { username, trackVidEmail, lastSync? }
 */
export function formatSummaryTable(configArray: any[], failedUsers: any[], skippedUsers: any[], alreadySyncedUsers?: any[]): string;
/**
 * Post a message with a FILE attached, using a bot account rather than a webhook.
 *
 * A webhook cannot upload — `sendMattermostNotification` above can only post
 * text — so a report that is a spreadsheet needs the two-step Files API:
 *
 *   1. POST /api/v4/files?channel_id=…  (multipart)  -> file id
 *   2. POST /api/v4/posts { channel_id, message, file_ids }
 *
 * Credentials are PARAMETERS, never read from the environment here. The desktop
 * app posts its own bulk-claim report, and a bot token compiled into a shipped
 * binary is a token handed to every machine it is installed on — so the caller
 * passes one it fetched at runtime for the signed-in company, and this function
 * stays unopinionated about where it came from.
 *
 * Never throws. A report that could not be announced is still a report; failing
 * a completed run over its notification would be the wrong trade.
 *
 * @param {object} options
 * @param {string} options.baseUrl    e.g. https://mattermost.example.com
 * @param {string} options.token      bot account token
 * @param {string} options.channelId
 * @param {string} options.message    markdown
 * @param {string} [options.filePath] attached when present and readable
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function postMattermostFile({ baseUrl, token, channelId, message, filePath, logger }: {
    baseUrl: string;
    token: string;
    channelId: string;
    message: string;
    filePath?: string;
}): Promise<{
    ok: boolean;
    error?: string;
}>;
