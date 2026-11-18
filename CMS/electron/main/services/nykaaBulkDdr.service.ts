import { dialog, shell, app } from 'electron'
import { mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NykaaDdrResultRow, NykaaDdrRun, NykaaDdrUpload } from '@shared/types/nykaaBulkDdr'
import { NYKAA_BULK_DDR_EVENTS } from '@shared/constants/channels'
import { fail, ok, type Result } from '@shared/types/result'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { processName, withProcessLogResult } from '@main/automations/common/processLog'
import {
  planDdrRows,
  readSheet,
  summarise,
  writeResults,
  writeTemplate,
  type DdrEntry,
  type DdrGroup,
  type DdrPlan,
  type NykaaTicketEntry
} from '@main/automations/platforms/nykaa/claim-management/api-based-flow/bulkDdrSheet'
import { runDdrGroup } from '@main/automations/platforms/nykaa/claim-management/api-based-flow/bulkDdrRunner'
import { openNykaaClaimContext } from '@main/automations/platforms/nykaa/claim-management/api-based-flow/runClaim'
import { dataDirectory } from '../database'
import { broadcast } from '../ipc/broadcast'
import { credentialsFor } from './company.service'
import { withAutomationLock } from './automationLock'
import { automationsHalted } from './schedulerPause.store'
import { readDdrRun, writeDdrRun } from './nykaaBulkDdr.store'
import { logger } from './logger'

/**
 * The Nykaa DDR bulk claim, run from this machine — straight from the sheet.
 *
 * Each row becomes one ticket on Nykaa's dispute portal with the issue
 * "Delivered but Not Received", AJIO's DDR subject ("Delivery dispute
 * Returns") and AJIO's DDR message as the body unless the row has its own
 * Description. No evidence URL. Vendor code, SKU, return AWB and return type
 * come from the sheet.
 *
 * Shaped like the AJIO bulk claim (`bulkSpf.service`): the run is persisted
 * after every row, files in the background, never double-files (the core looks
 * the return AWB up before raising a ticket), and Retry files into the same run
 * so the report stays one combined result.
 *
 * What it does NOT do (yet), unlike AJIO's: record a TrackVid job (History),
 * post to Mattermost, or count into the Accounts page's NDR/DDR column — each of
 * those is a TrackVid-BE contract keyed to AJIO today.
 */

interface NykaaFileClaim {
  fileNykaaClaim: (
    ctx: unknown,
    entry: NykaaTicketEntry,
    awb: string
  ) => Promise<{ ticketId: string; alreadyExisted: boolean }>
}

interface DdrTemplates {
  contentForClaimType: (claimType: string) => { emailTemplate: { subject: string; body: string } } | null
}

const PLATFORM = 'nykaa'

/** The paths this session's file dialog returned — the only ones a run may read. */
const chosenFiles = new Set<string>()

let running = false

const reportDirectory = (): string => join(dataDirectory(), 'nykaa-ddr-reports')

const rowKey = (awb: string, sku: string): string => `${awb.trim().toLowerCase()}::${sku.trim().toLowerCase()}`

const isDone = (row: NykaaDdrResultRow): boolean => row.result === 'Success' || row.result === 'Already Filed'

/**
 * The DDR subject and body — AJIO's, from the core's template, so the two
 * platforms' DDR claims read the same and change together.
 */
const ddrTemplate = (): { subject: string; body: string } => {
  const content = loadCore<DdrTemplates>(
    'platforms/ajio/claim-management/api-based-flow/bulkSpfTemplates'
  ).contentForClaimType('DDR')

  if (!content) throw new Error('The core has no DDR claim template')

  return content.emailTemplate
}

const nykaaAccounts = async (): Promise<{ username: string; vendorCode: string }[]> =>
  (await credentialsFor(PLATFORM))
    .filter(credential => credential.username)
    .map(credential => ({ username: credential.username, vendorCode: credential.vendorCode ?? '' }))

const publish = async (run: NykaaDdrRun): Promise<void> => {
  await writeDdrRun(run)
  broadcast(NYKAA_BULK_DDR_EVENTS.progress, run)
}

