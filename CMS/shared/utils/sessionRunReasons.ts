import type { JobDetail } from '@shared/types/jobs'
import { platformKey } from './platformKey'

/**
 * Attaching the reason a Login update gave to the account it belongs to.
 *
 * THE RUN ALREADY WRITES THIS DOWN, one row per account, with the
 * marketplace's own sentence — "Flipkart did not accept the OTP after retry",
 * "gave up after 180s", "signed in and saved, but Delhivery refuses it". It
 * has only ever been readable by opening the Jobs page, finding the right
 * scheduled run and matching timestamps, which is why a completed run and a
 * still-red Sessions page could sit side by side explaining neither half.
 *
 * MATCHED BY THE REF THE TASK WRITES — `"<Platform> · <username>"`. That is a
 * display string rather than an id, which is a weak join, so it is done in one
 * place and loosely: a row that cannot be matched is DROPPED rather than
 * guessed at, because a reason shown against the wrong account is worse than
 * no reason at all.
 *
 * In shared/ because it is pure logic over shared types — the renderer calls
 * it, and a test can reach it without dragging the IPC client in.
 */

/** `"Tata CliQ · ops@example.com"` → `"tatacliq:ops@example.com"`. */
export const credentialKeyOf = (ref: string): string | null => {
  const [label, username] = String(ref ?? '').split('·').map(part => part.trim())

  if (!label || !username) return null

  return `${platformKey(label)}:${username.toLowerCase()}`
}

/** @returns credential key → the reason the last run recorded for it. */
export const rowsToReasons = (detail: JobDetail): Record<string, string> => {
  const reasons: Record<string, string> = {}

  for (const row of detail?.succeededRows ?? []) {
    const key = credentialKeyOf(row.ref)

    if (key && row.note) reasons[key] = row.note
  }

  // A failed row's `reason` is the same fact in the other list: the task writes
  // some accounts to each, depending on how the attempt ended.
  for (const row of detail?.failedRows ?? []) {
    const key = credentialKeyOf(row.ref)

    if (key && row.reason) reasons[key] = row.reason
  }

  return reasons
}
