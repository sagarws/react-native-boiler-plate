/**
 * Selectors in confidence order. Each is a plain CSS selector so it works in
 * Selenium (`By.css`) and Puppeteer (`$$`) alike.
 *
 *  1. the semantic class these controls almost always carry
 *  2. the accessible name — screen readers need it, so it survives redesigns
 *     that drop everything else
 *  3. the wrapper, for markup that only labels the container
 *  4. STRUCTURAL: single-character inputs. No names at all.
 */
export const OTP_SELECTORS: string[];
/** A run this short is a date field or a PIN-ish input, not a one-time code. */
export const MIN_BOXES: 4;
/** Longer than this and it is not an OTP control. */
export const MAX_BOXES: 8;
/**
 * The probe as a standalone expression.
 *
 * Puppeteer: `page.evaluate(otpProbeExpression())`
 * Selenium:  `driver.executeScript('return ' + otpProbeExpression())`
 */
export function otpProbeExpression(): string;
/**
 * Counts visible one-time-code inputs on the page.
 *
 * Runs entirely in the page so it costs one round trip however many selectors
 * are tried, and so visibility is judged by the browser rather than inferred.
 *
 * @param {(script: string) => Promise<any>} evaluate  page.evaluate / executeScript
 * @returns {Promise<{ count: number, matchedBy: string|null }>}
 */
export function countOtpInputs(evaluate: (script: string) => Promise<any>): Promise<{
    count: number;
    matchedBy: string | null;
}>;
/**
 * Waits for a one-time-code box to appear.
 *
 * `timeoutMs` is generous by default: the modal shows only after the portal has
 * actually sent the code, which is a round trip to an SMS or mail gateway. The
 * old 8-second window was shorter than that gateway on a slow day, so a modal
 * that was about to appear was reported as "no OTP modal" and the sign-in
 * carried on as though it had succeeded.
 *
 * @returns {Promise<{ found: boolean, count: number, matchedBy: string|null }>}
 */
export function waitForOtpInputs(evaluate: any, { timeoutMs, pollMs }?: {
    timeoutMs?: number;
    pollMs?: number;
}): Promise<{
    found: boolean;
    count: number;
    matchedBy: string | null;
}>;
