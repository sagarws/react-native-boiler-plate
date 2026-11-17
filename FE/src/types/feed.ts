/** Feed types (TrackVid-FE `helper/types/types.ts` + the extra fields the Feed page reads from the API). */

/** `cameraType` values used by TrackVid: browser web cam or an RTSP / IP camera. */
export type FeedCameraType = "web_cam" | "rtsp";

export interface IFeedUser {
  userId: string;
  password: string;
  email?: string;
}

export interface IFeed {
  _id: string;
  feedName: string;
  companyId: string;
  userId: string;
  rtspURL: string;
  cameraType: string;
  isSelectedFeed: boolean;
  isDisable: boolean;
  isDeleted: boolean;
  createdAt: string;
  feedUser?: IFeedUser;
  onvif_ip?: string;
  onvif_username?: string;
  onvif_password?: string;
}

export interface ICommonFeed {
  _id: string;
  feedName: string;
  isDisable: boolean;
  isDeleted: boolean;
}

/** Body of `feed/add-update` (TrackVid `AddFeedForm`). `feedId` present means edit. */
export interface IAddUpdateFeedPayload {
  feedId?: string;
  user_id: string;
  companyId: string;
  feedName: string;
  cameraType: FeedCameraType;
  rtspURL: string;
  onvif_username?: string;
  onvif_password?: string;
  onvif_ip?: string;
}

/** Body of `feed` (list). */
export interface IFeedListPayload {
  page: number;
  limit: number;
  search?: string;
}

/** `feed/enable` and `feed/disable` body item. */
export interface IFeedToggleId {
  feedId: string;
  feedUserId: string;
}
