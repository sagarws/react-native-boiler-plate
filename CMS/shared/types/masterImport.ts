/**
 * The master-import view: one row per credential, per platform.
 *
 * Assembled from two sources the app already reads — the credential list (which
 * carries each login's own `masterDataSync`) and the per-platform schedule — so
 * an operator can see, in one table, what will sync and when it last did.
 */

export interface MasterImportRow {
  platform: string
  platformLabel: string
  credentialId: string
  username: string
  /** "HH:mm" IST for this platform, or null when it has no schedule. */
  syncTime: string | null
  /** Epoch ms of this credential's last successful sync. Null = never. */
  lastSyncAt: number | null
}

/** What a resync attempt reported, per credential. */
export interface MasterResyncResult {
  platform: string
  credentialId: string
  ok: boolean
  message?: string
}
