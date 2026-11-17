import { daysAgo, seeded } from "@/mocks/delay";
import { sampleFeeds } from "@/mocks/feed";
import type { VmsOrder } from "@/types/vms";

/**
 * Recorded packing / return videos for the VMS and Favorite screens. Richer than the Accounts order mock:
 * multi-day spread, screenshots, cloud-processing states, parcel condition and AJIO auto-reply flags.
 * `key` is a storage key; `FileService.getFileUrl(key)` resolves it to the public sample MP4.
 */

export const VMS_COMPANY_ID = "64f0c0ffee0000000000c001";
const VMS_USER_ID = "64f0c0ffee0000000000a001";

const PLATFORMS = ["Ajio", "Myntra", "Flipkart", "Amazon", "Meesho", "Nykaa", "Tata CliQ", "Delhivery"] as const;
const SCREENSHOTS = ["/assets/images/products.webp", "/assets/images/warehouse.webp"] as const;
const COMMENTS = [
  "Seal intact, packed with bubble wrap.",
  "Customer claims wrong colour — video shows navy blue kurta packed.",
  "Outer box dented on arrival, product fine.",
  "Return received without tags.",
  "Two items in one parcel, both shown on camera.",
] as const;

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];
const digits = (rand: () => number, n: number): string => Array.from({ length: n }, () => Math.floor(rand() * 10)).join("");

function trackingFor(rand: () => number, platform: string): string {
  switch (platform) {
    case "Ajio":
      return `SF${digits(rand, 11)}AJI`;
    case "Myntra":
      return `MYEP${digits(rand, 10)}`;
    case "Flipkart":
      return `FMPP${digits(rand, 10)}`;
    case "Amazon":
      return digits(rand, 12);
    case "Meesho":
      return `VL${digits(rand, 11)}`;
    case "Delhivery":
      return `1490${digits(rand, 10)}`;
    default:
      return `14${digits(rand, 11)}`;
  }
}

function buildOrders(count: number): VmsOrder[] {
  const rand = seeded(5150);
  const feeds = sampleFeeds.filter((f) => !f.isDeleted);
  return Array.from({ length: count }, (_, i): VmsOrder => {
    const feed = feeds[i % feeds.length];
    const platform = pick(rand, PLATFORMS);
    const isReturn = /return|qc/i.test(feed.feedName) || rand() > 0.62;
    const day = Math.floor(i / 3);
    const createdAt = daysAgo(day, 9 + (i % 10));
    const deleteOn = new Date(new Date(createdAt).getTime() + 90 * 86400000).toISOString();
    const shots = rand() > 0.35 ? 1 + Math.floor(rand() * 3) : 0;
    const cloudRoll = rand();
    const cloudStatus: VmsOrder["cloudStatus"] = i === 1 || i === 7 ? "processing" : i === 4 || i === 11 || i === 17 ? "failed" : cloudRoll > 0.5 ? "completed" : undefined;
    const lengthSec = 14 + Math.floor(rand() * 95);
    const hasMaster = rand() > 0.3;
    const id = `vms${String(i + 1).padStart(21, "0")}`;
    return {
      _id: id,
      fileId: `vfile${String(i + 1).padStart(19, "0")}`,
      orderType: isReturn ? "Return" : "Forward",
      trackingId: trackingFor(rand, platform),
      feedId: feed._id,
      companyId: VMS_COMPANY_ID,
      userId: VMS_USER_ID,
      isDeleted: false,
      deleteOn,
      isFavorite: i % 6 === 0 || i % 13 === 0,
      createdAt,
      updatedAt: createdAt,
      start_time: createdAt,
      videoLength: lengthSec,
      mimetype: "video/mp4",
      // KB, as stored by TrackVid (`convertKBtoMB` divides by 1024).
      size: Math.round(lengthSec * (180 + rand() * 260)),
      feedName: feed.feedName,
      cameraType: feed.cameraType,
      key: cloudStatus === "processing" || cloudStatus === "failed" ? `raw/${VMS_COMPANY_ID}/${id}.mp4` : `orders/${VMS_COMPANY_ID}/${id}.mp4`,
      eCommercePlatform: rand() > 0.08 ? platform : undefined,
      cloudStatus,
      cloudRetryCount: i === 11 ? 2 : i === 17 ? 3 : 0,
      rtspURL: feed.cameraType === "rtsp" ? feed.rtspURL : null,
      comment: i % 5 === 0 ? pick(rand, COMMENTS) : "",
      screenshots: Array.from({ length: shots }, (_, s) => ({
        _id: `${id}-s${s + 1}`,
        url: SCREENSHOTS[(i + s) % SCREENSHOTS.length],
        createdAt: new Date(new Date(createdAt).getTime() + (s + 1) * 4000).toISOString(),
      })),
      ajioReplied: platform === "Ajio" && isReturn ? rand() > 0.4 : undefined,
      ajioRepliedAt: platform === "Ajio" && isReturn ? daysAgo(Math.max(0, day - 1), 18) : undefined,
      orderNo: hasMaster ? `FN${digits(rand, 10)}` : "",
      awbNo: hasMaster && isReturn ? `14${digits(rand, 11)}` : "",
      orderCondition: isReturn ? (rand() > 0.55 ? 1 : rand() > 0.3 ? 2 : 0) : 0,
    };
  });
}

export const vmsOrdersSeed: VmsOrder[] = buildOrders(132);
