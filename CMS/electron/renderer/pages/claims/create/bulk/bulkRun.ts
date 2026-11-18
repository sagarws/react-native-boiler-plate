import { useSyncExternalStore } from 'react'
import type { BulkRefillProgress } from '@shared/types/bulkRefill'
import { bulkRefill, bulkSheetRead, onBulkRefillProgress } from '@renderer/services/claimCreate.service'
import { toast } from '../toast'
import {
  applyRefill,
  createRow,
  editRow,
  markDuplicates,
  needsRefill,
  prepareRow,
  refillRequestRow,
  rowsFromWorkbook,
  runPool,
  type BulkRow,
  type PlatformSheet
} from './normalBulk'

/**
 * One Normal Bulk Claim run, held OUTSIDE the dialog.
 *
 * IN THE BACKGROUND, the way the operator asked: closing the dialog does not
 * stop the run, and reopening it shows the run where it has got to. The work is
 * IPC and HTTP the renderer already makes for the form, so it lives in the
 * renderer — a module, not a component, so it outlives the dialog and the
 * page. It ends with the window; nothing here is written to disk until Proceed
 * files the claims.
 *
 *   reading → refilling → verifying → review ⇄ (edit → re-verify) → creating → done
 *
 * ONE RUN AT A TIME. A new upload or Discard bumps `run`, and every pool and
 * listener of the old one checks it before writing, so an abandoned run can
 * never write into a new one.
 */

export type BulkPhase = 'idle' | 'reading' | 'refilling' | 'verifying' | 'review' | 'creating' | 'done'

export interface BulkProgress {
  label: string
  done: number
  total: number
}

export interface BulkRunState {
  phase: BulkPhase
  fileName: string
  rows: BulkRow[]
  progress: BulkProgress | null
}

/** Lookups per row are several round trips; four at a time keeps the queue moving without flooding it. */
const PREPARE_CONCURRENCY = 4
/** Filing uploads a PDF for some platforms; two at a time. */
const CREATE_CONCURRENCY = 2

const IDLE: BulkRunState = { phase: 'idle', fileName: '', rows: [], progress: null }

let state: BulkRunState = IDLE
let run = 0
const listeners = new Set<() => void>()

