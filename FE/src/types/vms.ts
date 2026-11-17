import type { IMetadata, IOrder, OrderType } from "@/types/accounts";

/**
 * Types for the VMS / Favorite video library. `IOrder` comes from TrackVid `helper/types/types.ts` (already ported
 * in `@/types/accounts`); VMS.tsx / Favorite.tsx also read `orderNo`, `awbNo` and `orderCondition` from the rows.
 */
export interface VmsOrder extends IOrder {
  /** Customer order number linked to the AWB (master data). */
  orderNo?: string;
  /** Forward AWB of a return video (master data). */
  awbNo?: string;
  /** Return parcel condition: 1 = GOOD, 2 = BAD, 0 / missing = not scanned. */
  orderCondition?: number;
}

/** POST /order body as VMS.tsx / Favorite.tsx build it (multi-select filters are arrays). Dates are `yyyy-MM-dd`. */
export interface VmsListPayload {
  page: number;
  limit: number;
  search: string;
  startDate: string;
  endDate: string;
  orderType: string[];
  feedId: string[];
  eCommercePlatform?: string[];
  isFavorite?: boolean;
}

export interface VmsListResponse {
  order: VmsOrder[];
  metadata: IMetadata;
}

/** POST /order/excel body. */
export interface VmsExportPayload extends VmsListPayload {
  selectedOrders: string[];
}

/** `{ isSuccess, displayMessage }` middleware result; failures throw. */
export interface VmsMessage {
  displayMessage: string;
}

export interface VmsOrderResult extends VmsMessage {
  data: VmsOrder;
}

/** State behind TrackVid `VideoModal`. */
export interface VideoPreview {
  url: string;
  title: string;
  createdAt: string;
  feedName: string;
  orderType: string;
  videoSize: string;
  fileKey: string;
}

export interface ScreenshotView {
  trackingId: string;
  screenshots: VmsOrder["screenshots"];
}

export type { OrderType };
