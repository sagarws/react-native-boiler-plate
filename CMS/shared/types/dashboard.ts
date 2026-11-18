/**
 * The dashboard's one payload.
 *
 * Assembled in the main process from three sources — claim counts from the API,
 * session health from the credentials endpoint, and the local queue from disk —
 * so the renderer makes a single call and cannot render a half-loaded picture
 * where the counts have arrived but the session warnings have not.
 */

import type { SessionHealth } from './platformSession'

export interface PlatformSummary {
  platform: string
  label: string
  /** Claims on this platform, all statuses. */
  total: number
  /** Count per CMS status, exactly as the server names them. */
  statusCounts: Record<string, number>
  /** Credentials, and how many have a usable session. */
  credentials: number
  sessionsActive: number
  /** Credentials whose session is expiring, expired or missing. */
  sessionsNeedingAttention: number
  /** Worst session state across this platform's credentials. */
  worstSession: SessionHealth | null
  /** Newest master-data sync across this platform's credentials, epoch ms. */
  lastMasterSync: number | null
  /** Whether this platform even has a master import. */
  hasMasterImport: boolean
  /** Claims sitting in this machine's local queue. */
  queuedLocally: number
  /**
   * Compensation the marketplace paid on this platform's claims, in rupees.
   * NULL when unknown — the request failed, or the server predates the field —
   * which is not the same as nothing recovered, and must not be shown as ₹0.
   */
  recovered: number | null
}

export interface DashboardSnapshot {
  platforms: PlatformSummary[]
  /** Totals across every platform. */
  totals: {
    claims: number
    credentials: number
    sessionsNeedingAttention: number
    queuedLocally: number
    /** Sum of every platform's `recovered`; null only when none is known. */
    recovered: number | null
  }
  /** When this snapshot was assembled. */
  generatedAt: string
  /** Parts that failed, named, so a partial dashboard says what is missing. */
  errors: string[]
}
