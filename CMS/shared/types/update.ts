/**
 * Updater state, mirrored from electron-updater's events into a single shape the
 * renderer can render directly.
 *
 * `phase` is the whole state machine:
 *   idle        - nothing has happened yet, or the app is up to date
 *   checking    - a check is in flight
 *   available   - a newer build exists and the download has started
 *   downloading - bytes are arriving (see `percent`)
 *   downloaded  - staged on disk; quitting will install it
 *   error       - the check or download failed; the app keeps working
 *   unsupported - auto-update cannot run here (dev mode, or an unpacked build)
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

/**
 * One thing the updater did, kept so it can be read from the app itself.
 *
 * WHY THIS EXISTS. When an update fails, the screen has room for one sentence —
 * and the sentence is a summary. What actually settles it is the feed it used,
 * the status the host answered, the file it asked for: three facts that were
 * only ever in a log file on the operator's machine, which is exactly the
 * machine nobody can reach. Diagnosing a failed release meant screenshots.
 */
export interface UpdateLogEntry {
  /** ISO, so the gap between a check and its failure is visible. */
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
  /** The raw error, the URL, the status — whatever makes the line actionable. */
  detail?: string
}

export interface UpdateState {
  phase: UpdatePhase
  /** Version of the running build. */
  current: string
  /** Version being offered, once one is known. */
  latest: string | null
  /** 0-100 while downloading. */
  percent: number
  /** Bytes per second, for a meaningful "time remaining" if the UI wants one. */
  bytesPerSecond: number
  /** Total download size in bytes, when the feed reports it. */
  totalBytes: number
  releaseNotes: string | null
  /**
   * True when the release feed marks this version as required. The UI blocks
   * the app rather than showing a dismissible notice.
   *
   * This is `appsettings.cmsApp.isForceFullyUpdate`, AND-ed with "the policy's
   * version is actually newer than mine" — so a forced policy can never block
   * the very build it is asking people to move to.
   */
  mandatory: boolean
  /**
   * Manual download URL from the release policy, when one is configured.
   *
   * Present so a machine that cannot update itself still has a way to satisfy
   * a mandatory policy. Always http(s) — the feed's value is checked first.
   */
  downloadUrl: string | null
  /** User-safe message when phase is 'error' or 'unsupported'. */
  message: string | null
}

export const initialUpdateState = (current: string): UpdateState => ({
  phase: 'idle',
  current,
  latest: null,
  percent: 0,
  bytesPerSecond: 0,
  totalBytes: 0,
  releaseNotes: null,
  mandatory: false,
  downloadUrl: null,
  message: null
})

/**
 * A TrackVid CMS installer sitting in the operator's Downloads folder — what
 * Settings → "Delete old installers" offers to remove.
 */
export interface DownloadedInstaller {
  name: string
  bytes: number
}

/** What a delete pass did: the files gone, and the ones that would not go and why. */
export interface InstallerCleanupResult {
  removed: DownloadedInstaller[]
  failed: Array<{ name: string; reason: string }>
}
