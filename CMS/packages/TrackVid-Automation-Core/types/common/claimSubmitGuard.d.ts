/**
 * DISABLE_SUBMIT=true → no claim may be submitted.
 *
 * `DESABLE_SAVE` came first (with its typo) and `DISABLE_SAVE` was added as an
 * alias; both are still honoured so no existing deployment changes behaviour.
 * `DISABLE_SUBMIT` is the name to use — it says what it stops, where "save"
 * reads like it is about storing something locally.
 *
 * Read on EVERY call, never cached, so setting it and running is enough.
 *
 * FAILS SAFE: only the exact string "true" (any casing) disables submission. A
 * typo, an empty value or an unset variable all mean "file the claim" — the
 * behaviour every deployment already has.
 */
export function isClaimSubmitDisabled(): boolean;
/** Tagged error for the throw-based flows (Flipkart, Myntra, Snapdeal, ...). */
export function claimSubmitDisabledError(platform: any, action?: string): Error;
/**
 * Throw-based guard. Call it as the first statement of a submit function:
 *   assertClaimSubmitEnabled("Flipkart", "'Submit Claim' click");
 */
export function assertClaimSubmitEnabled(platform: any, action?: string): void;
/** Return-based guard for the never-throw AJIO claim flows. */
export function claimSubmitDisabledResult(platform: any, action?: string, extra?: {}): {
    status: string;
    message: string;
};
