/**
 * /account/usage response shape (main → renderer via IPC).
 *
 * Ported from TrackVid 1.1.x usage.slice IUsage. Both blocks report
 * used / total / remaining in the same unit the backend chose (bytes for
 * storage, credits for the recording quota).
 */

export interface StorageQuota {
  used: number
  total: number
  remaining: number
}

export interface CreditQuota {
  used: number
  total: number
  remaining: number
}

export interface UsageSnapshot {
  storage: StorageQuota
  credit: CreditQuota
}
