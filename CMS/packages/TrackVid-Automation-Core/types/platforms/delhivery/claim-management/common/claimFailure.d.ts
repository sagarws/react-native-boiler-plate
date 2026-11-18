export namespace STAGE {
    let SESSION: string;
    let AWB_LOOKUP: string;
    let DEDUPE: string;
    let EVIDENCE: string;
    let UPLOAD: string;
    let SUBMIT: string;
    let READBACK: string;
    let UNKNOWN: string;
}
export namespace STAGE_LABEL {
    let SESSION_1: string;
    export { SESSION_1 as SESSION };
    let AWB_LOOKUP_1: string;
    export { AWB_LOOKUP_1 as AWB_LOOKUP };
    let DEDUPE_1: string;
    export { DEDUPE_1 as DEDUPE };
    let EVIDENCE_1: string;
    export { EVIDENCE_1 as EVIDENCE };
    let UPLOAD_1: string;
    export { UPLOAD_1 as UPLOAD };
    let SUBMIT_1: string;
    export { SUBMIT_1 as SUBMIT };
    let READBACK_1: string;
    export { READBACK_1 as READBACK };
    let UNKNOWN_1: string;
    export { UNKNOWN_1 as UNKNOWN };
}
export function tagStage(err: any, stage: any): any;
/**
 * Classify a claim failure.
 *
 * @returns {{
 *   stage: string, stageLabel: string, code: string, reason: string,
 *   retryable: boolean, needsManualCheck: boolean, hint: string|null,
 *   requestId: string|null, hqClientId: string|null, status: number|null,
 *   message: string
 * }}
 */
export function describeClaimFailure(err: any, { awb }?: {
    awb?: any;
}): {
    stage: string;
    stageLabel: string;
    code: string;
    reason: string;
    retryable: boolean;
    needsManualCheck: boolean;
    hint: string | null;
    requestId: string | null;
    hqClientId: string | null;
    status: number | null;
    message: string;
};
/**
 * Per-AWB failure table for the end of a batch. One line each, grouped so a run
 * that failed the same way 40 times reads as one problem rather than 40.
 */
export function formatFailureSummary(failures: any): string;
