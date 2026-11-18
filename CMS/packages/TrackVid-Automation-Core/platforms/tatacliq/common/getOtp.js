// -----------------------------------------------------------------------------
// GetTataCliqOTP — fetch the most recent Tata CliQ Seller Portal OTP from Gmail
// -----------------------------------------------------------------------------
// Mirrors platforms/flipkart/common/getOtp.js, down to the `since` cutoff and
// the shared `pollForOtp`, so the two platforms cannot drift on how an OTP is
// waited for.
//
// Moved here from Automated-Scripts/services/GetTataCliqOTP.js, which kept it
// where only the server could reach it. The login lives in the core now, so its
// code source does too — and that file stays as a thin re-export, because it has
// a CLI an operator uses.
//
// Usage:
//   const { GetTataCliqOTP } = require('@trackvid/automation-core/platforms/tatacliq/common/getOtp');
//   const otp = await GetTataCliqOTP('ppmp.tataunistore@wrogn.com', { since: requestedAt });
//   // -> "129614"   or null when no matching mail has arrived
//
// `since` is not optional in practice. The portal's OTPs all share one subject,
// so without a cutoff the newest match may be the code from the LAST sign-in —
// already retired, and it fails in a way that reads like a wrong password.
// Capture `new Date()` immediately before clicking Login and pass it here.
// -----------------------------------------------------------------------------

const { fetchEmails } = require("../../../common/gmailReader");
const { pollForOtp, OTP_SHAPE } = require("../../flipkart/common/getOtp");

const SENDER = "sp.alerts@tataunistore.com";
const SUBJECT = "One Time Password (OTP) for your LOGIN on Seller Portal";

// The OTP body reads:
//   "Your One Time Password (OTP) for LOGIN on Seller Portal is 129614"
// Anchored on the surrounding phrase so a number in the boilerplate footer —
// a support line, a year — can never be read as the code.
const OTP_REGEX = /Seller Portal is\s+(\d{4,8})/i;

/**
 * The newest Tata CliQ OTP for this address, or null.
 *
 * @param {string} to the mailbox the portal sends to
 * @param {{ since?: Date, account?: object }} [options] `since` ignores mail
 *        older than that; `account` names the mailbox to read when the
 *        environment holds none — the desktop app passes the one an operator
 *        configured on their own machine, since it has no server environment.
 */
async function GetTataCliqOTP(to, { since, account } = {}) {
    if (!to) throw new Error("GetTataCliqOTP: missing 'to' email address");

    const filters = {
        from: SENDER,
        to,
        subject: SUBJECT,
        limit: 1, // newest match only
    };

    if (since) filters.since = since;

    const results = await fetchEmails(filters, account ? { account } : {});

    if (results.length === 0) return null;

    const body = (results[0].text || "") + "\n" + (results[0].html || "");
    const match = body.match(OTP_REGEX);

    return match ? match[1] : null;
}

/**
 * The `fetchOtp` a login takes, wired to this mailbox.
 *
 * Kept as a factory so `loginTataCliq` stays honest about not knowing where a
 * code comes from: the server passes this, the desktop passes its own.
 */
function gmailOtpReader({ timeoutMs, intervalMs, logger, account } = {}) {
    return (username, since, remainingMs) =>
        pollForOtp(() => GetTataCliqOTP(username, { since, account }), {
            // The login hands over what is LEFT of its own budget, so a poll
            // cannot outlive the wait it was started for.
            timeoutMs: remainingMs ?? timeoutMs,
            intervalMs,
            logger,
        });
}

/**
 * `pollForOtp` is re-exported, not just used.
 *
 * The desktop cannot read this mailbox — those IMAP credentials are a server
 * secret — so it brings its own fetch and needs only the WAITING: the same
 * interval, the same shape check, the same quiet give-up. It asked this module
 * for that, got `undefined`, and called it: "r is not a function", four
 * milliseconds into a two-minute wait, on every attempt.
 *
 * So the one module a Tata CliQ caller loads exposes both halves. Anything else
 * makes a caller reach into `platforms/flipkart` for a Tata CliQ login, which
 * is how the two drift apart in the first place.
 */
module.exports = { GetTataCliqOTP, gmailOtpReader, pollForOtp, SENDER, SUBJECT, OTP_SHAPE };
