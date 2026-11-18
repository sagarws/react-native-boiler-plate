// -----------------------------------------------------------------------------
// GetAjioOTP — fetch the most recent AJIO (Reliance Retail SSO) OTP from Gmail
// -----------------------------------------------------------------------------
// Mirrors platforms/snapdeal/common/getOtp.js, down to the `since` cutoff and
// the shared `pollForOtp`, so the platforms cannot drift on how an OTP is
// waited for.
//
// WHY AJIO NEEDS THIS. Some AJIO accounts are challenged after the password:
// the Reliance SSO renders `form#mfaForm` ("Verify your identity") and mails
// the SAME code to every verified channel (email + mobile, one requestId). The
// mail is readable, so a sign-in on a machine with the mailbox can answer it.
//
// Usage:
//   const { GetAjioOTP } = require('@trackvid/automation-core/platforms/ajio/common/getOtp');
//   const otp = await GetAjioOTP('seller@example.com', { since: requestedAt });
//   // -> "704662"   or null when no matching mail has arrived
//
// `since` is not optional in practice. Every one of these mails shares one
// subject, so without a cutoff the newest match may be the code from the LAST
// sign-in — already retired. Capture `new Date()` immediately before
// submitting the password and pass it here.
// -----------------------------------------------------------------------------

const { fetchEmails } = require("../../../common/gmailReader");
const { pollForOtp, OTP_SHAPE } = require("../../flipkart/common/getOtp");

// Seen on a real challenge (2026-10): envelope sender and subject of the
// "Reliance Retail Seller Central" mail.
const SENDER = "no-reply_sellercentral@ril.com";
const SUBJECT = "OTP AUTHENTICATION";

/**
 * How the code is found in the body, strongest anchor first.
 *
 * The mail reads "Your OTP Code  704662  Expires in 10 minutes". The template
 * sets the digits with letter-spacing, and a text rendering of it can come out
 * as "7 0 4 6 6 2" — so the anchored patterns accept single spaces between
 * digits and the match is collapsed before the shape check.
 *
 * The last entry is the fallback for a wording not seen yet, applied only
 * AFTER the noise below is removed (the validity window, a year).
 */
const OTP_PATTERNS = [
    /\bOTP\s*Code\s*:?\s*(\d(?: ?\d){3,7})\b/i,
    /\bOTP\s*(?:is|:)\s*(\d(?: ?\d){3,7})\b/i,
    /\bcode\s*(?:is|:)\s*(\d{4,8})\b/i,
    /\b(\d{6})\b/,
];

const NOISE = [
    /\b\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|seconds?|secs?)\b/gi,
    /\b(?:19|20)\d{2}\b/g,
    /\+?\d{2,4}[-\s]?\d{6,}/g,
];

function codeIn(body) {
    let text = String(body || "");

    for (const pattern of NOISE) text = text.replace(pattern, " ");

    for (const pattern of OTP_PATTERNS) {
        const match = text.match(pattern);
        const code = match ? match[1].replace(/\s+/g, "") : null;

        if (code && OTP_SHAPE.test(code)) return code;
    }

    return null;
}

/**
 * The newest AJIO OTP for this address, or null.
 *
 * @param {string} to the mailbox the portal sends to
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none — the desktop app passes its own.
 */
async function GetAjioOTP(to, { since, account } = {}) {
    if (!to) throw new Error("GetAjioOTP: missing 'to' email address");

    const filters = {
        from: SENDER,
        to,
        subject: SUBJECT,
        limit: 1, // newest match only
    };

    if (since) filters.since = since;

    const results = await fetchEmails(filters, account ? { account } : {});

    if (results.length === 0) return null;

    // TEXT FIRST, then HTML — the HTML carries style attributes and tracking
    // URLs full of numbers, exactly what the fallback pattern must never see.
    return codeIn(results[0].text) || codeIn(results[0].html);
}

/**
 * `pollForOtp` is re-exported so an AJIO caller never reaches into
 * `platforms/flipkart` itself — same reason as Snapdeal's and Tata CliQ's.
 */
module.exports = {
    GetAjioOTP,
    pollForOtp,
    codeIn,
    SENDER,
    SUBJECT,
    OTP_SHAPE,
};