const flushReport = (run: NykaaDdrRun): void => {
  if (!run.reportPath) return

  try {
    writeResults(run.reportPath, run.rows)
  } catch (error) {
    // Usually the report is open in Excel, which locks it on Windows. The run
    // is persisted regardless; the next row's write tries again.
    logger.warn('[nykaa-ddr] could not write the report', error)
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Native file dialog → the chosen sheet and how many rows it holds. */
export const chooseDdrFile = async (): Promise<Result<NykaaDdrUpload>> => {
  const chosen = await dialog.showOpenDialog({
    title: 'Choose the Nykaa DDR spreadsheet',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }]
  })

  const filePath = chosen.filePaths[0]

  if (chosen.canceled || !filePath) return fail('VALIDATION_ERROR', 'No file chosen')

  try {
    const { rows } = readSheet(filePath)

    if (rows.length === 0) {
      return fail('VALIDATION_ERROR', 'That sheet has no rows under its headers. Download the template to see the columns.')
    }

    chosenFiles.add(filePath)

    return ok({ filePath, fileName: basename(filePath), rowCount: rows.length })
  } catch (error) {
    // A missing column is the usual cause; the message names it.
    return fail('VALIDATION_ERROR', errorText(error))
  }
}

export const downloadDdrTemplate = async (): Promise<Result<{ path: string }>> => {
  const chosen = await dialog.showSaveDialog({
    title: 'Save the Nykaa DDR bulk claim template',
    defaultPath: join(app.getPath('downloads'), 'nykaa-ddr-bulk-claim-template.xlsx'),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    writeTemplate(chosen.filePath)

    return ok({ path: chosen.filePath })
  } catch (error) {
    return fail('INTERNAL_ERROR', errorText(error))
  }
}

export const ddrRunStatus = async (): Promise<Result<NykaaDdrRun | null>> => ok(await readDdrRun())

export const openDdrReport = async (): Promise<Result<null>> => {
  const run = await readDdrRun()

  if (!run?.reportPath) return fail('VALIDATION_ERROR', 'There is no report yet')

  shell.showItemInFolder(run.reportPath)

  return ok(null)
}

/**
 * The run's rows: every sheet row, filed or skipped with its reason.
 *
 * `previous` is the run being retried. Its successes are kept as they are and
 * not filed again; everything else takes the re-read sheet's state, one attempt
 * further on. Pure, exported for tests.
 */
export const buildRunRows = (
  plan: DdrPlan,
  previous: readonly NykaaDdrResultRow[] = []
): { rows: NykaaDdrResultRow[]; groups: DdrGroup[] } => {
  const timestamp = new Date().toISOString()
  const done = new Map(previous.filter(isDone).map(row => [rowKey(row.awb, row.sku), row]))
  const attempts = new Map(previous.map(row => [rowKey(row.awb, row.sku), row.attempt]))
  const nextAttempt = (awb: string, sku: string): number => {
    const before = attempts.get(rowKey(awb, sku))

    return before === undefined ? 1 : before + 1
  }

  const rows: NykaaDdrResultRow[] = []
  const kept = new Set<string>()

  const groups = plan.groups
    .map(group => ({
      ...group,
      entries: group.entries.filter(entry => {
        const key = rowKey(entry.awb, entry.sku)
        const previousRow = done.get(key)

        if (previousRow) {
          rows.push({ ...previousRow, sheetRow: entry.sheetRow })
          kept.add(key)

          return false
        }

        rows.push({
          sheetRow: entry.sheetRow,
          awb: entry.awb,
          sku: entry.sku,
          vendorCode: entry.vendorCode,
          returnType: entry.returnType,
          account: group.account,
          result: 'Pending',
          reason: '',
          ticketNumber: '',
          timestamp,
          attempt: nextAttempt(entry.awb, entry.sku)
        })

        return true
      })
    }))
    .filter(group => group.entries.length > 0)

  for (const skip of plan.skipped) {
    rows.push({
      sheetRow: skip.row.sheetRow,
      awb: skip.row.awb,
      sku: skip.row.sku,
      vendorCode: skip.row.vendorCode,
      returnType: skip.row.returnType,
      account: '',
      result: 'Skipped',
      reason: skip.reason,
      ticketNumber: '',
      timestamp,
      attempt: previous.length ? nextAttempt(skip.row.awb, skip.row.sku) : 1,
      ...(skip.final ? { final: true } : {})
    })
  }

  // A ticket raised earlier stays in the report even if its row left the sheet.
  for (const [key, row] of done) if (!kept.has(key)) rows.push(row)

  rows.sort((a, b) => a.sheetRow - b.sheetRow)

  return { rows, groups }
}

const validUpload = (payload: unknown): NykaaDdrUpload | null => {
  const upload = (payload as { upload?: unknown } | undefined)?.upload as Partial<NykaaDdrUpload> | undefined

  if (!upload || typeof upload.filePath !== 'string' || !chosenFiles.has(upload.filePath)) return null
  if (!['.xlsx', '.xls'].includes(extname(upload.filePath).toLowerCase())) return null

  return {
    filePath: upload.filePath,
    fileName: basename(upload.filePath),
    rowCount: typeof upload.rowCount === 'number' ? upload.rowCount : 0
  }
}

const planFromSheet = async (upload: NykaaDdrUpload): Promise<DdrPlan> =>
  planDdrRows(readSheet(upload.filePath).rows, await nykaaAccounts())

/**
 * Runs a start or a retry holding the one-run slot from its first line, so two
 * clicks in the same moment cannot both pass the check and launch two runs.
 * The slot is released here unless a run was launched — that run releases it.
 */
const exclusive = async (work: () => Promise<Result<NykaaDdrRun>>): Promise<Result<NykaaDdrRun>> => {
  if (running) return fail('VALIDATION_ERROR', 'A Nykaa DDR bulk claim is already running')

  running = true

  let launched = false

  try {
    if (await automationsHalted()) {
      return fail('CONFLICT', 'Automations are switched off — switch them on to run a bulk claim.')
    }

    const result = await work()

    launched = result.success && result.data.status === 'running'

    return result
  } catch (error) {
    return fail('INTERNAL_ERROR', errorText(error))
  } finally {
    if (!launched) running = false
  }
}

/**
 * Reads the sheet and files every claimable row in the background.
 * Returns as soon as the rows are sorted; progress arrives on
 * `NYKAA_BULK_DDR_EVENTS.progress`.
 */
export const startDdrRun = (payload: unknown): Promise<Result<NykaaDdrRun>> => exclusive(() => start(payload))

const start = async (payload: unknown): Promise<Result<NykaaDdrRun>> => {
  const upload = validUpload(payload)

  if (!upload) return fail('VALIDATION_ERROR', 'Upload the sheet again — choose it with the Upload button')

  let plan: DdrPlan

  try {
    plan = await planFromSheet(upload)
  } catch (error) {
    return fail('VALIDATION_ERROR', errorText(error))
  }

  const { rows, groups } = buildRunRows(plan)
  const id = randomUUID()

  mkdirSync(reportDirectory(), { recursive: true })

  const run: NykaaDdrRun = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    upload: { ...upload, rowCount: rows.length },
    buckets: plan.buckets,
    claimable: plan.buckets.claimable,
    done: 0,
    summary: summarise(rows),
    rows,
    reportPath: join(reportDirectory(), `nykaa-ddr-bulk-claim-${id}.xlsx`),
    accounts: groups.map(group => group.account),
    error: null,
    attempts: 1
  }

  return launch(run, groups)
}

