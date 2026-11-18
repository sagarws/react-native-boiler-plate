import type { Result } from '@shared/types/result'
import { loadCore } from '@main/automations/common/coreLoader'
import { logger } from '@main/services/logger'

/**
 * The start/stop line every automation writes.
 *
 * A thin binding to the core's `common/processLog`, so this app and the
 * automation server produce the IDENTICAL sentence — a log that reads the same
 * either side is most of the point.
 *
 * Applied at each process BOUNDARY rather than inside the per-platform runners:
 * there is one master-import entry point, one session capture and one claim
 * processor, so wiring them covers every platform and no new runner can be
 * added without inheriting it.
 */

interface ProcessLog {
  processName: (platform: string, kind: string, subject?: string) => string
  logProcessStarted: (name: string, logger?: unknown) => void
  logProcessClosed: (name: string, logger?: unknown) => void
  logProcessFailed: (name: string, reason?: string, logger?: unknown) => void
}

const core = (): ProcessLog => loadCore<ProcessLog>('common/processLog')

/**
 * Runs `fn`, announcing it either side.
 *
 * Whichever way it leaves — a value, an early return, a throw — exactly one
 * closing line is written. "Closed" says the process ran to completion, not
 * that everything inside it succeeded; per-credential outcomes are reported
 * separately and are a different claim.
 */
export const withProcessLog = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const log = core()

  log.logProcessStarted(name, logger)

  try {
    const result = await fn()

    log.logProcessClosed(name, logger)

    return result
  } catch (error) {
    log.logProcessFailed(name, error instanceof Error ? error.message : String(error), logger)
    throw error
  }
}

/**
 * The same, for code that reports failure as a VALUE rather than by throwing.
 *
 * Most of this app's boundaries return `Result`, so `withProcessLog` alone would
 * announce "closed successfully" for a run that failed — the one line nobody
 * should have to distrust.
 */
export const withProcessLogResult = async <T>(
  name: string,
  fn: () => Promise<Result<T>>
): Promise<Result<T>> => {
  const log = core()

  log.logProcessStarted(name, logger)

  try {
    const result = await fn()

    if (result.success) {
      log.logProcessClosed(name, logger)
    } else if (result.error.code === 'DRY_RUN') {
      // Ran to completion and deliberately stopped short. Reporting it as a
      // failure put "has failed" in the log for a run where every step worked,
      // which is exactly the line an operator scans for real problems.
      log.logProcessClosed(name, logger)
      logger.info(`${name}: ${result.error.message}`)
    } else {
      log.logProcessFailed(name, result.error.message, logger)
    }

    return result
  } catch (error) {
    log.logProcessFailed(name, error instanceof Error ? error.message : String(error), logger)
    throw error
  }
}

/**
 * The name every line is filed under. Built in the core so this app and the
 * automation server spell the same run the same way.
 */
export const processName = (platform: string, kind: string, subject?: string): string =>
  core().processName(platform, kind, subject)

export const logProcessStarted = (name: string): void => core().logProcessStarted(name, logger)

/** For a boundary that reports failure as a value rather than by throwing. */
export const logProcessFailed = (name: string, reason: string): void =>
  core().logProcessFailed(name, reason, logger)

export const logProcessClosed = (name: string): void => core().logProcessClosed(name, logger)
