// -----------------------------------------------------------------------------
// GetSnapdealOTP — fetch the most recent Snapdeal Seller OTP from Gmail
// -----------------------------------------------------------------------------
// Mirrors platforms/tatacliq/common/getOtp.js, which mirrors Flipkart's, down to
// the `since` cutoff and the shared `pollForOtp` — so the three platforms cannot
// drift on how an OTP is waited for.
//
// WHAT THIS CHANGES FOR SNAPDEAL. Its login reads the code from the BACKEND
// (`getOtpFromBackend` in claim-management/common/utils.js): a person is sent
// the mail, types it into TrackVid, and the run waits for them. That is the
// right answer when nobody can read the mailbox, and the wrong one at 02:00.
// This reads the same mail directly, so a scheduled Snapdeal login can complete
// with nobody awake. The backend path stays exactly as it is — this is another
// `fetchOtp` a caller may pass, not a replacement.
//
// Usage:
//   const { GetSnapdealOTP } = require('@trackvid/automation-core/platforms/snapdeal/common/getOtp');
//   const otp = await GetSnapdealOTP('nykaa.annex@gmail.com', { since: requestedAt });
//   // -> "835374"   or null when no matching mail has arrived
//
// `since` is not optional in practice. Every one of these mails shares one
// subject, so without a cutoff the newest match may be the code from the LAST
// sign-in — already retired, and it fails in a way that reads like a wrong
// password. Capture `new Date()` immediately before submitting the login and
// pass it here.
// -----------------------------------------------------------------------------

const { fetchEmails } = require("../../../common/gmailReader");
const { pollForOtp, OTP_SHAPE } = require("../../flipkart/common/getOtp");

// `from` is the envelope sender, not the reply-to (support@cxesnapdeal.in) —
// filtering on the reply-to matches nothing.
const SENDER = "snapdeal@sdseller.co.in";
const SUBJECT = "Snapdeal(OTP) - Your OTP details!";

/**
 * How the code is found in the body, strongest anchor first.
 *
 * ORDERED, AND TRIED IN ORDER, because an anchored match cannot pick up a
 * number from the boilerplate and an unanchored one can. The last entry is the
 * fallback for a wording not seen yet: Snapdeal has changed this mail before,
 * and a reader that returns null on a new phrasing fails a login in a way that
 * reads like a wrong password.
 *
 * The fallback is deliberately narrow — a standalone 4-8 digit run — and is
 * applied only AFTER the noise below is removed, because the body also carries
 * a validity window ("within 10 minutes") and a year.
 */
const OTP_PATTERNS = [
    /\bOTP\s*(?:is|:)\s*(\d{4,8})\b/i,
    /\bcode\s*(?:is|:)\s*(\d{4,8})\b/i,
    /\b(?:is|:)\s*(\d{6})\b/,
    /\b(\d{6})\b/,
];

/**
 * Text that would otherwise offer a plausible number to the fallback.
 *
 * "valid for 10 minutes", a year in the footer, a support number. Stripped
 * rather than excluded in the pattern, because a negative lookahead per phrase
 * becomes unreadable at the third one.
 */
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

        if (match && OTP_SHAPE.test(match[1])) return match[1];
    }

    return null;
}

/**
 * The newest Snapdeal OTP for this address, or null.
 *
 * @param {string} to the mailbox Snapdeal sends to
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none — the desktop app passes the one an operator
 *        configured on their own machine, since it has no server environment.
 */
async function GetSnapdealOTP(to, { since, account } = {}) {
    if (!to) throw new Error("GetSnapdealOTP: missing 'to' email address");

    const filters = {
        from: SENDER,
        to,
        subject: SUBJECT,
        limit: 1, // newest match only
    };

    if (since) filters.since = since;

    const results = await fetchEmails(filters, account ? { account } : {});

    if (results.length === 0) return null;

    // TEXT FIRST, then HTML. The same digits appear in both, and the HTML
    // carries style attributes and tracking URLs full of numbers — exactly what
    // the fallback pattern must never see.
    return codeIn(results[0].text) || codeIn(results[0].html);
}

/**
 * The `fetchOtp` a login takes, wired to this mailbox.
 *
 * Kept as a factory so the Snapdeal login stays honest about not knowing where
 * a code comes from: the server passes this, the desktop passes its own, and
 * the operator-typed backend path remains a third.
 */
function gmailOtpReader({ timeoutMs, intervalMs, logger, account } = {}) {
    return (username, since, remainingMs) =>
        pollForOtp(() => GetSnapdealOTP(username, { since, account }), {
            // The login hands over what is LEFT of its own budget, so a poll
            // cannot outlive the wait it was started for.
            timeoutMs: remainingMs ?? timeoutMs,
            intervalMs,
            logger,
        });
}

/**
 * `pollForOtp` is re-exported, not just used — same reason as Tata CliQ's.
 *
 * The desktop cannot read this mailbox (those IMAP credentials are a server
 * secret), so it brings its own fetch and needs only the WAITING: the same
 * interval, the same shape check, the same quiet give-up. Exposing both halves
 * here keeps a Snapdeal caller out of `platforms/flipkart`, which is how two
 * platforms drift apart in the first place.
 */
module.exports = {
    GetSnapdealOTP,
    gmailOtpReader,
    pollForOtp,
    codeIn,
    SENDER,
    SUBJECT,
    OTP_SHAPE,
};
