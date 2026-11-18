import { retentionStart } from '@shared/utils/backupRetention'
import { pruneBefore } from './masterBackup.store'
import { pruneSnapdealBefore } from './snapdealBackup.store'
import { pruneFlipkartBefore } from './flipkartBackup.store'
import { logger } from './logger'

/**
 * Keeps the AJIO, Snapdeal and Flipkart master-data backups to the retention window
 * (`shared/utils/backupRetention`): five months, the current one included.
 *
 * Run at startup and at the top of each platform's daily pass, so the oldest
 * month goes on the first run of a new month even on a machine left on for
 * weeks. Never throws — a prune that fails costs disk, not a backup.
 */
export const pruneAjioBackup = async (): Promise<void> => {
  const start = retentionStart()
  const removed = await pruneBefore(start).catch(error => {
    logger.warn('[ajio-backup] prune failed', error)

    return 0
  })

  if (removed > 0) logger.info(`[ajio-backup] removed ${removed} row(s) dated before ${start}`)
}

export const pruneSnapdealBackup = async (): Promise<void> => {
  const start = retentionStart()
  const removed = await pruneSnapdealBefore('return', start).catch(error => {
    logger.warn('[snapdeal-backup] prune failed', error)

    return 0
  })

  if (removed > 0) logger.info(`[snapdeal-backup] removed ${removed} row(s) dated before ${start}`)
}

export const pruneFlipkartBackup = async (): Promise<void> => {
  const start = retentionStart()
  const removed = await pruneFlipkartBefore(start).catch(error => {
    logger.warn('[flipkart-backup] prune failed', error)

    return 0
  })

  if (removed > 0) logger.info(`[flipkart-backup] removed ${removed} row(s) dated before ${start}`)
}

export const pruneExpiredBackups = async (): Promise<void> => {
  await Promise.all([pruneAjioBackup(), pruneSnapdealBackup(), pruneFlipkartBackup()])
}
