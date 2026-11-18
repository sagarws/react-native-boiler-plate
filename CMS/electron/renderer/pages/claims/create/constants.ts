/**
 * The two switches TrackVid-FE's Create Claim page reads, kept at the same
 * values.
 *
 * PORTED from the web app's `helper/constant.ts`, where they are compile-time
 * flags rather than settings — flipping one is a deploy, deliberately, because
 * each changes what happens to a claim rather than how it looks.
 *
 * They are copied rather than read from the backend because the web page reads
 * them locally too, and the two surfaces must behave the same way on the same
 * day. If one of these ever becomes a company setting, it becomes one in both
 * places at once.
 */

/**
 * Does typing an AWB that already has a claim switch Save into an update?
 *
 * OFF, as on the web. The duplicate-AWB flow is not enabled there yet, and the
 * full-edit screen turns it on for itself regardless — see `updateFlowEnabled`
 * in `useCreateClaimForm`, which is what the Update Claim page passes.
 */
export const UPDATE_EXISTED_CLAIM_FROM_CMS = false

/**
 * The kill switch for "Save with Create Ticket".
 *
 * With it off the toolbar returns to one Save button and no dispatch, and
 * nothing on the backend needs redeploying: the auto-claim branch of
 * `/cms/createCMS` only ever fires on the flag the button sends.
 */
export const CLAIM_SAVE_AND_TICKET_CREATE = true
