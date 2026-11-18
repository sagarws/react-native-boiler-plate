/**
 * The newest Cloudflare Access code for this address, or null.
 *
 * @param {string} [to] the mailbox Cloudflare sends to; defaults to DEFAULT_TO
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none.
 */
export function GetCloudflareOTP(to?: string, { since, account }?: {
    since?: Date;
    account?: object;
}): Promise<string>;
/**
 * The `fetchOtp` a login takes, wired to this mailbox — the same factory
 * getOtp.js offers, so a caller swaps one for the other without reshaping.
 */
export function cloudflareOtpReader({ timeoutMs, intervalMs, logger, account }?: {}): (email: any, since: any, remainingMs: any) => Promise<string>;
/**
 * The code in one mail, or null.
 *
 * Exported for tests: the regexes are the part most likely to break when
 * Cloudflare rewords the mail.
 */
export function extractCloudflareOtp(mail: any): string;
import { pollForOtp } from "../../flipkart/common/getOtp";
export const SENDER: "noreply@notify.cloudflare.com";
export const SUBJECT: "Cloudflare Access login code for sellerzone.tatacliq.com";
/** The mailbox the Access codes are sent to when the credential names none. */
export const DEFAULT_TO: "jyothi@wrogn.com";
import { OTP_SHAPE } from "../../flipkart/common/getOtp";
export { pollForOtp, OTP_SHAPE };
