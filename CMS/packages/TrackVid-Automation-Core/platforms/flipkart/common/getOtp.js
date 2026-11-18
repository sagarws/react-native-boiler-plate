// -----------------------------------------------------------------------------
// GetFlipKartOTP — fetch the most recent Flipkart Seller OTP from Gmail.
// -----------------------------------------------------------------------------
// Uses fetchEmails() from ../gmail-reader.js to search the authenticated Gmail
// inbox for the latest OTP mail from Flipkart (noreply@rmo.flipkart.com)
// addressed to the given recipient, then extracts the 6-digit code.
//
// Usage (as a service):
//   const { GetFlipKartOTP } = require('@trackvid/automation-core/platforms/flipkart/common/getOtp');
//   const otp = await GetFlipKartOTP('manjunath@wrogn.com');
//   // -> "896845"   (string)   or null if no matching email found
//
// Optional { since: Date } cutoff filters out OTP mails older than the given
// timestamp — pass `new Date()` captured just before triggering a new OTP so
// a stale code from a previous session is never returned.
//
// CLI:
//   node services/GetFlipKartOTP.js manjunath@wrogn.com
// -----------------------------------------------------------------------------

const { fetchEmails } = require("../../../common/gmailReader");

const SENDER = "noreply@rmo.flipkart.com";

// What a usable code looks like. One definition, so the two runners cannot
// disagree about whether something is one.
const OTP_SHAPE = /^\d{4,8}$/;
const SUBJECT = "is your verification code for secure access";

// The OTP body reads:
//   "Your OTP: 896845"
// Anchor on the surrounding phrase so we don't accidentally match some other
// number sequence in the boilerplate footer.
const OTP_REGEX = /Your OTP:\s*(\d{4,8})/i;

/**
 * @param {string} to the mailbox the portal sends to
 * @param {{ since?: Date, account?: object }} [options] `account` names the
 *        mailbox to read when the environment holds none — the desktop app
 *        passes the one an operator configured on their own machine.
 */
async function GetFlipKartOTP(to, { since, account } = {}) {
    if (!to) throw new Error("GetFlipKartOTP: missing 'to' email address");

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
async function pollForOtp(fetchOnce, { timeoutMs = 90000, intervalMs = 3000, schedule = null, retryOnError = true, logger = console } = {}) {
    const deadline = Date.now() + timeoutMs;
    const scheduled = Array.isArray(schedule) && schedule.length > 0;
    let attempt = 0;

    while (Date.now() < deadline) {
        if (scheduled) {
            const wait = schedule[Math.min(attempt, schedule.length - 1)];

            // Capped by what is left, and the read still happens at the end:
            // the last moment of the budget is worth one more look.
            await new Promise((resolve) => setTimeout(resolve, Math.min(wait, Math.max(0, deadline - Date.now()))));
        }

        attempt++;

        try {
            const otp = await fetchOnce(attempt);

            if (otp && OTP_SHAPE.test(String(otp))) return String(otp);
        } catch (err) {
            logger.warn?.(`    ⚠️  OTP fetch attempt ${attempt} errored: ${err.message}`);

            if (!retryOnError) return null;
        }

        if (!scheduled) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return null;
}

module.exports = { GetFlipKartOTP, pollForOtp, OTP_SHAPE };

// CLI usage: `node services/GetFlipKartOTP.js <to-address>`
if (require.main === module) {
    const to = "manjunath@wrogn.com";
    GetFlipKartOTP(to)
        .then((otp) => {
            if (otp) console.log(otp);
            else { console.log("null"); process.exitCode = 1; }
        })
        .catch((err) => {
            console.error("GetFlipKartOTP failed:", err.message);
            process.exitCode = 1;
        });
}
