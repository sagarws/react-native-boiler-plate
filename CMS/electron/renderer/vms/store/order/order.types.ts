/**
 * Order-capture types shared between the slice, the recorder components and
 * the upload service. Ported from TrackVid 1.1.x with strict typing added -
 * the original relied on implicit any across the reducer boundary.
 */

/** The three physical order flows the packer chooses between. */
export const ORDER_TYPES = ['Forward', 'Return', 'RTO'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

/**
 * Marketplace / e-commerce platform. Values match the strings the backend uses
 * (case-sensitive on some CMS endpoints, so do not "clean up" the casing).
 */
export const ECOMMERCE_PLATFORMS = ['Meesho', 'Snapdeal', 'Myntra', 'Nykaa', 'Flipkart', 'Amazon'] as const
export type ECommercePlatform = (typeof ECOMMERCE_PLATFORMS)[number]

/**
 * The payload the upload thunk builds from a completed recording. Files come
 * from MediaRecorder + fix-webm-duration. Not persisted through Redux; a
 * transient argument to the upload action.
 */
export interface OrderUploadPayload {
  file: File
  files?: File[]
  trackingId: string
  size: number
  /** Duration in seconds. */
  length: number
  orderType: OrderType
  /** 1 = good, 2 = damaged. Only meaningful for Return orders when the popup is enabled. */
  orderCondition?: number | null
  /** Recording start, epoch ms. */
  start_time: number
  eCommercePlatform?: ECommercePlatform | ''
  keepOld: boolean
  needRefund: boolean
}

/** Result of the same-order-check probe (POST /order/check-order-exists). */
export interface CheckOrderState {
  trackingId: string
  orderType: OrderType | ''
  existsInLastTwoHour: boolean
  exists: boolean
  loading: boolean
  success: boolean
  error: string
}

export interface UploadSuccessMeta {
  fileId: string
  orderType: OrderType | ''
  trackingId: string
  feedId: string
  companyId: string
  userId: string
}

export interface OrderState {
  videoUploadLoading: boolean
  videoUploadSuccess: boolean
  videoUploadMessage: string
  videoUploadError: string
  videoRecording: boolean
  fileId: string
  orderType: OrderType | ''
  trackingId: string
  feedId: string
  companyId: string
  userId: string
  pending_orders: number
  failed_orders: number
  is_syncing: boolean
  checkOrder: CheckOrderState
  isBufferRecording: boolean
  VmsECommercePlatform: ECommercePlatform | ''
}

export const emptyCheckOrder: CheckOrderState = {
  trackingId: '',
  orderType: '',
  existsInLastTwoHour: false,
  exists: false,
  loading: false,
  success: false,
  error: ''
}
