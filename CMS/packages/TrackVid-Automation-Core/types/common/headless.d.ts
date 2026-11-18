/**
 * True when the browser should run with no visible window.
 *
 * @param {string} [platform] applies that platform's override and policy
 */
export function isHeadless(platform?: string): boolean;
/**
 * Headless setting for one launch.
 *
 * @param {{ requiresDisplay?: boolean, label?: string }} [options]
 *   requiresDisplay  this login cannot work without a visible window; the
 *                    setting is overridden and the reason is logged once,
 *                    because failing invisibly is worse than ignoring a flag.
 */
export function resolveHeadless(options?: {
    requiresDisplay?: boolean;
    label?: string;
}): boolean;
/**
 * @param {string} platform
 * @param {boolean} enabled  false = a human signs in, so the window is shown
 */
export function setAutoLoginEnabled(platform: string, enabled: boolean): void;
/** Forget every policy. For tests, and for a sign-out that changes company. */
export function clearAutoLoginPolicy(): void;
/** Does a person have to complete this platform's sign-in themselves? */
export function manualLoginRequired(platform: any): boolean;
