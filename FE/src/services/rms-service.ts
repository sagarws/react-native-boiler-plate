import { delay, newId } from "@/mocks/delay";
import { MasterData } from "@/services/masterData-service";
import type { RmsBulkResult, RmsClaimJob, RmsClaimOutcome, RmsTriggerPayload } from "@/types/rms";

/**
 * RMS-only mock pieces. The RMS list, status, ticket, export and history calls are TrackVid `MasterData` functions and
 * go straight to `@/services/masterData-service` (same data as the Master Data screen). This file adds what that mock
 * does not model: the `{ jobId, totalRecords }` reply of the claim trigger, the per-claim result the
 * `cms:script:progress` socket would stream, and TrackVid's detailed bulk status-update report.
 */

const CLAIM_ERRORS = [
  "Login failed: AJIO seller portal asked for captcha",
  "No login information found for this AJIO account",
  "Return order not found on the AJIO portal",
] as const;

/** `MasterData.triggerReturnNotDeliveredClaim` + the job id the BE returns (TrackVid `response.data`). */
const triggerReturnNotDeliveredClaim = async (payload: RmsTriggerPayload): Promise<RmsClaimJob> => {
  const ids = payload.ids ?? [];
  if (!ids.length) throw new Error("No MasterImport records found for the selected filters");
  const res = await MasterData.triggerReturnNotDeliveredClaim({ ids, marketplace: payload.import_platform });
  const totalRecords = res.data?.queued ?? ids.length;
  return { jobId: `rms-${newId()}`, totalRecords, displayMessage: res.displayMessage };
};

/** Simulated worker result for one AWB: the same AWB always gets the same result (~75% success). */
const claimOutcome = (awb: string): RmsClaimOutcome => {
  let h = 0;
  for (const ch of awb) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  if (h % 4 !== 0) return { ok: true, ticket: `AJ-TKT-${String(100000 + (h % 900000))}` };
  return { ok: false, error: CLAIM_ERRORS[h % CLAIM_ERRORS.length] };
};

/** A successful claim links the AJIO ticket to the order (shows in the Ticket column and the order history). */
const recordClaimSuccess = async (id: string, ticket: string): Promise<void> => {
  await MasterData.editMasterTicket({ _id: id, ticket });
};

/** `MasterData.bulkStatusUpdateReturnDispute` reshaped into the report TrackVid's RMS dialog shows. */
const bulkStatusUpdateReturnDispute = async (file: File, marketplace: string): Promise<RmsBulkResult> => {
  await delay(150);
  const res = await MasterData.bulkStatusUpdateReturnDispute(file, marketplace);
  return {
    marketplace,
    totalRows: res.total,
    scannedRows: res.total,
    ignoredCount: 0,
    updatedCount: res.updated,
    skippedCount: res.skipped,
    notFoundCount: res.notFound.length,
    updated: [],
    skipped: [],
    // The master mock reports only the ticket ids, not their sheet rows (0 = row unknown).
    notFound: res.notFound.map((ticketId) => ({ rowNumber: 0, ticketId })),
  };
};

export const RmsService = { triggerReturnNotDeliveredClaim, claimOutcome, recordClaimSuccess, bulkStatusUpdateReturnDispute };
