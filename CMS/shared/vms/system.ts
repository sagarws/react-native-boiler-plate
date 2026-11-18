/**
 * System-info wire shapes used by the ops-check subsystem
 * (out-of-storage page, date-mismatch page, and their polling providers).
 */

export interface DiskInfo {
  /** Filesystem identifier (e.g. "/", "C:"). */
  fs: string
  /** Mount point. */
  mount: string
  /** Filesystem type ("apfs", "ntfs", ...). */
  type: string
  /** Total capacity in bytes. */
  size: number
  /** Bytes in use. */
  used: number
  /** Bytes free to write. */
  available: number
  /** Convenience: size / used / available in GB, rounded to 2 dp. */
  sizeGB: number
  usedGB: number
  availableGB: number
  /** Percentage of the drive currently in use, 0-100. */
  use: number
}

/**
 * Answer from /common/get-ist-date. Preserved as the authoritative "now" so
 * a laptop whose clock is off cannot pass the date-mismatch check silently.
 */
export interface IstDate {
  day: number
  month: number
  year: number
  hour: number
  minute: number
  second: number
  iso: string
}
