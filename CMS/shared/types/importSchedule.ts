/**
 * The master-import schedule, as this machine currently understands it.
 *
 * Re-read from the server on every launch and whenever the operator changes the
 * time, so a schedule cached from a previous run can never keep a machine
 * importing at a time nobody chose.
 */
export interface ImportScheduleState {
  /**
   * "HH:mm" in IST, or null when this company has no schedule.
   *
   * The company-wide value. `syncTimes` supersedes it — a schedule is set per
   * platform now — and this stays for the older shape a company may still have
   * stored, where one time applied to everything.
   */
  syncTime: string | null
  /** Per-platform times, `{ ajio: "02:00", myntra: null, … }`. */
  syncTimes: Record<string, string | null>
  /** Platforms that HAVE a master import, whatever their routing. */
  schedulablePlatforms: string[]
  /** Platforms routed to desktop execution for master import. */
  platforms: string[]
  /** Epoch ms of the last completed run on this machine. */
  lastRunAt: number | null
  /** Epoch ms of the next scheduled moment, or null with no schedule. */
  nextRunAt: number | null
  running: boolean
  /** Why the last attempt failed, or why a run is being deferred. */
  lastError: string | null
  /** True while a due run is waiting for the network to come back. */
  offline: boolean
}
