import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { dataDirectory } from '../database'
import { clearCollections } from '../database/jsonStore'
import { clearCronLog } from './cronLog.store'
import { logger } from './logger'

/**
 * Everything this machine learned, forgotten when the operator signs out —
 * except the master-data backups.
 *
 * WHY EVERYTHING. The app remembers a great deal locally: the company document
 * with its marketplace logins, captured sessions, the claim queue, which
 * sessions a marketplace refused, job history, bulk-claim reports. Sign-out
 * used to clear three of those, which left the machine holding one company's
 * credentials and verdicts while somebody else used it — and left an operator
 * who signed out believing their data had gone.
 *
 * WHY THE BACKUPS STAY. They are not one company's secrets; they are copies of
 * the marketplaces' own reports, gathered a few days at a time because those
 * windows move on and the data cannot be fetched again once they have.
 * Hundreds of megabytes and, for the months already past, irreplaceable —
 * throwing them away on a sign-out would cost claims that can no longer be
 * argued. Both are keyed by account inside, so the next operator sees only
 * their own rows.
 *
 * THE KEEP LIST IS EXPLICIT, and everything else goes. A store added later is
 * cleared without anybody remembering to add it here: the failure that leaves
 * data behind is worse than the one that removes too much, and the backup
 * files are the only ones costly to lose.
 */

/**
 * The two backups' own files.
 *
 *   ajio-backup-settings              which account and report
 *   ajio-backup-index                 what months are held, for the calendar
 *   ajio-backup-forward-2026-09       the rows themselves, one file per month
 *
 *   snapdeal-backup-settings          which account
 *   snapdeal-backup-index             what months are held
 *   snapdeal-backup-requests          which windows were asked of Snapdeal
 *   snapdeal-backup-return            every stored return, in one table
 *   snapdeal-backup-return-2026-09    the per-month files it replaced
 *
 *   flipkart-backup-settings          last run, how far each account got
 *   flipkart-backup-requests          which windows were asked of Flipkart
 *   flipkart-backup-forward           the Orders report's four columns
 *   flipkart-backup-return            the Returns report's four columns
 *
 * THE OLD PER-MONTH PATTERN IS STILL HERE on purpose. The rows move into one
 * table at startup, and a machine that signs out before it has next launched
 * still has those files — dropping the pattern would wipe the months on the
 * one sign-out that happens before the migration runs.
 *
 * `snapdeal-backup-requests` IS data, not history, which is why it is here and
 * `*-backup-jobs` is not. Snapdeal builds a report over minutes and this table
 * is the only record of what has been asked for — lose it beside rows that
 * survive and the next pass re-requests every window already held, queueing
 * dozens of report builds for data on the disk in front of it. The request
 * calendar would also read empty next to a green data calendar, which is the
 * one pair of screens that must agree.
 *
 * `ajio-backup-jobs` and `snapdeal-backup-jobs` are deliberately NOT here:
 * those are the history of backup RUNS, which is this machine's activity log
 * like every other job archive, not the data.
 */
// `vms-upload-queue`: VMS recordings not yet uploaded (VMS_MERGE_PLAN.md). A
// CMS sign-out must not delete them — Argos Watch kept its queue across
// logouts, and each row carries the feedId it was recorded under, so a later
// operator cannot send it under another company's feed.
const KEPT =
  /^vms-upload-queue$|^(ajio|snapdeal)-backup-(settings|index|requests)$|^snapdeal-backup-return$|^(ajio|snapdeal)-backup-[a-z]+-\d{4}-\d{2}$|^flipkart-backup-(settings|requests|forward|return)$/

export const isKeptOnSignOut = (name: string): boolean => KEPT.test(name)

/** Report files a bulk claim wrote, outside the collections. */
const bulkReportDirectory = (): string => join(app.getPath('userData'), 'bulk-spf')

/**
 * Forgets this machine's copy of everything, bar the master-data backups.
 *
 * Called from `logout`. Best effort throughout: a sign-out must complete even
 * if a file will not delete, because the alternative is an operator stuck
 * signed in to an account they are trying to leave. What cannot be cleared is
 * logged by name so it can be chased.
 */
export const clearLocalData = async (): Promise<void> => {
  const { cleared, failed } = await clearCollections(isKeptOnSignOut)

  // Files on disk as well as the collections open in this process: a store this
  // run never touched has no object to clear, and its file would otherwise
  // outlive the sign-out.
  const directory = dataDirectory()
  const orphans: string[] = []

  try {
    for (const entry of await readdir(directory)) {
      const name = entry.replace(/\.json(\.tmp)?$/, '')

      if (entry === name || isKeptOnSignOut(name) || cleared.includes(name)) continue

      await rm(join(directory, entry), { force: true })
      orphans.push(name)
    }
  } catch (error) {
    logger.warn(`[sign-out] could not sweep ${directory}`, error)
  }

  // The bulk claim's own reports, which are rows from one company's claims.
  await rm(bulkReportDirectory(), { recursive: true, force: true }).catch(error =>
    logger.warn('[sign-out] could not remove the bulk claim reports', error)
  )

  /*
   * THE SCHEDULER'S LOG IS HELD IN MEMORY AS WELL AS ON DISK, and clearing the
   * collections only deals with the disk. Its in-process copy is how the log
   * works at all with developer mode off — so without this, signing out
   * removed the file and left four hundred lines of the previous operator's
   * activity in the process, ready for whoever signed in next to read.
   */
  await clearCronLog().catch(error =>
    logger.warn('[sign-out] could not clear the scheduler log', error)
  )

  logger.info(
    `[sign-out] cleared ${cleared.length} store(s)` +
      (orphans.length > 0 ? ` and ${orphans.length} file(s) from a previous run` : '') +
      ' — the AJIO and Snapdeal master-data backups were kept'
  )

  if (failed.length > 0) {
    logger.warn(`[sign-out] these would not clear: ${failed.join(', ')}`)
  }
}
