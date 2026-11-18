/**
 * The newest Tata CliQ OTP for this address, or null.
 *
 * @param {string} to the mailbox the portal sends to
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none — the desktop app passes the one an operator
 *        configured on their own machine, since it has no server environment.
 */
export function GetTataCliqOTP(to: string, { since, account }?: {
    since?: Date;
    account?: object;
}): Promise<string>;
/**
 * The `fetchOtp` a login takes, wired to this mailbox.
 *
 * Kept as a factory so `loginTataCliq` stays honest about not knowing where a
 * code comes from: the server passes this, the desktop passes its own.
 */
export function gmailOtpReader({ timeoutMs, intervalMs, logger, account }?: {}): (username: any, since: any, remainingMs: any) => Promise<string>;
import { pollForOtp } from "../../flipkart/common/getOtp";
export const SENDER: "sp.alerts@tataunistore.com";
export const SUBJECT: "One Time Password (OTP) for your LOGIN on Seller Portal";
import { OTP_SHAPE } from "../../flipkart/common/getOtp";
export { pollForOtp, OTP_SHAPE };
