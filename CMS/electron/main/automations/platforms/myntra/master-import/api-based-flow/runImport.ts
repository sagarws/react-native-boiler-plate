import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'
import { stoppableSleep, throwIfStopped } from '@main/services/automationStop'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'
import { reusableSession } from '@main/services/sessionReuse.service'
import { keepSession } from '@main/automations/common/keepSession'
import {
  MASTER_IMPORT_API_POLL_MS,
  MASTER_IMPORT_MAX_ATTEMPTS
} from '@main/automations/common/masterImportConstants'

/**
 * Myntra master import over the partner portal's own JSON APIs.
 *
 * A port of the automation server's
 * `src/platforms/myntra/master-import/api-based-flow/apiScript.js`:
 *
 *   PHASE 1 — sign in, read partner boot, schedule a job per import type.
 *   PHASE 2 — poll `searchJobs` until each job COMPLETES, then download its
 *     successFile and upload it.
 *
 * The import-type map and the date window are the core's
 * (`getImportTypeApiConfig`, `computeDateRange`) — the same ones the server
 * calls, rather than a second copy that would drift the first time Myntra
 * changed a report id.
 *
 * Unlike the script-based flow this needs no BullMQ: the drain is a loop over
 * HTTP holding only a cookie jar.
 *
 * NOT every import type can be filed. Only `returnOrderData` has a
 * `trackvidReportType` today; the others download but TrackVid has nowhere to
 * put them, so they are reported as skipped rather than counted as imported.
 */

interface DateRange {
  from: string
  to: string
}

interface ImportTypeConfig {
  reportId: number
  portalReportName: string
  /** null when TrackVid has no ingestion route for this report. */
  trackvidReportType: string | null
  lookbackDaysCap: number
}

interface JobRow {
  id?: number | string
  status?: string
  statusMessage?: string
  successFile?: string
}

interface PartnerBoot {
  sellerType?: string
}

interface ReportFlow {
  MYNTRA_STORE_ID: string | number
  loginMyntra: (email: string, password: string, options?: { forceFresh?: boolean }) => Promise<unknown>
  getPartnerBoot: (jar: unknown) => Promise<PartnerBoot>
  scheduleReport: (
    jar: unknown,
    input: { reportId: number; storeId: string | number; partnerType: string; from: string; to: string }
  ) => Promise<{ jobId: number | string }>
  searchJobs: (jar: unknown, options?: { pageSize?: number; start?: number }) => Promise<JobRow[]>
  downloadReport: (jar: unknown, successFileUrl: string) => Promise<{ buffer: Buffer; filename?: string }>
  getImportTypeApiConfig: (importType: string) => ImportTypeConfig
  computeDateRange: (scenario: unknown, lastSyncDate: unknown, cap?: number) => DateRange
}

interface TrackvidFunctions {
  importMyntraDataToTrackVid: (input: {
    reportType: string
    filePath: string
    user: { trackVidEmail: string; companyId: string; plateForm: string; username: string }
  }) => Promise<{ error?: string } | null>
}

export interface MasterImportInput {
  companyId: string
  companyName?: string
  /** The signed-in operator's TrackVid email — the profile the upload is filed under. */
  trackVidEmail: string
  username: string
  password: string
  credentialId: string
  importTypes?: string[]
}

export interface MasterImportOutcome {
  importType: string
  ok: boolean
  bytes?: number
  message?: string
}

/** Only the return report has a confirmed TrackVid destination today. */
const DEFAULT_IMPORT_TYPES = ['returnOrderData']


interface PendingJob {
  importType: string
  jobId: number | string
  meta: ImportTypeConfig
}

