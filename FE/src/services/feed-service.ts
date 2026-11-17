import { clone, delay, newId, paginate } from "@/mocks/delay";
import { sampleFeeds } from "@/mocks/feed";
import type { MessageResponse, Paged } from "@/types/common";
import type { IAddUpdateFeedPayload, ICommonFeed, IFeed, IFeedListPayload, IFeedToggleId } from "@/types/feed";

/**
 * Mock of TrackVid-FE `api/feed-service.ts`. Owned by the Feed route; other screens only call
 * `getCommonFeeds()` (keep its signature stable).
 */

let feeds: IFeed[] = clone(sampleFeeds);

/** Same check as TrackVid `AddFeedForm`: `rtsp://user:pass@host[:port][/path]`. */
export const RTSP_URL_RE = /^(rtsp):\/\/([^\s@/]+)@([^\s/:]+)(?::([0-9]+))?(\/[^\s]*)?$/;

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "feed";
}

function makePassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "Tv#";
  for (let i = 0; i < 9; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** List (`POST /feed`), newest first, with server paging. */
const getFeedDetail = async (payload: IFeedListPayload): Promise<Paged<IFeed>> => {
  await delay();
  const q = (payload.search ?? "").trim().toLowerCase();
  const rows = feeds
    .filter((f) => !f.isDeleted && (!q || f.feedName.toLowerCase().includes(q) || (f.feedUser?.userId ?? "").toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return clone(paginate(rows, payload.page, payload.limit));
};

const addUpdateFeed = async (payload: IAddUpdateFeedPayload): Promise<MessageResponse> => {
  await delay(600);
  const feedName = payload.feedName.trim();
  if (!feedName) throw new Error("Feed Name is required.");
  if (feeds.some((f) => !f.isDeleted && f._id !== payload.feedId && f.feedName.toLowerCase() === feedName.toLowerCase())) {
    throw new Error("A feed with this name already exists.");
  }
  if (payload.cameraType === "rtsp" && !RTSP_URL_RE.test(payload.rtspURL)) throw new Error("RTSP URL is invalid.");
  const isRtsp = payload.cameraType === "rtsp";
  const fields = {
    feedName,
    cameraType: payload.cameraType,
    rtspURL: isRtsp ? payload.rtspURL.trim() : "",
    onvif_ip: isRtsp ? (payload.onvif_ip ?? "").trim() : "",
    onvif_username: isRtsp ? (payload.onvif_username ?? "").trim() : "",
    onvif_password: isRtsp ? (payload.onvif_password ?? "") : "",
  };
  if (payload.feedId) {
    if (!feeds.some((f) => f._id === payload.feedId && !f.isDeleted)) throw new Error("Feed not found.");
    feeds = feeds.map((f) => (f._id === payload.feedId ? { ...f, ...fields } : f));
    return { message: "Feed updated successfully" };
  }
  feeds = [
    {
      _id: newId(),
      ...fields,
      companyId: payload.companyId,
      userId: payload.user_id,
      isSelectedFeed: false,
      isDisable: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      // The BE creates a login for the recording app with every new feed.
      feedUser: { userId: `ut_${slug(feedName)}`, password: makePassword() },
    },
    ...feeds,
  ];
  return { message: "Feed added successfully" };
};

const deleteFeed = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(400);
  if (payload.id.length === 0) throw new Error("Select at least one feed.");
  feeds = feeds.map((f) => (payload.id.includes(f._id) ? { ...f, isDeleted: true } : f));
  return { message: payload.id.length === 1 ? "Feed deleted successfully" : `${payload.id.length} feeds deleted successfully` };
};

const disableFeed = async (payload: { id: IFeedToggleId[] }): Promise<MessageResponse> => {
  await delay(300);
  const ids = payload.id.map((x) => x.feedId);
  feeds = feeds.map((f) => (ids.includes(f._id) ? { ...f, isDisable: true } : f));
  return { message: ids.length === 1 ? "Feed disabled successfully" : `${ids.length} feeds disabled successfully` };
};

const enableFeed = async (payload: { id: IFeedToggleId[] }): Promise<MessageResponse> => {
  await delay(300);
  const ids = payload.id.map((x) => x.feedId);
  feeds = feeds.map((f) => (ids.includes(f._id) ? { ...f, isDisable: false } : f));
  return { message: ids.length === 1 ? "Feed enabled successfully" : `${ids.length} feeds enabled successfully` };
};

/** Feeds shown as filters on VMS, CMS, Favorite and the CMS create feed picker. */
const getCommonFeeds = async (): Promise<ICommonFeed[]> => {
  await delay(200);
  return feeds.filter((f) => !f.isDeleted).map(({ _id, feedName, isDisable, isDeleted }) => ({ _id, feedName, isDisable, isDeleted }));
};

export const FeedService = { getFeedDetail, addUpdateFeed, deleteFeed, disableFeed, enableFeed, getCommonFeeds };
