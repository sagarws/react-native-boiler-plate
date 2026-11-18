import type { NykaaDdrRun } from '@shared/types/nykaaBulkDdr'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'
import { summarise } from '@main/automations/platforms/nykaa/claim-management/api-based-flow/bulkDdrSheet'

/**
 * The Nykaa DDR bulk claim run, on disk — kept for the same reason as the AJIO
 * one (`bulkSpf.store`): a run can take hours, and an operator who closes the
 * app halfway must still see which tickets were raised. One run is kept;
 * starting a new one replaces it.
 */

const COLLECTION = 'nykaa-ddr-run'
const KEY = 'current'

interface StoredRun extends NykaaDdrRun {
  key: string
}

let collection: JsonCollection<StoredRun> | null = null

export const initialiseNykaaDdrStore = (): void => {
  collection = new JsonCollection<StoredRun>({ name: COLLECTION, directory: dataDirectory() })
}

const store = (): JsonCollection<StoredRun> => {
  if (!collection) throw new Error('Nykaa DDR store used before initialiseNykaaDdrStore()')

  return collection
}

export const readDdrRun = async (): Promise<NykaaDdrRun | null> => {
  const records = await store()
    .read()
    .catch(() => [] as StoredRun[])

  const found = records.find(record => record.key === KEY)

  if (!found) return null

  const run: NykaaDdrRun & { key?: string } = { ...found }

  delete run.key

  return run
}

export const writeDdrRun = async (run: NykaaDdrRun): Promise<void> => {
  await store()
    .mutate(records => ({
      records: [...records.filter(record => record.key !== KEY), { ...run, key: KEY }],
      result: undefined
    }))
    .catch(error => {
      // Non-fatal: failing a ticket already raised at Nykaa because its progress
      // could not be saved would be the wrong trade. The report is the durable copy.
      logger.warn('[nykaa-ddr] could not persist run progress', error)
    })
}

/**
 * Marks a run left mid-flight by a crash. This process holds the
 * single-instance lock, so a run still `running` at startup has nobody running it.
 */
export const recoverInterruptedDdrRun = async (): Promise<void> => {
  const run = await readDdrRun()

  if (!run || run.status !== 'running') return

  logger.warn(`[nykaa-ddr] run ${run.id} was interrupted — marking it stopped`)

  const timestamp = new Date().toISOString()

  const rows = run.rows.map(row =>
    row.result === 'Pending'
      ? { ...row, result: 'Skipped' as const, reason: 'Not filed — the app stopped before reaching it', timestamp }
      : row
  )

  await writeDdrRun({
    ...run,
    status: 'failed',
    finishedAt: timestamp,
    rows,
    summary: summarise(rows),
    error: 'The app stopped before this run finished. Tickets already raised are in the report; Retry files the rest.'
  })
}
