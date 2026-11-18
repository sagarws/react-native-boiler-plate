/**
 * Reason for QC failure — the `qcFailCIR` select, in the portal's own order.
 *
 * The portal's first option is the "--Please Select--" placeholder with value
 * "select". It is deliberately absent: it is not a reason, and sending it is
 * how a claim gets filed under nothing.
 */
export const QC_REASONS: {
    code: string;
    label: string;
}[];
/**
 * Sub-reasons, per reason.
 *
 * One reason, four options — the four that were in the DOM when the capture was
 * taken with Wrong Product selected, and the only reason that has a list at all.
 */
export const QC_SUB_REASONS: {
    "10": {
        code: string;
        label: string;
    }[];
};
/**
 * The ONLY reason that takes a sub-reason: 10, Wrong Product.
 *
 * Operator-confirmed (2026-09-17). Expressed as the short list rather than its
 * inverse because that is the fact — eleven of the twelve reasons say
 * everything the portal wants on their own, and inverting it would mean every
 * new reason silently joining the wrong side.
 *
 * The sub-reason select is repopulated by the page's own `qcFailCIRs()` handler
 * when the reason changes; for every reason but this one it is left empty, so
 * sending a sub-reason with them is sending a value the portal never sends.
 */
export const REASONS_WITH_SUB_REASON: Set<string>;
/**
 * Reasons that need NO packaging or unboxing video.
 *
 * Operator-confirmed (2026-09-17). These are the six where the damage or the
 * discrepancy is evident from the photographs alone — a sealed box, a missing
 * box, a price mismatch — so the portal does not ask for footage. The other six
 * do: the video is how "used", "wrong" or "partial" is argued.
 *
 * Not enforced on the request (the portal accepts the submit either way), which
 * is exactly why it is recorded: a claim that skips a video the reviewer expects
 * is rejected days later by a human.
 */
export const REASONS_WITHOUT_VIDEO: Set<string>;
/**
 * The six image slots the modal offers, in the order the portal numbers them.
 *
 * `imagesList` on the submit is the upload responses joined by commas, and each
 * upload answers with `{transId}_{n}.png` — so the slot is POSITIONAL. Slot 1
 * is the product image whether or not anything was put in slot 4.
 *
 * `required` mirrors the modal's own asterisks. The portal does not enforce
 * them on the request, which is exactly why they are recorded here: a claim
 * missing its packing slip is refused by a human reviewer days later.
 */
export const IMAGE_SLOTS: {
    slot: number;
    key: string;
    label: string;
    required: boolean;
}[];
/**
 * The two videos, which are NOT uploaded.
 *
 * The portal takes them as URLs it fetches itself — the capture's were TrackVid
 * S3 links — so a claim can attach video without this ever holding the file.
 */
export const VIDEO_FIELDS: {
    key: string;
    param: string;
    label: string;
}[];
/** Does this reason take a sub-reason at all? Only Wrong Product does. */
export function needsSubReason(reasonCode: any): boolean;
/** Does a claim under this reason want the two videos? */
export function needsVideo(reasonCode: any): boolean;
/** The sub-reasons for one reason. Empty when it takes none, or none is known. */
export function subReasonsFor(reasonCode: any): any;
/**
 * Is this reason + sub-reason pair one the portal would accept?
 *
 * @returns {{ ok: true, reason: string, subReason: string|null }
 *          |{ ok: false, message: string }}
 *   On success `subReason` is null for every reason but Wrong Product — which
 *   is what the caller must send, rather than an empty string.
 */
export function validateQcSelection(reasonCode: any, subReasonCode: any): {
    ok: true;
    reason: string;
    subReason: string | null;
} | {
    ok: false;
    message: string;
};
/** A reason's label, for a report or a log line. */
export function qcReasonLabel(reasonCode: any): string;
