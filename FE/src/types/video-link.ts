/** Types from TrackVid-FE `api/videoLink-service.ts` (`/video-link/search`). */

export type VideoLinkResult = {
  videoLink: string;
  awbNumber: string;
  orderType: string;
  orderNo: string | null;
  recordedAt: string;
};
