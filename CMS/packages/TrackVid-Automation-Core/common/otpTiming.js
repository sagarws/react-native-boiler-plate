// -----------------------------------------------------------------------------
// How long to leave a one-time code alone before reading the mailbox
// -----------------------------------------------------------------------------
// A login that answers an OTP has two clocks running against each other: the
// portal's, which retires the previous code the moment it issues a new one, and
// the mailbox's, which delivers the new one seconds to half a minute later.
// Read too early and the freshest mail in the box is still the OLD code — so
// the automation types a retired code, the portal refuses it, and the failure
// looks like a wrong password or a flaky portal rather than a race.
//
// THE CUTOFF IS NOT ENOUGH ON ITS OWN. Every reader here filters by "arrived
// after the login click", which is the right rule and still loses: the
// timestamp compared is the mail's own Date header, written by the sending
// server, and a minute of clock skew between that server and this machine puts
// a retired code on the safe side of the line. Waiting first makes the race
// much harder to lose, and costs nothing that was not already going to be spent
// polling.
//
// Shared because the hazard is shared: Flipkart mails a code and Tata CliQ
// mails a code, and a delay tuned on one platform and forgotten on the other is
// exactly the kind of drift a common/ file exists to prevent. Snapdeal is
// deliberately absent — its OTP is typed by a person, so there is no mailbox
// read to be early.
// -----------------------------------------------------------------------------

/**
 * Thirty seconds, which is what the portals were observed to need.
 *
 * Overridable per platform (`FLIPKART_OTP_SETTLE_MS`) and globally
 * (`OTP_SETTLE_MS`) — a slow relay may want longer, and a test wants zero.
 */
const DEFAULT_SETTLE_MS = 30_000;

const asMs = (value) => {
    const parsed = Number(value);

    // `0` is a legitimate answer — "do not wait" — so only a value that is not
    // a number at all falls through to the next source.
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * How long to wait after the login click before the first mailbox read.
 *
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number} milliseconds
 */
function otpSettleMs(platform, env = process.env) {
    const key = String(platform || "").trim().toUpperCase();

    return (
        asMs(env[`${key}_OTP_SETTLE_MS`]) ??
        asMs(env.OTP_SETTLE_MS) ??
        DEFAULT_SETTLE_MS
    );
}

/**
 * Wait it out, saying so.
 *
 * The log line matters: a login that sits silent for half a minute after the
 * password looks stuck, and the next person to read the log should not have to
 * find this file to learn that the pause is deliberate.
 *
 * @param {string} platform
 * @param {{ logger?: object, reason?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<number>} how long was actually waited
 */
async function settleBeforeOtpRead(platform, { logger, reason = "", env } = {}) {
    const ms = otpSettleMs(platform, env);

    if (ms <= 0) return 0;

    const say = logger?.info?.bind(logger) || console.log;

    say(
        `    ⏳ Waiting ${Math.round(ms / 1000)}s for the fresh ${platform} code to land` +
        `${reason ? ` (${reason})` : ""} — reading sooner returns the one that was just retired`
    );

    await new Promise((resolve) => setTimeout(resolve, ms));

    return ms;
}

module.exports = { DEFAULT_SETTLE_MS, otpSettleMs, settleBeforeOtpRead };
