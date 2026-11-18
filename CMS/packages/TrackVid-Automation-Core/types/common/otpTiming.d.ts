/**
 * Thirty seconds, which is what the portals were observed to need.
 *
 * Overridable per platform (`FLIPKART_OTP_SETTLE_MS`) and globally
 * (`OTP_SETTLE_MS`) — a slow relay may want longer, and a test wants zero.
 */
export const DEFAULT_SETTLE_MS: 30000;
/**
 * How long to wait after the login click before the first mailbox read.
 *
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number} milliseconds
 */
export function otpSettleMs(platform: string, env?: NodeJS.ProcessEnv): number;
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
export function settleBeforeOtpRead(platform: string, { logger, reason, env }?: {
    logger?: object;
    reason?: string;
    env?: NodeJS.ProcessEnv;
}): Promise<number>;
