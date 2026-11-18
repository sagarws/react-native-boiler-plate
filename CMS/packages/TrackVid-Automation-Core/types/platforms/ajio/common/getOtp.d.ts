/**
 * The newest AJIO OTP for this address, or null.
 *
 * @param {string} to the mailbox the portal sends to
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none — the desktop app passes its own.
 */
export function GetAjioOTP(to: string, { since, account }?: {
    since?: Date;
    account?: object;
}): Promise<string>;
import { pollForOtp } from "../../flipkart/common/getOtp";
export function codeIn(body: any): string;
export const SENDER: "no-reply_sellercentral@ril.com";
export const SUBJECT: "OTP AUTHENTICATION";
import { OTP_SHAPE } from "../../flipkart/common/getOtp";
export { pollForOtp, OTP_SHAPE };