/**
 * Retry: files again every row of the last run that has no ticket yet — failed,
 * skipped for a reason that may since have been fixed in the sheet, or held by
 * a disabled submit — INTO THAT RUN, so it stays one report.
 */
export const retryDdrRun = (): Promise<Result<NykaaDdrRun>> => exclusive(retry)

const retry = async (): Promise<Result<NykaaDdrRun>> => {
  const previous = await readDdrRun()

  if (!previous) return fail('VALIDATION_ERROR', 'There is no Nykaa DDR bulk claim to retry')
  if (previous.status === 'running') return fail('VALIDATION_ERROR', 'That bulk claim is still running')

  let plan: DdrPlan

  try {
    plan = await planFromSheet(previous.upload)
  } catch (error) {
    return fail(
      'VALIDATION_ERROR',
      `Could not re-read ${previous.upload.fileName} — a retry files from the original file, so put it back where it was. (${errorText(error)})`
    )
  }

  const { rows, groups } = buildRunRows(plan, previous.rows)
  const claimable = groups.reduce((sum, group) => sum + group.entries.length, 0)

  if (claimable === 0) {
    return fail(
      'VALIDATION_ERROR',
      'Nothing left to file — every row has a ticket, or is still skipped for the reason in the report. Fix the sheet, then retry.'
    )
  }

  return launch(
    {
      ...previous,
      status: 'running',
      finishedAt: null,
      error: null,
      buckets: plan.buckets,
      claimable,
      done: 0,
      rows,
      summary: summarise(rows),
      accounts: [...new Set([...previous.accounts, ...groups.map(group => group.account)])],
      attempts: previous.attempts + 1
    },
    groups
  )
}