const set = (patch: Partial<BulkRunState>): void => {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** The run, for a component. */
export const useBulkRun = (): BulkRunState => useSyncExternalStore(subscribe, () => state)

/** Is the run doing something the operator has to wait for? */
export const isBusy = (phase: BulkPhase): boolean =>
  phase === 'reading' || phase === 'refilling' || phase === 'verifying' || phase === 'creating'

const updateRow = (current: number, next: BulkRow): void => {
  if (run !== current) return
  set({ rows: state.rows.map(row => (row.id === next.id ? next : row)) })
}

const updateRows = (current: number, next: BulkRow[]): void => {
  if (run !== current) return

  const byId = new Map(next.map(row => [row.id, row]))

  set({ rows: state.rows.map(row => byId.get(row.id) ?? row) })
}

/** Forgets the run — the dialog's Discard, and the start of every new upload. */
export const discardBulkRun = (): void => {
  run += 1
  state = IDLE
  for (const listener of listeners) listener()
}

/* -------------------------------------------------------------------------- *
 * Phases
 * -------------------------------------------------------------------------- */

/**
 * Refill, platform by platform: one IPC call each, so the marketplace session
 * is opened once per platform rather than once per row.
 */
const refill = async (current: number): Promise<void> => {
  const wanted = state.rows.filter(needsRefill)

  if (wanted.length === 0) return

  const byPlatform = new Map<string, BulkRow[]>()

  for (const row of wanted) {
    const key = row.platform.record.name

    byPlatform.set(key, [...(byPlatform.get(key) ?? []), row])
  }

  set({ phase: 'refilling', progress: { label: 'Refilling…', done: 0, total: wanted.length } })
  updateRows(current, wanted.map(row => ({ ...row, status: 'refilling' })))

  const runId = `bulk-${current}-${Date.now()}`
  let platformLabel = ''
  const stop = onBulkRefillProgress((progress: BulkRefillProgress) => {
    if (run !== current || progress.runId !== runId) return

    const step = progress.step === 'local' ? 'reading the local report backup' : 'asking the marketplace'

    // The bar follows the step in hand: a platform reads its backup first and
    // then asks the marketplace about only the rows the backup could not fill.
    set({
      progress: {
        label: `Refilling ${platformLabel} — ${step} (${progress.done} / ${progress.total})`,
        done: progress.done,
        total: progress.total
      }
    })
  })

  try {
    for (const [platform, rows] of byPlatform) {
      if (run !== current) return

      platformLabel = rows[0]?.platformLabel ?? platform
      set({ progress: { label: `Refilling ${platformLabel}…`, done: 0, total: rows.length } })

      const answer = await bulkRefill({ runId, platform, rows: rows.map(refillRequestRow) })

      if (run !== current) return

      if (answer.success) {
        const byId = new Map(answer.data.map(result => [result.id, result]))

        updateRows(current, rows.map(row => applyRefill(row, byId.get(row.id))))
      } else {
        // The rows go on to be verified as they stand; the reason is kept on
        // each, so the review table says why nothing was filled.
        updateRows(
          current,
          rows.map(row => ({
            ...row,
            status: 'pending' as const,
            refill: { source: null, filled: [], message: answer.error.message }
          }))
        )
      }
    }
  } finally {
    stop()
  }
}

const verify = async (current: number, rows: BulkRow[], accountsOf: (platform: string) => string[]): Promise<void> => {
  const total = rows.length
  let done = 0

  set({ phase: 'verifying', progress: { label: 'Verifying rows against VMS and the platform rules…', done, total } })

  await runPool(
    rows,
    PREPARE_CONCURRENCY,
    async row => {
      updateRow(current, { ...row, status: 'preparing' })
      try {
        return await prepareRow(row, accountsOf)
      } catch (error) {
        return { ...row, status: 'invalid' as const, errors: [error instanceof Error ? error.message : String(error)] }
      }
    },
    prepared => {
      done += 1
      updateRow(current, prepared)
      if (run === current) set({ progress: { label: 'Verifying rows against VMS and the platform rules…', done, total } })
    },
    () => run !== current
  )
}

/* -------------------------------------------------------------------------- *
 * What the dialog calls
 * -------------------------------------------------------------------------- */

/** Upload → refill → verify → review. Replaces any run in hand. */
export const startBulkRun = async (
  file: File | undefined,
  sheets: PlatformSheet[],
  accountsOf: (platform: string) => string[]
): Promise<void> => {
  discardBulkRun()
  const current = run

  set({ phase: 'reading', progress: null })

  const result = await bulkSheetRead(file)

  if (run !== current) return

  if (!result.success) {
    set({ phase: 'idle' })
    if (result.error.message !== 'Cancelled') toast.error(result.error.message)
    return
  }

  const { rows: parsed, unknownSheets } = rowsFromWorkbook(result.data, sheets)

  if (unknownSheets.length > 0) {
    toast.error(
      `Skipped sheet${unknownSheets.length > 1 ? 's' : ''} not matching a platform: ${unknownSheets.join(', ')}`
    )
  }
  if (parsed.length === 0) {
    set({ phase: 'idle' })
    toast.error('No claim rows found — fill the platform sheets of the template')
    return
  }

  set({ fileName: result.data.fileName, rows: markDuplicates(parsed) })

  await refill(current)
  if (run !== current) return

  await verify(current, state.rows.filter(row => row.status === 'pending'), accountsOf)
  if (run !== current) return

  set({ phase: 'review', progress: null })
  toast.success('Bulk claim checked — review the rows, then Proceed')
}

/** The edit dialog's Save: the row with its new cells, refilled if it still needs it, then checked again. */
export const reverifyBulkRow = async (
  id: string,
  cells: Record<string, string>,
  accountsOf: (platform: string) => string[]
): Promise<void> => {
  const current = run
  const row = state.rows.find(entry => entry.id === id)

  if (!row || isBusy(state.phase)) return

  let next = editRow(row, cells)

  updateRow(current, next)

  if (needsRefill(next)) {
    updateRow(current, { ...next, status: 'refilling' })

    const answer = await bulkRefill({
      runId: `bulk-edit-${current}-${Date.now()}`,
      platform: next.platform.record.name,
      rows: [refillRequestRow(next)]
    })

    if (run !== current) return
    next = answer.success ? applyRefill(next, answer.data[0]) : { ...next, status: 'pending' }
  }

  updateRow(current, { ...next, status: 'preparing' })

  let prepared: BulkRow

  try {
    prepared = await prepareRow(next, accountsOf)
  } catch (error) {
    prepared = { ...next, status: 'invalid', errors: [error instanceof Error ? error.message : String(error)] }
  }

  updateRow(current, prepared)
}

/** Proceed: files every ready row, as the form's Save does. */
export const proceedBulkRun = async (feedId: string): Promise<void> => {
  const current = run
  const ready = state.rows.filter(row => row.status === 'ready')

  if (ready.length === 0 || isBusy(state.phase)) return

  let done = 0

  set({ phase: 'creating', progress: { label: 'Saving claims…', done, total: ready.length } })

  await runPool(
    ready,
    CREATE_CONCURRENCY,
    async row => {
      updateRow(current, { ...row, status: 'creating' })
      return createRow(row, feedId)
    },
    created => {
      done += 1
      updateRow(current, created)
      if (run === current) set({ progress: { label: 'Saving claims…', done, total: ready.length } })
    },
    () => run !== current
  )

  if (run !== current) return

  const created = state.rows.filter(row => row.status === 'created').length
  const failed = state.rows.filter(row => row.status === 'failed').length

  set({ phase: 'done', progress: null })
  if (failed > 0) toast.error(`${created} claim(s) saved, ${failed} failed — see the table`)
  else toast.success(`${created} claim(s) saved`)
}
