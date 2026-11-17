import { clone, delay, newId } from "@/mocks/delay";
import { sampleClaimHistory } from "@/mocks/cms";
import { sampleUser } from "@/mocks/user";
import type { IClaimHistory, IHistory } from "@/types/cms";

/** Mock of TrackVid-FE `api/claimHistory-service.ts`. History documents live in memory for the page session. */

let histories: IClaimHistory[] = clone(sampleClaimHistory);

/** GET /claim-history/:id — `id` is the claim's `history` field. */
const getClaimHistoryById = async (id: string): Promise<IClaimHistory> => {
  await delay(400);
  const found = histories.find((h) => h._id === id);
  if (!found) throw new Error("Claim history not found.");
  return clone(found);
};

export const claimHistoryService = { getClaimHistoryById };

const currentUser = (): IHistory["user"] => ({
  _id: sampleUser._id,
  name: { fullName: `${sampleUser.name.firstName} ${sampleUser.name.lastName}` },
  email: sampleUser.email,
});

/**
 * Mock-layer hook used by `cms-service` so claim actions (ticket, status, email edits) show up in the
 * History timeline the way the BE writes them. Not part of TrackVid's API surface.
 */
export function appendClaimHistory(
  historyId: string,
  claimId: string,
  entry: { action_type: number; description: string; byAutomation?: boolean; feedName?: string },
): void {
  const event: IHistory = {
    _id: newId(),
    action_type: entry.action_type,
    date: new Date().toISOString(),
    description: entry.description,
    user: entry.byAutomation ? null : currentUser(),
    feed: entry.byAutomation && entry.feedName ? { _id: "automation", feedName: entry.feedName } : null,
  };
  const existing = histories.find((h) => h._id === historyId);
  if (existing) {
    histories = histories.map((h) => (h._id === historyId ? { ...h, history: [...h.history, event], updatedAt: event.date } : h));
    return;
  }
  histories = [...histories, { _id: historyId, claimId, history: [event], createdAt: event.date, updatedAt: event.date }];
}
