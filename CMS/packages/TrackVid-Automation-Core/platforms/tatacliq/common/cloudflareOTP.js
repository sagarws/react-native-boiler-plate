// -----------------------------------------------------------------------------
// GetCloudflareOTP — fetch the most recent Cloudflare Access code for the
// Tata CliQ seller zone from Gmail
// -----------------------------------------------------------------------------
// sellerzone.tatacliq.com sits behind Cloudflare Access, which mails a one-time
// code before the portal's own login is even reached. Same shape as getOtp.js
// beside it — the `since` cutoff and the shared `pollForOtp` — so the two codes
// a Tata CliQ sign-in needs are waited for the same way.
//
// Usage:
//   const { GetCloudflareOTP } = require('@trackvid/automation-core/platforms/tatacliq/common/cloudflareOTP');
//   const otp = await GetCloudflareOTP(undefined, { since: requestedAt });
//   // -> "341131"   or null when no matching mail has arrived
//
// `since` matters for the same reason as on the portal: every one of these
// mails shares one subject, and a code is retired the moment a new one is
// requested. Capture `new Date()` immediately before asking for the code.
// -----------------------------------------------------------------------------

const { fetchEmails } = require("../../../common/gmailReader");
const { pollForOtp, OTP_SHAPE } = require("../../flipkart/common/getOtp");

const SENDER = "noreply@notify.cloudflare.com";
const SUBJECT = "Cloudflare Access login code for sellerzone.tatacliq.com";

/** The mailbox the Access codes are sent to when the credential names none. */
const DEFAULT_TO = "jyothi@wrogn.com";

// The mail carries the code twice:
//   preview  "Your login code: 313498 Your Cloudflare Access code 313498 …"
//   body     "Your Cloudflare Access code" … "341131"
// Anchored on those phrases so a number in the footer — the postal address,
// a year — can never be read as the code. HTML is stripped of tags first,
// because the body puts the label and the code in separate elements.
const OTP_REGEXES = [/Cloudflare Access code\s*:?\s*(\d{6})\b/i, /login code\s*:?\s*(\d{6})\b/i];

/** Mail text with tags and entities flattened to spaces, so the label and the code are adjacent. */
const plainText = (mail) =>
    `${mail.text || ""}\n${mail.html || ""}`
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/\s+/g, " ");

/**
 * The code in one mail, or null.
 *
 * Exported for tests: the regexes are the part most likely to break when
 * Cloudflare rewords the mail.
 */
function extractCloudflareOtp(mail) {
    const body = plainText(mail || {});

    for (const regex of OTP_REGEXES) {
        const match = body.match(regex);

        if (match) return match[1];
    }

    return null;
}

/**
 * The newest Cloudflare Access code for this address, or null.
 *
 * @param {string} [to] the mailbox Cloudflare sends to; defaults to DEFAULT_TO
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none.
 */
async function GetCloudflareOTP(to = DEFAULT_TO, { since, account } = {}) {
    const filters = {
        from: SENDER,
        to: to || DEFAULT_TO,
        subject: SUBJECT,
        limit: 1, // newest match only
    };

    if (since) filters.since = since;

    const results = await fetchEmails(filters, account ? { account } : {});

    if (results.length === 0) return null;

    return extractCloudflareOtp(results[0]);
}

/**
 * The `fetchOtp` a login takes, wired to this mailbox — the same factory
 * getOtp.js offers, so a caller swaps one for the other without reshaping.
 */
function cloudflareOtpReader({ timeoutMs, intervalMs, logger, account } = {}) {
    return (email, since, remainingMs) =>
        pollForOtp(() => GetCloudflareOTP(email || DEFAULT_TO, { since, account }), {
            // What is LEFT of the caller's budget, so a poll cannot outlive the
            // wait it was started for.
            timeoutMs: remainingMs ?? timeoutMs,
            intervalMs,
            logger,
        });
}

module.exports = {
    GetCloudflareOTP,
    cloudflareOtpReader,
    extractCloudflareOtp,
    pollForOtp,
    SENDER,
    SUBJECT,
    DEFAULT_TO,
    OTP_SHAPE,
};
