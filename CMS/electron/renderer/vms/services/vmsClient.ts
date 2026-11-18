import { VMS_CHANNELS, VMS_EVENTS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import type { SessionState } from '@shared/vms/auth'
import type { SelectFeedInput, SelectFeedResult, VmsFeedOption } from '@shared/vms/feeds'
import type { MediaPermissionKind, MediaPermissionSnapshot } from '@shared/vms/permissions'
import type { ApiProbeResult } from '@shared/vms/probe'
import type { QueueCounts, QueueEntry } from '@shared/vms/queue'
import type { DiskInfo, IstDate } from '@shared/vms/system'
import type { UsageSnapshot } from '@shared/vms/usage'
import { invoke, subscribe } from '@renderer/services/ipcClient'

/**
 * Every `vms:*` call the VMS shell makes, in one place.
 *
 * Argos Watch spread these over system / queue / usage / auth clients; the
 * names moved under `vms:` (shared/vms/feeds.ts has the map) and the payloads
 * did not change, so each wrapper is the Argos one with a new channel name.
 * Thin forwarders only — no logic in the renderer.
 */
export const vmsClient = {
  // ------------------------------------------------------------ feed session
  feeds: (): Promise<Result<VmsFeedOption[]>> => invoke<VmsFeedOption[]>(VMS_CHANNELS.feeds),
  selectFeed: (input: SelectFeedInput): Promise<Result<SelectFeedResult>> =>
    invoke<SelectFeedResult>(VMS_CHANNELS.selectFeed, input),
  feedSession: (): Promise<Result<SessionState>> => invoke<SessionState>(VMS_CHANNELS.feedSession),
  releaseFeed: (): Promise<Result<null>> => invoke<null>(VMS_CHANNELS.releaseFeed),
  /** Local recorder server's port; null while it is not running. */
  sidecarPort: (): Promise<Result<number | null>> => invoke<number | null>(VMS_CHANNELS.sidecarPort),
  onFeedSessionChange: (listener: (session: SessionState) => void): (() => void) =>
    subscribe(VMS_EVENTS.feedSessionChanged, (payload) => listener(payload as SessionState)),

  // ------------------------------------------------------------ system probes
  diskInfo: (): Promise<Result<DiskInfo>> => invoke<DiskInfo>(VMS_CHANNELS.diskInfo),
  istDate: (): Promise<Result<IstDate>> => invoke<IstDate>(VMS_CHANNELS.istDate),
  cameraDatePermission: (feedId: string): Promise<Result<boolean>> =>
    invoke<boolean>(VMS_CHANNELS.cameraDatePermission, { feedId }),
  /** Every call resolves; a transport failure is a result with status 0. */
  probeApi: (): Promise<Result<ApiProbeResult>> => invoke<ApiProbeResult>(VMS_CHANNELS.probeApi),

  // ------------------------------------------------------------ media consent
  mediaPermissions: (): Promise<Result<MediaPermissionSnapshot>> =>
    invoke<MediaPermissionSnapshot>(VMS_CHANNELS.mediaPermissions),
  requestMediaPermissions: (): Promise<Result<MediaPermissionSnapshot>> =>
    invoke<MediaPermissionSnapshot>(VMS_CHANNELS.requestMediaPermissions),
  openMediaPrivacySettings: (kind: MediaPermissionKind): Promise<Result<null>> =>
    invoke<null>(VMS_CHANNELS.openMediaPrivacySettings, { kind }),

  // ------------------------------------------------------------ upload queue
  queueCounts: (): Promise<Result<QueueCounts>> => invoke<QueueCounts>(VMS_CHANNELS.queueCounts),
  queueListFailed: (): Promise<Result<QueueEntry[]>> => invoke<QueueEntry[]>(VMS_CHANNELS.queueListFailed),
  queueRetry: (uuid: string): Promise<Result<null>> => invoke<null>(VMS_CHANNELS.queueRetry, { uuid }),
  queueDeleteFailed: (uuid: string): Promise<Result<null>> =>
    invoke<null>(VMS_CHANNELS.queueDeleteFailed, { uuid }),
  onQueueCountsChange: (listener: (counts: QueueCounts) => void): (() => void) =>
    subscribe(VMS_EVENTS.queueCountsChanged, (payload) => listener(payload as QueueCounts)),

  // ------------------------------------------------------------ account
  usage: (): Promise<Result<UsageSnapshot>> => invoke<UsageSnapshot>(VMS_CHANNELS.usage)
}
