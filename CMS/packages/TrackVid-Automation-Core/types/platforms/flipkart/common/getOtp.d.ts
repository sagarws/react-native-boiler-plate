/**
 * @param {string} to the mailbox the portal sends to
 * @param {{ since?: Date, account?: object }} [options] `account` names the
 *        mailbox to read when the environment holds none — the desktop app
 *        passes the one an operator configured on their own machine.
 */
export function GetFlipKartOTP(to: string, { since, account }?: {
    since?: Date;
    account?: object;
}): Promise<string>;
/**
 * Poll for a one-time code until one arrives or the budget runs out.
 *
 * WHERE THE CODE COMES FROM IS THE CALLER'S PROBLEM — and it has to be, because
 * the two runners cannot get it the same way. The automation server reads this
 * mailbox over IMAP with credentials from its own environment. The desktop app
 * has two routes and prefers the first: a mailbox an operator configured on
 * that machine (read through the same `GetFlipKartOTP`, with `account`), and
 * otherwise a relay through TrackVid to the server. What it must never do is
 * ship the server's shared mailbox password in the build.
 *
 * What IS the same on both sides is everything around that call: wait for a mail
 * that has not arrived yet, accept only something that looks like a code, and
 * give up quietly rather than throwing — because null is what lets a login fall
 * back to asking a person instead of failing a claim over a slow email. That
 * shape was written twice, with two different intervals, which is how the two
 * quietly stop behaving alike.
 *
 * @param {() => Promise<string|null>} fetchOnce  one attempt
 * @param {object} [options]
 * @param {boolean} [options.retryOnError=true] keep polling when an attempt
 *        throws. True for a mailbox read, where a transient IMAP error says
 *        nothing about whether the mail exists. False for a caller whose
 *        failure is structural — a relay that is down will still be down in
 *        three seconds, and eighteen more attempts only delay reaching a human.
 * @param {number[]} [options.schedule] the wait BEFORE each attempt, in ms; the
 *        last entry repeats. `[20000, 20000, 20000, 15000]` reads at 20s, 40s,
 *        60s, then every 15s. Without it the first read is immediate and the
 *        rest are `intervalMs` apart — exactly as before.
 * @returns {Promise<string|null>} null means "nothing arrived"
 */
export function pollForOtp(fetchOnce: () => Promise<string | null>, { timeoutMs, intervalMs, schedule, retryOnError, logger }?: {
    retryOnError?: boolean;
    schedule?: number[];
}): Promise<string | null>;
export const OTP_SHAPE: RegExp;
