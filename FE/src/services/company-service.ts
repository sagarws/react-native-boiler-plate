import { delay } from "@/mocks/delay";
import type { MessageResponse } from "@/types/common";

/**
 * Mock of TrackVid-FE `api/company-service.ts`. TrackVid's settings screen updates the Redux profile
 * (`updateIncreffAllocationEntry`) after this call, so the mock only records the value and answers.
 */

export interface IIncreffAllocationPayload {
  platform: string;
  allowed: boolean;
}

const allocation = new Map<string, boolean>();

export const updateIncreffAllocation = async (payload: IIncreffAllocationPayload): Promise<MessageResponse & { data: IIncreffAllocationPayload }> => {
  await delay(400);
  if (!payload.platform.trim()) throw new Error("Platform is required.");
  allocation.set(payload.platform, payload.allowed);
  return {
    message: `Increff auto-claim allocation ${payload.allowed ? "enabled" : "disabled"} for ${payload.platform}.`,
    data: { platform: payload.platform, allowed: payload.allowed },
  };
};

export const CompanyService = { updateIncreffAllocation };
