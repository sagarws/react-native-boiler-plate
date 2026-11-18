import { invoke } from '@renderer/services/ipcClient'
import { VMS_CHANNELS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import type { StreamDiagnostics } from '@shared/vms/stream'

/**
 * The recorder's own IPC calls — Argos Watch's order client and the stream
 * diagnostics (the shell's vmsClient serves the rest), on the merged
 * `vms:*` channels (shared/vms/feeds.ts) with Argos Watch's own payloads.
 * Everything goes through ipcClient, the renderer's one door to the bridge.
 */

export interface CheckOrderResult {
  exists: boolean
  existsInLastTwoHour: boolean
}

export interface ProductDetail {
  sellerSkuCode: string
  quantity: number
  color: string
  size: string
  imageLink: string
}

export const recorderClient = {
  checkExists: (trackingId: string, orderType: string): Promise<Result<CheckOrderResult>> =>
    invoke<CheckOrderResult>(VMS_CHANNELS.orderCheckExists, { trackingId, orderType }),
  productDetails: (trackingId: string, companyId: string): Promise<Result<ProductDetail[]>> =>
    invoke<ProductDetail[]>(VMS_CHANNELS.orderProductDetails, { trackingId, companyId }),
  streamDiagnostics: (): Promise<Result<StreamDiagnostics | null>> =>
    invoke<StreamDiagnostics | null>(VMS_CHANNELS.streamDiagnostics)
}
