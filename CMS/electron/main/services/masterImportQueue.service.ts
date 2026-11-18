import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { credentialSecret } from './credentialSecret.service'
import { logger } from './logger'
import { automationsHalted } from './schedulerPause.store'
import { requestMonitorCheck } from './monitorSignal'
import {
  jobIncomplete,
  recordJobAbandoned,
  recordJobCompletion,
  recordJobStart
} from './cronHistory.store'
import { platformTally } from '@shared/utils/platformTally'
import {
  dequeueReport,
  listQueued,
  markChecked,
  type QueuedReport
} from './masterImportQueue.store'
import { collectSnapdealReport } from '../automations/platforms/snapdeal/master-import/script-based-flow/runImport'
import {
  MASTER_IMPORT_MAX_ATTEMPTS,
  MASTER_IMPORT_POLL_INTERVAL_MS,
  MASTER_IMPORT_QUEUE_TIMEOUT_MS,
  MASTER_IMPORT_QUEUE_WARMUP_MS
} from '../automations/common/masterImportConstants'

/**
 * Collects reports that were requested earlier.
 *
 * Phase 1 asks the marketplace for a report and closes the browser. This is
 * phase 2: every interval it reopens one, checks whether the report is ready,
 * and downloads it if so. Still building means the entry stays queued and the
 * next interval tries again — no session is held open in between.
 *
 * NO TIMER OF ITS OWN. The automation monitor wakes at `nextQueueCheckAt()` and
 * calls `drainQueueIfDue()`; this file only keeps the time of the next check.
 *
 * Runs one report at a time. Each opens a real browser; several at once would
 * compete for the screen and for the portal's rate limits, and would make a
 * failure impossible to attribute.
 */

type Collector = (
  queued: QueuedReport,
  password: string,
  onProgress?: (message: string) => void
) => Promise<{ collected: boolean; detail: string }>

/**
 * Platform → how to collect its queued report.
 *
 * Only the script-based flow queues. The API flow drains in-process, the way
 * the automation server's apiScript.js does — it holds no browser between
 * rounds, so there is nothing to close and reopen.
 */
const COLLECTORS: Record<string, Collector> = {
  snapdeal: collectSnapdealReport
}

/** Signed in and Automations on: the monitor may check the queue. */
let started = false
/** When the queue is next owed a check. Null while stopped. */
let nextCheckAt: number | null = null
let draining = false

/** Stamps `masterDataSync`, as the automation server does after its own upload. */
const stampSyncDate = async (queued: QueuedReport): Promise<void> => {
  const token = getAccessToken()

  if (!token) return

  const response = await apiRequest<unknown>('/cms/master-sync/date', {
    method: 'PUT',
    token,
    body: { platform: queued.platform, credentialIds: [queued.credentialId] }
  })

  // Bookkeeping, not the import. A failed stamp must not undo a completed one.
  if (!response.success) {
    logger.warn(
      `Collected ${queued.platform} ${queued.importType} but could not update its last-sync date: ${response.error.message}`
    )
  }
}

let ticks = 0
/** Whether the "nothing to do" line has already been printed for this idle spell. */
let reportedIdle = false

