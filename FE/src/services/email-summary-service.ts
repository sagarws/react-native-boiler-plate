import { delay } from "@/mocks/delay";

/** Mock of the two shell-level email calls in TrackVid `Layout.tsx` (sidebar badge + disconnected alert). */

const getPendingEmailCount = async (): Promise<{ count: number }> => {
  await delay(250);
  return { count: 7 };
};

const getMailboxConnectionSummary = async (): Promise<{ total: number; disconnected: number }> => {
  await delay(250);
  return { total: 3, disconnected: 1 };
};

export const EmailSummaryService = { getPendingEmailCount, getMailboxConnectionSummary };
