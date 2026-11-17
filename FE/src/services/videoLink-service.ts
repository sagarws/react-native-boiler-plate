import { clone, delay } from "@/mocks/delay";
import { videoRecordings } from "@/mocks/video-link";
import type { VideoLinkResult } from "@/types/video-link";

/**
 * Mock of TrackVid-FE `api/videoLink-service.ts` (`/video-link/search`). Matches `q` as an AWB
 * (plus re-shoots) or an order number, within the company only. An empty list means "No video found".
 */
const search = async (q: string): Promise<VideoLinkResult[]> => {
  await delay(450);
  const term = q.trim().toLowerCase();
  if (!term) throw new Error("Please enter an AWB or order number.");
  const rows = videoRecordings.filter((r) => r.awbNumber.toLowerCase() === term || (r.orderNo ?? "").toLowerCase() === term);
  return clone(rows).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
};

export const VideoLinkService = {
  search,
};
