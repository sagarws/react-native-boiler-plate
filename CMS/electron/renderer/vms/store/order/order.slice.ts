import { createSlice, type PayloadAction } from '../slice'
import {
  emptyCheckOrder,
  type CheckOrderState,
  type ECommercePlatform,
  type OrderState,
  type OrderType,
  type UploadSuccessMeta
} from './order.types'

/**
 * Order-capture Redux slice. Ported from TrackVid 1.1.x order.slice.ts with
 * strict types. Reducer names and semantics are unchanged so a search across
 * the shipping codebase still points at the same action.
 *
 * The slice name stays 'video' (not 'order') for byte compatibility with the
 * shipping-app selectors: existing 1.1.x code reads state.video.*, and any
 * ported component keeps working without a rename pass.
 */

const initialState: OrderState = {
  videoUploadLoading: false,
  videoUploadSuccess: false,
  videoUploadMessage: '',
  videoUploadError: '',
  videoRecording: false,
  fileId: '',
  // Forward is pre-selected on cold start so the operator can walk in, scan
  // the first AWB and start recording without a mouse click. Return VMS is
  // still one click away in the sidebar for the reverse flow.
  orderType: 'Forward',
  trackingId: '',
  feedId: '',
  companyId: '',
  userId: '',
  pending_orders: 0,
  failed_orders: 0,
  is_syncing: false,
  checkOrder: { ...emptyCheckOrder },
  isBufferRecording: false,
  VmsECommercePlatform: ''
}

export const orderSlice = createSlice({
  name: 'video',
  initialState,
  reducers: {
    setVideoUploadLoading: (state, action: PayloadAction<boolean>) => {
      state.videoUploadLoading = action.payload
    },
    setVideoUploadError: (state, action: PayloadAction<string>) => {
      state.videoUploadError = action.payload
      state.videoUploadLoading = false
    },
    setVideoUploadSuccess: (state, action: PayloadAction<UploadSuccessMeta>) => {
      state.fileId = action.payload.fileId
      state.orderType = action.payload.orderType
      state.trackingId = action.payload.trackingId
      state.feedId = action.payload.feedId
      state.companyId = action.payload.companyId
      state.userId = action.payload.userId
      state.videoUploadSuccess = true
      state.videoUploadLoading = false
    },
    setVideoRecording: (state, action: PayloadAction<boolean>) => {
      state.videoRecording = action.payload
    },
    setPendingOrderCount: (state, action: PayloadAction<number>) => {
      state.pending_orders = action.payload
    },
    setFailedOrderCount: (state, action: PayloadAction<number>) => {
      state.failed_orders = action.payload
    },
    setSyncingOrders: (state, action: PayloadAction<boolean>) => {
      state.is_syncing = action.payload
    },
    setSameOrderCheck: (state, action: PayloadAction<CheckOrderState>) => {
      state.checkOrder = action.payload
    },
    setOrderCheckLoading: (state) => {
      state.checkOrder.loading = true
      state.checkOrder.success = false
    },
    setOrderCheckSuccess: (state) => {
      state.checkOrder.success = true
      state.checkOrder.loading = false
    },
    setOrderCheckError: (state, action: PayloadAction<string>) => {
      state.checkOrder.loading = false
      state.checkOrder.success = false
      state.checkOrder.error = action.payload
    },
    resetOrderCheck: (state) => {
      state.checkOrder = { ...emptyCheckOrder }
    },
    setIsBufferRecording: (state, action: PayloadAction<boolean>) => {
      state.isBufferRecording = action.payload
    },
    setVmsECommercePlatform: (state, action: PayloadAction<ECommercePlatform | ''>) => {
      state.VmsECommercePlatform = action.payload
    },
    setOrderType: (state, action: PayloadAction<OrderType | ''>) => {
      state.orderType = action.payload
    },
    setTrackingId: (state, action: PayloadAction<string>) => {
      state.trackingId = action.payload
    }
  }
})

export const {
  setVideoUploadError,
  setVideoUploadLoading,
  setVideoUploadSuccess,
  setVideoRecording,
  setPendingOrderCount,
  setFailedOrderCount,
  setSyncingOrders,
  setSameOrderCheck,
  setOrderCheckLoading,
  setOrderCheckSuccess,
  setOrderCheckError,
  resetOrderCheck,
  setIsBufferRecording,
  setVmsECommercePlatform,
  setOrderType,
  setTrackingId
} = orderSlice.actions

export const orderReducer = orderSlice.reducer
