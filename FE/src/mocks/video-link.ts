import { daysAgo } from "@/mocks/delay";
import type { VideoLinkResult } from "@/types/video-link";

const SAMPLE_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

/** Share link for a recording (the fragment keeps each link unique; the file is the same public sample). */
const link = (id: string) => `${SAMPLE_VIDEO}#rec=${id}`;

/** Packing / return recordings of the signed-in company. Re-shoots share an AWB. */
export const videoRecordings: VideoLinkResult[] = [
  { videoLink: link("a1"), awbNumber: "1490812345678", orderType: "Forward", orderNo: "FN24110987654321", recordedAt: daysAgo(1, 11) },
  { videoLink: link("a2"), awbNumber: "1490812345678", orderType: "Forward", orderNo: "FN24110987654321", recordedAt: daysAgo(1, 12) },
  { videoLink: link("b1"), awbNumber: "SF0042319887IN", orderType: "Return", orderNo: "FN24110987654321", recordedAt: daysAgo(6, 16) },
  { videoLink: link("c1"), awbNumber: "77612094381", orderType: "Forward", orderNo: "OD432198765012345100", recordedAt: daysAgo(2, 10) },
  { videoLink: link("d1"), awbNumber: "XB1288830012", orderType: "Return", orderNo: "171-4402198-7765123", recordedAt: daysAgo(3, 15) },
  { videoLink: link("e1"), awbNumber: "DLV5523019846", orderType: "Forward", orderNo: null, recordedAt: daysAgo(5, 9) },
  { videoLink: link("f1"), awbNumber: "MSH7812093345", orderType: "Return", orderNo: "MS-209384756", recordedAt: daysAgo(8, 14) },
  { videoLink: link("g1"), awbNumber: "EKT0099812734", orderType: "Forward", orderNo: "MYN-1129384756", recordedAt: daysAgo(11, 13) },
];

/** Shown as a hint on the mock screen so testers know what to search. */
export const SAMPLE_QUERIES = ["1490812345678", "FN24110987654321", "XB1288830012"] as const;