export const runMyntraMasterImport = async (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => {
  // Myntra's login drives a real browser through Akamai before the HTTP calls
  // take over, so the browser half of the preparation is required. It also
  // needs SYSTEM Chrome rather than Chrome-for-Testing — the core's
  // `preferExecutablePath` handles that choice, which is why this does not
  // override the executable itself.
  await prepareCoreWithBrowser(onProgress, 'myntra')

  const flow = loadCore<ReportFlow>('platforms/myntra/master-import/api-based-flow/apiReportFlow')
  const { importMyntraDataToTrackVid } = loadCore<TrackvidFunctions>(
    'platforms/myntra/master-import/api-based-flow/trackvidFunctions'
  )

  const importTypes = input.importTypes?.length ? input.importTypes : DEFAULT_IMPORT_TYPES
  const outcomes: MasterImportOutcome[] = []

  // =========================================================================
  // PHASE 1 — sign in, read the partner boot, schedule the jobs
  // =========================================================================
  // A stored session that PROVES it still works skips the sign-in — which for
  // Myntra also skips a real Chrome launch through Akamai, the slowest step in
  // the run by a wide margin.
  const reuse = await reusableSession('myntra', input.username)

  let jar: unknown = reuse.session?.jar
  let partnerType: string

  onProgress?.(jar ? 'Reusing the saved Myntra login…' : `No usable saved login — ${reuse.detail}`)

  try {
    if (!jar) {
      // NO SIGN-IN FROM AN IMPORT — the Login update owns that (signInPolicy).
      refuseSignInUnlessAllowed('myntra', input.username, reuse.detail)
      jar = await flow.loginMyntra(input.username, input.password)

      // Kept so the next run can skip this sign-in — which for Myntra means
      // skipping a real Chrome launch through Akamai. It is also the only way
      // this machine ever gets a session it can use: Myntra binds a session to
      // the IP that minted it, so one captured by the automation server is dead
      // here on arrival, and only a session minted HERE is reusable here.
      await keepSession('myntra', input.username, jar, {}, onProgress)
    }

    // Read regardless of how the jar was obtained: `partnerType` comes from the
    // live boot call, not from the stored record, so a reused session still
    // schedules against the right partner shape.
    const boot = await flow.getPartnerBoot(jar)

    // The schedule call needs it, and there is no sane default — guessing here
    // would schedule a report against the wrong partner shape.
    if (!boot.sellerType) {
      throw new Error('Myntra partner boot returned no sellerType — cannot schedule a report')
    }

    partnerType = boot.sellerType
    logger.info(
      `[myntra-api] ready as ${input.username} (partnerType=${partnerType}` +
        `${reuse.session ? ', reused session' : ', signed in'})`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`[myntra-api] login failed for ${input.username}`, { message })

    return importTypes.map((importType) => ({ importType, ok: false, message }))
  }

  const pending: PendingJob[] = []

  for (const importType of importTypes) {
    throwIfStopped('myntra master import')
    try {
      const meta = flow.getImportTypeApiConfig(importType)

      // Refused before scheduling, not after downloading. Asking Myntra to
      // build a report we cannot file wastes its time and ours.
      if (!meta.trackvidReportType) {
        outcomes.push({
          importType,
          ok: false,
          message:
            `TrackVid has no ingestion route for ${importType} (${meta.portalReportName}) — ` +
            'only returnOrderData can be imported today.'
        })
        logger.warn(`[myntra-api] ${importType} has no TrackVid report type — not scheduled`)
        continue
      }

      // `null` lastSyncDate: the sync date lives in Mongo and this app cannot
      // read it, so every desktop run asks for the full lookback window.
      const range = flow.computeDateRange(undefined, null, meta.lookbackDaysCap)

      onProgress?.(`Requesting the ${importType} report…`)

      const { jobId } = await flow.scheduleReport(jar, {
        reportId: meta.reportId,
        storeId: flow.MYNTRA_STORE_ID,
        partnerType,
        from: range.from,
        to: range.to
      })

      logger.info(
        `[myntra-api] scheduled ${meta.portalReportName} (id=${meta.reportId}) ` +
          `${range.from} → ${range.to} jobId=${jobId}`
      )
      pending.push({ importType, jobId, meta })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      outcomes.push({ importType, ok: false, message })
      logger.error(`[myntra-api] schedule failed for ${importType}`, { message })
    }
  }

  if (pending.length === 0) {
    logger.warn('[myntra-api] nothing scheduled — no jobs to poll for')

    return outcomes
  }

  // =========================================================================
  // PHASE 2 — poll searchJobs, then download and upload what COMPLETED
  // =========================================================================
  const directory = await mkdtemp(join(tmpdir(), 'trackvid-myntra-import-'))
  let round = 0

  const drop = (job: PendingJob): void => {
    const index = pending.indexOf(job)

    if (index >= 0) pending.splice(index, 1)
  }

  try {
    while (pending.length > 0 && round < MASTER_IMPORT_MAX_ATTEMPTS) {
      // Wait before checking. A job scheduled milliseconds ago is never
      // COMPLETED, and checking immediately spends one of three attempts on a
      // guaranteed answer.
      onProgress?.(
        `Myntra is building ${pending.length} report(s) — first check in ` +
          `${Math.round(MASTER_IMPORT_API_POLL_MS / 60000)} min`
      )
      await stoppableSleep(MASTER_IMPORT_API_POLL_MS, 'myntra master import — waiting for the report')

      round += 1

      logger.info(
        `[myntra-api] check ${round}/${MASTER_IMPORT_MAX_ATTEMPTS} — ${pending.length} pending`
      )

      let rows: JobRow[]

      try {
        // One call covers every job this seller scheduled.
        rows = await flow.searchJobs(jar, { pageSize: Math.max(25, pending.length + 10) })
      } catch (error) {
        // Does not count against the cap — the jobs run regardless of whether
        // this one search call reached Myntra.
        round -= 1

        const message = error instanceof Error ? error.message : String(error)

        logger.warn(`[myntra-api] job search failed: ${message} — not counting it as a check`)
        continue
      }

      const ready: { job: PendingJob; row: JobRow }[] = []

      for (const job of [...pending]) {
        throwIfStopped('myntra master import')
        // Jobs ARE matched by id here — unlike Snapdeal's list, Myntra's job
        // rows carry the same id the schedule returned.
        const row = rows.find((candidate) => candidate.id === job.jobId)

        if (!row) continue

        const status = String(row.status || '').toUpperCase()

        if (status === 'COMPLETED') {
          if (row.successFile) ready.push({ job, row })
          continue
        }

        if (status === 'FAILED' || status === 'CANCELLED') {
          const message = `${status}: ${row.statusMessage || 'Myntra did not finish the job'}`

          outcomes.push({ importType: job.importType, ok: false, message })
          logger.warn(`[myntra-api] ${job.importType} → ${message}`)
          drop(job)
        }
      }

      if (ready.length > 0) {
        logger.info(`[myntra-api] ${ready.length} job(s) complete — downloading`)

        // In parallel: independent downloads, independent uploads, and Myntra
        // has already done the slow part.
        await Promise.all(
          ready.map(async ({ job, row }) => {
            try {
              onProgress?.(`Downloading the ${job.importType} report…`)

              const { buffer, filename } = await flow.downloadReport(jar, row.successFile as string)
              const filePath = join(
                directory,
                filename || `myntra_${job.importType}_${Date.now()}.csv`
              )

              await writeFile(filePath, buffer)
              onProgress?.(`Uploading ${job.importType} to TrackVid…`)

              const uploadResult = await importMyntraDataToTrackVid({
                // Non-null by construction: import types without a TrackVid
                // route were refused before scheduling.
                reportType: job.meta.trackvidReportType as string,
                filePath,
                user: {
                  trackVidEmail: input.trackVidEmail,
                  companyId: input.companyId,
                  plateForm: 'MYNTRA',
                  username: input.username
                }
              })

              // The upload RETURNS its error rather than throwing; without this
              // a rejection would be recorded as a successful import.
              if (uploadResult?.error) throw new Error(uploadResult.error)

              outcomes.push({ importType: job.importType, ok: true, bytes: buffer.length })
              logger.info(
                `[myntra-api] imported ${job.importType} (${buffer.length} bytes) for ${input.username}`
              )
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)

              outcomes.push({ importType: job.importType, ok: false, message })
              logger.error(`[myntra-api] ${job.importType} download/upload failed`, { message })
            } finally {
              drop(job)
            }
          })
        )
      }
    }
  } finally {
    // These are a company's order records on an operator's own machine.
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  for (const job of pending) {
    const message =
      `Myntra had not finished the job after ${round} check(s) over ` +
      `${Math.round((round * MASTER_IMPORT_API_POLL_MS) / 60000)} minutes — it may still ` +
      'complete in the portal; resync to collect it'

    outcomes.push({ importType: job.importType, ok: false, message })
    logger.warn(`[myntra-api] giving up on ${job.importType}: ${message}`)
  }

  return outcomes
}