const launch = async (run: NykaaDdrRun, groups: DdrGroup[]): Promise<Result<NykaaDdrRun>> => {
  await publish(run)
  flushReport(run)

  if (run.claimable === 0) {
    const finished: NykaaDdrRun = { ...run, status: 'done', finishedAt: new Date().toISOString() }

    await publish(finished)

    return ok(finished)
  }

  // Detached: a run outlasts any IPC call. The modal follows the events.
  void withProcessLogResult(processName(PLATFORM, 'DDR bulk claim', run.id), () => fileRows(run, groups)).catch(
    error => logger.error('[nykaa-ddr] run ended with an unhandled error', error)
  )

  return ok(run)
}

/** Files every group. Never throws — the run's own status carries the outcome. */
const fileRows = async (initial: NykaaDdrRun, groups: DdrGroup[]): Promise<Result<null>> => {
  let run = initial
  let halted = false
  const attempt = new Map(run.rows.map(row => [`${row.sheetRow}`, row.attempt]))

  const recordRow = async (row: NykaaDdrResultRow): Promise<void> => {
    const rows = run.rows.map(existing =>
      existing.sheetRow === row.sheetRow && existing.result === 'Pending' ? row : existing
    )

    run = {
      ...run,
      rows,
      done: run.done + 1,
      summary: summarise(rows)
    }
    await publish(run)
    flushReport(run)
  }

  try {
    await prepareCoreWithBrowser(undefined, PLATFORM)

    const template = ddrTemplate()
    const { fileNykaaClaim } = loadCore<NykaaFileClaim>('platforms/nykaa/claim-management/api-based-flow/fileClaim')

    // One automation at a time: a single claim dispatched meanwhile waits
    // rather than racing this run on the same Nykaa session.
    await withAutomationLock('nykaa-ddr', async () => {
      for (const group of groups) {
        const outcome = await runDdrGroup(group, {
          openContext: async (account, fresh) => {
            if (fresh) logger.info(`[nykaa-ddr] ${account}: session expired mid-run — renewing`)

            return openNykaaClaimContext(account)
          },
          fileClaim: (ctx, entry, awb) => fileNykaaClaim(ctx, entry, awb),
          template,
          shouldStop: () => automationsHalted(),
          onResult: recordRow,
          attemptOf: (entry: DdrEntry) => attempt.get(`${entry.sheetRow}`) ?? 1
        })

        if (outcome.stopped) {
          halted = true
          break
        }
      }
    })

    run = halted
      ? {
          ...run,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: 'Stopped — Automations were switched off before every row was filed'
        }
      : { ...run, status: 'done', finishedAt: new Date().toISOString() }
  } catch (error) {
    logger.error('[nykaa-ddr] run stopped', error)
    run = { ...run, status: 'failed', finishedAt: new Date().toISOString(), error: errorText(error) }
  } finally {
    running = false

    // A row the run never reached is not left Pending — Retry takes it.
    const timestamp = new Date().toISOString()
    const reason = run.error ? `Not filed — ${run.error}` : 'Not filed — the run ended before reaching it'
    const rows = run.rows.map(row =>
      row.result === 'Pending' ? { ...row, result: 'Skipped' as const, reason, timestamp } : row
    )

    run = { ...run, rows, summary: summarise(rows) }
    await publish(run)
    flushReport(run)
  }

  return run.status === 'done' ? ok(null) : fail('INTERNAL_ERROR', run.error ?? 'The run stopped')
}