const drain = async (): Promise<void> => {
  // A previous drain is still running — a collection opens a browser and can
  // take minutes, and two at once would fight for the screen.
  if (draining) {
    logger.info('[master-import-queue] tick skipped — a collection is still running')

    return
  }

  if (await automationsHalted()) return

  draining = true
  ticks += 1

  try {
    const queued = await listQueued()

    // An empty queue is announced ONCE, then stays quiet until there is
    // something to say again. The point of these lines is to answer "did the
    // queue start" — which the first one answers; repeating it every five
    // minutes forever only buries the lines that matter.
    if (queued.length === 0) {
      if (!reportedIdle) {
        logger.info(`[master-import-queue] tick #${ticks} — nothing awaiting download`)
        reportedIdle = true
      }

      /*
       * THE RE-RUN OF AN INCOMPLETE CHECK THAT FOUND NOTHING LEFT. It still
       * writes a row — started and completed — because otherwise the
       * incomplete one stays the latest for ever and the queue is owed a re-run
       * on every pass. The incomplete row itself is left exactly as it was.
       */
      if (await jobIncomplete('master-import-queue')) {
        const rerun = await recordJobStart('master-import-queue', [])

        await recordJobCompletion(rerun, 'completed', {
          detail: 'Nothing left awaiting download — re-run of a check that did not finish'
        })
      }

      return
    }

    reportedIdle = false

    logger.info(
      `[master-import-queue] tick #${ticks} — ${queued.length} report(s) awaiting download`
    )

    /*
     * ONE HISTORY ROW PER CHECK THAT HAD WORK — `cron-history-master-import-queue`.
     * Started before the first report, completed after the last, with the result
     * per platform. An empty queue writes nothing: a row every ten minutes
     * saying "nothing to do" would push the real ones out of the table.
     */
    const execution = await recordJobStart('master-import-queue', [
      ...new Set(queued.map(entry => entry.platform))
    ])
    const perPlatform = platformTally()
    let halted = false

    for (const entry of queued) {
      // Switched off part-way: the report in hand finished, the rest stay
      // queued, and this check is left INCOMPLETE — no completion time.
      if (await automationsHalted()) {
        halted = true
        break
      }

      const waitingMin = Math.round((Date.now() - entry.requestedAt) / 60000)

      logger.info(
        `[master-import-queue] checking ${entry.platform} ${entry.importType} for ${entry.username} ` +
          `(requested ${waitingMin} min ago, ${entry.attempts} previous attempt(s))`
      )

      // Abandoned rather than retried forever. The report may still appear in
      // the portal, and saying so is more useful than a queue that never empties.
      if (entry.attempts >= MASTER_IMPORT_MAX_ATTEMPTS) {
        logger.warn(
          `Giving up on ${entry.platform} ${entry.importType} for ${entry.username} — ` +
            `still not ready after ${entry.attempts} checks over ` +
            `${Math.round((Date.now() - entry.requestedAt) / 60000)} minutes. It may still ` +
            'appear in the portal; resync to ask for it again.'
        )
        await dequeueReport(entry.key)
        perPlatform.add(entry.platform, { total: 1, failed: 1, detail: 'Gave up — still not ready' })
        continue
      }

      if (Date.now() - entry.requestedAt > MASTER_IMPORT_QUEUE_TIMEOUT_MS) {
        logger.warn(
          `Giving up on ${entry.platform} ${entry.importType} for ${entry.username} — ` +
            `still not ready ${Math.round((Date.now() - entry.requestedAt) / 60000)} minutes after requesting it`
        )
        await dequeueReport(entry.key)
        perPlatform.add(entry.platform, { total: 1, failed: 1, detail: 'Gave up — timed out' })
        continue
      }

      const collect = COLLECTORS[entry.platform]

      if (!collect) {
        logger.warn(`No collector for ${entry.platform}; dropping its queued report`)
        await dequeueReport(entry.key)
        perPlatform.add(entry.platform, { total: 1, failed: 1, detail: 'No collector for this platform' })
        continue
      }

      try {
        // Fetched per attempt rather than stored with the queue entry: a queue
        // file that held passwords would be a far worse thing to leave on disk.
        const secret = await credentialSecret(entry.platform, entry.username)

        if (!secret.success) throw new Error(secret.error.message)

        // Same reason as the import runners: the collector narrates its
        // download and upload, and without a sink those lines were discarded.
        const result = await collect(entry, secret.data.password, (message) =>
          logger.info(`[${entry.platform}/${entry.username}] ${message}`)
        )

        await markChecked(entry.key)

        if (!result.collected) {
          const left = MASTER_IMPORT_MAX_ATTEMPTS - (entry.attempts + 1)

          logger.info(
            `${entry.platform} ${entry.importType} not ready (${result.detail}) — ` +
              (left > 0
                ? `retrying in ${Math.round(MASTER_IMPORT_POLL_INTERVAL_MS / 60000)} min ` +
                  `(${left} attempt(s) left)`
                : 'that was the last attempt')
          )
          // Still building is neither a success nor a failure: it is counted,
          // and asked about again next check.
          perPlatform.add(entry.platform, { total: 1, detail: `Not ready — ${result.detail}` })
          continue
        }

        await stampSyncDate(entry)
        await dequeueReport(entry.key)
        perPlatform.add(entry.platform, { total: 1, succeeded: 1, detail: result.detail })
        logger.info(`Collected ${entry.platform} ${entry.importType} for ${entry.username}: ${result.detail}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        // Left queued: most failures here are transient (a dropped session, a
        // slow portal), and the report itself is still waiting on Snapdeal.
        // The timeout above is what eventually gives up.
        await markChecked(entry.key)
        perPlatform.add(entry.platform, { total: 1, failed: 1, detail: message })
        logger.error(`Could not collect ${entry.platform} ${entry.importType} for ${entry.username}`, { message })
      }
    }

    if (halted) {
      await recordJobAbandoned(execution)
    } else {
      const platforms = perPlatform.list()
      const total = platforms.reduce((sum, entry) => sum + entry.total, 0)
      const succeeded = platforms.reduce((sum, entry) => sum + entry.succeeded, 0)
      const failed = platforms.reduce((sum, entry) => sum + entry.failed, 0)

      await recordJobCompletion(
        execution,
        failed > 0 && succeeded === 0 ? 'failed' : failed > 0 ? 'completed_with_errors' : 'completed',
        {
          detail: `${succeeded} collected, ${total - succeeded - failed} not ready, ${failed} failed`,
          total,
          succeeded,
          failed,
          platforms
        }
      )
    }
  } finally {
    draining = false
  }
}

export const startMasterImportQueue = (): void => {
  if (started) {
    logger.info('[master-import-queue] already running')

    return
  }

  started = true
  // A short warm-up rather than an immediate run: a report queued before the
  // app was last closed may already be ready, and the operator should not wait
  // a full interval to find out — but sign-in needs to finish first.
  nextCheckAt = Date.now() + MASTER_IMPORT_QUEUE_WARMUP_MS
  requestMonitorCheck({ reason: 'the master-import queue started', planOnly: true })

  logger.info(
    `[master-import-queue] STARTED — first check in ${Math.round(MASTER_IMPORT_QUEUE_WARMUP_MS / 1000)}s, ` +
      `then every ${Math.round(MASTER_IMPORT_POLL_INTERVAL_MS / 60000)} min, ` +
      `up to ${MASTER_IMPORT_MAX_ATTEMPTS} checks per report, on the automation monitor's clock`
  )
}

export const stopMasterImportQueue = (): void => {
  if (started) logger.info('[master-import-queue] stopped')

  started = false
  nextCheckAt = null
}

/** When the monitor should next wake to check the queue. Null while stopped. */
export const nextQueueCheckAt = (): number | null => (started ? nextCheckAt : null)

/**
 * Checks the queue if its time has come. Called by the monitor on each pass,
 * and by nothing else; the next check is timed from when this one ends.
 */
export const drainQueueIfDue = async (): Promise<void> => {
  if (!started || nextCheckAt === null) return

  // Due on its clock — or owed a re-run because the last check never finished.
  if (Date.now() < nextCheckAt && !(await jobIncomplete('master-import-queue'))) return

  try {
    await drain()
  } finally {
    if (started) nextCheckAt = Date.now() + MASTER_IMPORT_POLL_INTERVAL_MS
  }
}

/**
 * Asks for a check now: for Sync, which is somebody asking whether a report
 * has finished building. Brought forward and handed to the monitor rather than
 * drained here, so it waits its turn behind whatever the monitor is running.
 */
export const requestQueueCheckNow = (): void => {
  if (!started) return

  nextCheckAt = Date.now()
  requestMonitorCheck({ reason: 'a master-import queue check was asked for' })
}
