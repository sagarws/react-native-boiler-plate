import { delay } from "@/mocks/delay";
import { mockImportSummary, mockParseSheet } from "@/mocks/imports";
import type { ImportJobSummary } from "@/types/imports";

/** Mock of TrackVid-FE `api/orderData-service.ts`. */

const uploadOrderDataFile = async (payload: FormData): Promise<ImportJobSummary> => {
  await delay(700);
  const sheet = await mockParseSheet(payload.get("file"));
  if (sheet.header.length && !sheet.header.some((h) => /order/i.test(h))) {
    throw new Error("Missing required column: Order ID.");
  }
  return mockImportSummary(sheet, Math.round(sheet.rowCount * 0.7), "Order data");
};

export const orderDataService = {
  uploadOrderDataFile,
};
