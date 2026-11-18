import { PARTNER_VMS_CHANNELS, PARTNER_VMS_EVENTS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import type { CameraFormat, MirrorOutcome, MirrorRequest, MirrorStatus, ViewRect } from '@shared/vms/partnerVms'
import { invoke, subscribe } from '@renderer/services/ipcClient'

/**
 * Every `partner-vms:*` call, in one place — TrackVid-App's `window.partnerVms`
 * bridge, on the CMS's single preload (`ipcClient`). Thin forwarders only.
 */
export const partnerVmsClient = {
  enable: (cameraLabel: string | null, format: CameraFormat | null): Promise<Result<MirrorStatus>> =>
    invoke<MirrorStatus>(PARTNER_VMS_CHANNELS.enable, { cameraLabel, format }),
  disable: (): Promise<Result<MirrorStatus>> => invoke<MirrorStatus>(PARTNER_VMS_CHANNELS.disable),
  status: (): Promise<Result<MirrorStatus>> => invoke<MirrorStatus>(PARTNER_VMS_CHANNELS.status),
  setCamera: (cameraLabel: string | null, format: CameraFormat | null): Promise<Result<{ applied: boolean }>> =>
    invoke<{ applied: boolean }>(PARTNER_VMS_CHANNELS.setPreferredCamera, { cameraLabel, format }),
  setBounds: (rect: ViewRect): Promise<Result<null>> => invoke<null>(PARTNER_VMS_CHANNELS.setBounds, rect),
  show: (): Promise<Result<null>> => invoke<null>(PARTNER_VMS_CHANNELS.show),
  hide: (): Promise<Result<null>> => invoke<null>(PARTNER_VMS_CHANNELS.hide),
  startMirror: (req: MirrorRequest): Promise<Result<MirrorOutcome>> =>
    invoke<MirrorOutcome>(PARTNER_VMS_CHANNELS.startMirror, req),
  park: (): Promise<Result<MirrorOutcome>> => invoke<MirrorOutcome>(PARTNER_VMS_CHANNELS.park),
  onStatus: (listener: (status: MirrorStatus) => void): (() => void) =>
    subscribe(PARTNER_VMS_EVENTS.statusChanged, (payload) => listener(payload as MirrorStatus))
}
