export namespace MFA {
    let form: string;
    let input: string;
    let submit: string;
    let resend: string;
}
/** Is the SSO showing its one-time-code challenge right now? Never throws. */
export function isOnAjioMfaPage(page: any): Promise<any>;
/**
 * Answer the challenge the page is showing.
 *
 * @param {object} page a Puppeteer page sitting on the MFA form
 * @param {string} username the AJIO login — the mailbox address to read
 * @param {object} [options]
 * @param {(to: string, since: Date, timeoutMs?: number) => Promise<string|null>|null} [options.fetchOtp]
 *        where to read the code; undefined → `defaultAjioOtpReader()`, null →
 *        no reader (the challenge cannot be answered).
 * @param {Date}   [options.since] ignore mail older than this (stamp it before
 *        the password submit).
 * @param {number} [options.mailDelayMs=0] wait this long before the first read.
 * @param {number} [options.resends=0] on a refused code, "Resend code" and try
 *        the new one, up to this many times.
 * @param {number} [options.mailTimeoutMs] how long to wait for each mail;
 *        default AJIO_OTP_MAIL_TIMEOUT_MS or 60s.
 * @param {string} [options.portalUrl] the AJIO seller portal to continue to
 *        when the SSO ends on Reliance Seller Central (see ./salesChannel.js).
 * @param {object} [options.logger]
 * @returns {Promise<{ ok: true } | { ok: false, reasonText: string }>} never
 *          throws for a mail or portal problem; `reasonText` starts `OTP_REQUIRED:`.
 */
export function answerAjioMfa(page: object, username: string, options?: {
    fetchOtp?: (to: string, since: Date, timeoutMs?: number) => Promise<string | null> | null;
    since?: Date;
    mailDelayMs?: number;
    resends?: number;
    mailTimeoutMs?: number;
    portalUrl?: string;
    logger?: object;
}): Promise<{
    ok: true;
} | {
    ok: false;
    reasonText: string;
}>;
/**
 * The mailbox reader used when the caller names none — the server's own
 * (GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD), exactly as Snapdeal's default.
 * Null where that environment is absent: the desktop app brings its own.
 */
export function defaultAjioOtpReader(): (to: any, since: any) => Promise<string>;
