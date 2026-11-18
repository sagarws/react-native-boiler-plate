import type { PlatformResult } from '@shared/types/automationSchedule'

/**
 * Counts a run's work per marketplace, for its history row.
 *
 * A runner calls `add` as each account, platform or claim is settled, and
 * hands `list()` back as `TaskOutcome.platforms`. Platforms are kept in the
 * order they were first seen — the order the run reached them — so a history
 * row reads in the same order as the log.
 *
 * Pure, so a runner's arithmetic can be tested without a browser.
 */
export interface PlatformTally {
  add: (
    platform: string,
    counts: { total?: number; succeeded?: number; failed?: number; detail?: string | null }
  ) => void
  list: () => PlatformResult[]
}

export const platformTally = (): PlatformTally => {
  const entries = new Map<string, PlatformResult>()

  return {
    add: (platform, counts) => {
      const key = platform.trim().toLowerCase()

      if (!key) return

      const entry = entries.get(key) ?? { platform: key, total: 0, succeeded: 0, failed: 0, detail: null }

      entry.total += counts.total ?? 0
      entry.succeeded += counts.succeeded ?? 0
      entry.failed += counts.failed ?? 0
      // The latest word on a platform wins: it is the most specific.
      if (counts.detail !== undefined) entry.detail = counts.detail
      entries.set(key, entry)
    },
    list: () => [...entries.values()].map(entry => ({ ...entry }))
  }
}
