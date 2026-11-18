// -----------------------------------------------------------------------------
// Tata CliQ — the QC-failure vocabulary a claim is filed under
// -----------------------------------------------------------------------------
// Verified from a portal capture of the Early Refund QC page
// (services/api-network-records (12).json, 2026-09-17): the two `<select>`
// elements inside the "QC Fail for {transId}" modal, and the submit that
// followed them:
//
//   POST /faces/oms/jqAjaxOmsResponse.jsp?flag=InwardFlagForER
//        &hiddenTransId=129602062267213
//        &qcFailCIRDD=10          ← REASON, from this table
//        &qcFailSubReasonCIRDD=01 ← SUB-REASON, from the reason's own list
//        &imagesList=…_1.png,…,…_6.png
//        &qcFailPackagingVideoUrl=…&qcFailUnboxingVideoUrl=…
//        &comment=&qcPass=&qcFail=10
//
// `qcFail` repeats `qcFailCIRDD`; the portal sends both, so we do too.
//
// CODES ARE STRINGS, and the leading zero is load-bearing — "06" and "01", not
// 6 and 1. A number here is a claim filed under the wrong reason, or a 500.
// -----------------------------------------------------------------------------

/**
 * Reason for QC failure — the `qcFailCIR` select, in the portal's own order.
 *
 * The portal's first option is the "--Please Select--" placeholder with value
 * "select". It is deliberately absent: it is not a reason, and sending it is
 * how a claim gets filed under nothing.
 */
const QC_REASONS = [
    { code: "06", label: "Product Carrier Damage - In-transit damage by Logistic partner" },
    { code: "10", label: "Wrong Product" },
    { code: "11", label: "Used Product" },
    { code: "12", label: "Damaged Product" },
    { code: "13", label: "Damaged Box" },
    { code: "14", label: "Missing Box" },
    { code: "15", label: "Missing Accessories" },
    { code: "16", label: "Missing Product/Empty Box" },
    { code: "17", label: "Partial Product" },
    { code: "18", label: "Seal Open" },
    { code: "19", label: "Delivered but not received" },
    { code: "20", label: "Price Mismatch" },
];

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
const REASONS_WITH_SUB_REASON = new Set(["10"]);

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
const REASONS_WITHOUT_VIDEO = new Set(["06", "13", "14", "18", "19", "20"]);

/**
 * Sub-reasons, per reason.
 *
 * One reason, four options — the four that were in the DOM when the capture was
 * taken with Wrong Product selected, and the only reason that has a list at all.
 */
const QC_SUB_REASONS = {
    "10": [
        { code: "01", label: "Other brand delivered" },
        { code: "02", label: "Local product delivered" },
        { code: "03", label: "Same brand but different SKU delivered" },
        { code: "04", label: "Same brand but different size delivered" },
    ],
};

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
const IMAGE_SLOTS = [
    { slot: 1, key: "productImage", label: "Product Image", required: true },
    { slot: 2, key: "productCode", label: "IMEI No./Sr. No./Product Code", required: true },
    { slot: 3, key: "brandMarking", label: "Brand/Company marking", required: true },
    { slot: 4, key: "packingSlip", label: "Packing slip", required: true },
    { slot: 5, key: "additional1", label: "Additional Image 1", required: false },
    { slot: 6, key: "additional2", label: "Additional Image 2", required: false },
];

/**
 * The two videos, which are NOT uploaded.
 *
 * The portal takes them as URLs it fetches itself — the capture's were TrackVid
 * S3 links — so a claim can attach video without this ever holding the file.
 */
const VIDEO_FIELDS = [
    { key: "packagingVideoUrl", param: "qcFailPackagingVideoUrl", label: "Packaging Video URL" },
    { key: "unboxingVideoUrl", param: "qcFailUnboxingVideoUrl", label: "Unboxing Video URL" },
];

const byCode = new Map(QC_REASONS.map((reason) => [reason.code, reason]));

/** Does this reason take a sub-reason at all? Only Wrong Product does. */
function needsSubReason(reasonCode) {
    return REASONS_WITH_SUB_REASON.has(String(reasonCode || "").trim());
}

/** Does a claim under this reason want the two videos? */
function needsVideo(reasonCode) {
    return !REASONS_WITHOUT_VIDEO.has(String(reasonCode || "").trim());
}

/** The sub-reasons for one reason. Empty when it takes none, or none is known. */
function subReasonsFor(reasonCode) {
    const code = String(reasonCode || "").trim();

    if (!needsSubReason(code)) return [];

    return QC_SUB_REASONS[code] || [];
}

/**
 * Is this reason + sub-reason pair one the portal would accept?
 *
 * @returns {{ ok: true, reason: string, subReason: string|null }
 *          |{ ok: false, message: string }}
 *   On success `subReason` is null for every reason but Wrong Product — which
 *   is what the caller must send, rather than an empty string.
 */
function validateQcSelection(reasonCode, subReasonCode) {
    const reason = String(reasonCode || "").trim();
    const sub = String(subReasonCode || "").trim();

    if (!reason || reason === "select") {
        return { ok: false, message: "A QC failure reason is required" };
    }
    if (!byCode.has(reason)) {
        return {
            ok: false,
            message: `Unknown QC failure reason "${reason}" — expected one of: ${QC_REASONS.map((r) => r.code).join(", ")}`,
        };
    }

    if (!needsSubReason(reason)) {
        // Not an error to have been given one; it is simply not sent. The
        // portal's own page clears the select, so a stored value from an
        // earlier reason must not travel with this one.
        return { ok: true, reason, subReason: null };
    }

    const options = subReasonsFor(reason);

    if (options.length === 0) {
        // Unreachable while Wrong Product is the only reason with a list, and
        // kept for the day a second one is added: a reason declared to take a
        // sub-reason with no list behind it must refuse, not file under none.
        return {
            ok: false,
            message:
                `"${byCode.get(reason).label}" takes a sub-reason and none is known for it yet — ` +
                "capture the portal's Sub Reason list for this reason before claiming under it",
        };
    }
    if (!sub || sub === "select") {
        return {
            ok: false,
            message:
                `"${byCode.get(reason).label}" needs a sub-reason: ` +
                options.map((o) => `${o.code} = ${o.label}`).join(", "),
        };
    }
    if (!options.some((option) => option.code === sub)) {
        return {
            ok: false,
            message:
                `Sub-reason "${sub}" does not belong to "${byCode.get(reason).label}" — expected ` +
                options.map((o) => o.code).join(", "),
        };
    }

    return { ok: true, reason, subReason: sub };
}

/** A reason's label, for a report or a log line. */
function qcReasonLabel(reasonCode) {
    return byCode.get(String(reasonCode || "").trim())?.label || null;
}

module.exports = {
    QC_REASONS,
    QC_SUB_REASONS,
    REASONS_WITH_SUB_REASON,
    REASONS_WITHOUT_VIDEO,
    IMAGE_SLOTS,
    VIDEO_FIELDS,
    needsSubReason,
    needsVideo,
    subReasonsFor,
    validateQcSelection,
    qcReasonLabel,
};
