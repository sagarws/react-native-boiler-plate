import { accountsDb } from "@/mocks/accounts";
import { clone, delay, newId, paginate } from "@/mocks/delay";
import type { ICreateTds, ITds, ITdsDuration, ITdsListPayload, ITdsListResponse } from "@/types/accounts";
import type { MessageResponse } from "@/types/common";

/** Mock of TrackVid-FE `api/TDS_Reimbursement-service.tsx`. */

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function parseDuration(value: string): ITdsDuration {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "quarter" in parsed && "year" in parsed) {
      const { quarter, year } = parsed as { quarter: unknown; year: unknown };
      if (typeof quarter === "number" && typeof year === "number") return { quarter, year };
    }
  } catch {
    // Not JSON: fall through to the validation error below.
  }
  throw new Error("TDS Duration is required");
}

const createTds = async (payload: ICreateTds): Promise<MessageResponse> => {
  await delay(800);
  if (!payload.file) throw new Error("Please attach your TDS certificate.");
  const pan = payload.panNumber.trim().toUpperCase();
  if (!PAN.test(pan)) throw new Error("Enter a valid PAN Number (e.g. ABCDE1234F).");
  if (!IFSC.test(payload.ifsc.trim().toUpperCase())) throw new Error("Enter a valid IFSC Code (e.g. HDFC0001708).");
  const duration = parseDuration(payload.duration);
  if (accountsDb.tds.some((t) => t.duration.quarter === duration.quarter && t.duration.year === duration.year && t.status === "1")) {
    throw new Error(`A request for Q${duration.quarter} ${duration.year} is already in process.`);
  }
  const row: ITds = {
    _id: newId(),
    companyName: payload.companyName.trim(),
    tanNumber: payload.tanNumber.trim().toUpperCase(),
    panNumber: pan,
    duration,
    tdsAmount: payload.tdsAmount,
    accountNumber: payload.accountNumber.trim(),
    accountHolderName: payload.accountHolderName.trim(),
    ifsc: payload.ifsc.trim().toUpperCase(),
    status: "1",
    certificateName: payload.file.name,
    createdAt: new Date().toISOString(),
  };
  accountsDb.tds = [row, ...accountsDb.tds];
  accountsDb.certificateFiles.set(row._id, payload.file);
  return { message: "TDS reimbursement request submitted successfully." };
};

const GetTdsDetails = async (payload: ITdsListPayload): Promise<ITdsListResponse> => {
  await delay(400);
  const rows = accountsDb.tds.filter((t) => t.status === payload.status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const result = paginate(rows, payload.page, payload.limit);
  return clone({
    tds: result.data,
    metadata: { total: result.total, totalPage: Math.max(1, Math.ceil(result.total / payload.limit)), page: payload.page, limit: payload.limit },
  });
};

/** File for a request: the uploaded certificate (`certificate`) or the refund proof (`attachment`). */
const getTdsFile = async (tdsId: string, kind: "certificate" | "attachment"): Promise<{ name: string; file: File | null }> => {
  await delay(200);
  const row = accountsDb.tds.find((t) => t._id === tdsId);
  if (!row) throw new Error("TDS request not found.");
  if (kind === "certificate") return { name: row.certificateName, file: accountsDb.certificateFiles.get(tdsId) ?? null };
  if (!row.attachment) throw new Error("No attachment yet.");
  return { name: row.attachment.split("/").pop() ?? row.attachment, file: null };
};

export const TDS_Reimbursement = {
  createTds,
  GetTdsDetails,
  getTdsFile,
};
