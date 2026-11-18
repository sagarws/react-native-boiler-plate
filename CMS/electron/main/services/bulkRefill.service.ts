import { CLAIM_CREATE_EVENTS } from '@shared/constants/channels'
import { refillFieldsFor } from '@shared/constants/refill'
import type {
  BulkRefillProgress,
  BulkRefillResult,
  BulkRefillRow,
  BulkRefillValues
} from '@shared/types/bulkRefill'
import type { RefillField } from '@shared/types/refill'
import { fail, ok, type Result } from '@shared/types/result'
import { platformKey } from '@shared/utils/platformKey'
import type { MappingCredential } from '@main/automations/accountMapping/types'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { processName, withProcessLogResult } from '@main/automations/common/processLog'
import { refillPlatform } from '@main/automations/refill/registry'
import type { RefillValues } from '@main/automations/refill/types'
import { broadcast } from '../ipc/broadcast'
import { ProbePool } from './accountMapping.service'
import { withAutomationLock } from './automationLock'
import { logger } from './logger'
import { mappingAccounts } from './mappingAccounts.service'
import { closeRefillContexts } from './refill.service'
import { withoutSignIn } from './signInPolicy'

/**
 * Refill for Normal Bulk Claim — see shared/types/bulkRefill.ts.
 *
 * ORCHESTRATION ONLY. Where an answer comes from is the refill registry's: the
 * `local` entry reads this machine's report backup, `resolve` asks the
 * marketplace. Nothing here names a platform.
 *
 * FILLS BLANKS, WRITES NOTHING. A value the operator typed is never replaced,
 * and nothing is sent to TrackVid — the rows are not claims until Proceed.
 */

/** A sheet is a few hundred rows at most; more is a mistake worth refusing. */
const MAX_ROWS = 2000

/** The account-mapping engine in the core — the same one Refill Data probes with. */
interface MappingEngine {
  mapAwbToAccount: (input: {
    awb: string
    alternates?: string[]
    accounts: MappingCredential[]
    probe: (account: MappingCredential, awb: string, alternates: string[]) => Promise<{ found: boolean }>
    keyOf?: (account: MappingCredential) => string
    recent?: unknown
    logger?: unknown
  }) => Promise<{ matched: MappingCredential | null }>
  describeMiss: (awb: string, result: unknown) => string
  RecentFirst: new () => unknown
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const rowsOf = (value: unknown): BulkRefillRow[] =>
  (Array.isArray(value) ? value : [])
    .map(raw => {
      const row = (raw ?? {}) as Record<string, unknown>

      return {
        id: text(row.id),
        awb: text(row.awb),
        account: text(row.account),
        forwardAWB: text(row.forwardAWB),
        subOrderNumber: text(row.subOrderNumber),
        sku: text(row.sku),
        pobId: text(row.pobId)
      }
    })
    .filter(row => row.id && row.awb)

/** One row's answers so far, and where they came from. */
interface Working {
  row: BulkRefillRow
  values: BulkRefillValues
  local: boolean
  marketplace: boolean
  message: string | null
}

/** Fills `key` only when the row and earlier answers left it blank. */
const fillBlank = (work: Working, key: keyof BulkRefillValues, value: string | null | undefined): boolean => {
  const next = text(value)

  // The row and its answers share field names, so the row is checked by the same key.
  if (!next || work.row[key] || work.values[key]) return false

  work.values[key] = next

  return true
}

/** What a row is still missing that this platform's marketplace could answer. */
const stillWanted = (work: Working, offered: RefillField[]): RefillField[] =>
  offered.filter(field => {
    if (field === 'accountMapping') return !work.row.account && !work.values.account
    if (field === 'subOrderNumber') return !work.row.subOrderNumber && !work.values.subOrderNumber
    if (field === 'forwardAwbNumber') return !work.row.forwardAWB && !work.values.forwardAWB
    if (field === 'sellerSku') return !work.row.sku && !work.values.sku
    if (field === 'pobId') return !work.row.pobId && !work.values.pobId

    return false
  })

const sourceOf = (work: Working): BulkRefillResult['source'] =>
  work.local && work.marketplace ? 'both' : work.local ? 'local' : work.marketplace ? 'marketplace' : null

export const refillBulkRows = async (payload: unknown): Promise<Result<BulkRefillResult[]>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const runId = text(input.runId)
  const platform = platformKey(text(input.platform))
  const rows = rowsOf(input.rows)

  if (!runId) return fail('VALIDATION_ERROR', 'No run was named')
  if (!platform) return fail('VALIDATION_ERROR', 'No platform was given')
  if (rows.length === 0) return ok([])
  if (rows.length > MAX_ROWS) {
    return fail('VALIDATION_ERROR', `At most ${MAX_ROWS} rows can be refilled at once`)
  }

  return withProcessLogResult(processName(platform, 'bulk refill', `${rows.length} row(s)`), () =>
    refillRows(runId, platform, rows)
  )
}

const refillRows = async (
  runId: string,
  platform: string,
  rows: BulkRefillRow[]
): Promise<Result<BulkRefillResult[]>> => {
  const entry = refillPlatform(platform)
  const working: Working[] = rows.map(row => ({
    row,
    values: {},
    local: false,
    marketplace: false,
    message: null
  }))

  const publish = (step: BulkRefillProgress['step'], done: number, total: number, current: string | null): void => {
    broadcast(CLAIM_CREATE_EVENTS.bulkRefillProgress, { runId, platform, step, done, total, current })
  }

  // ── 1. The report backup on this machine ─────────────────────────────────
  if (entry?.local) {
    for (const [index, work] of working.entries()) {
      publish('local', index, working.length, work.row.awb)

      try {
        const found = await entry.local(work.row.awb)

        if (found) {
          const filled = [
            fillBlank(work, 'forwardAWB', found.forwardAWB),
            fillBlank(work, 'subOrderNumber', found.subOrderNumber),
            fillBlank(work, 'sku', found.sku),
            fillBlank(work, 'pobId', found.pobId),
            fillBlank(work, 'account', found.username)
          ]

          work.local = filled.some(Boolean)
        } else {
          work.message = `${work.row.awb} is not in this machine's ${platform} report backup`
        }
      } catch (error) {
        work.message = `The local backup could not be read — ${error instanceof Error ? error.message : String(error)}`
      }
    }

    publish('local', working.length, working.length, null)
  }

  // ── 2. The marketplace, for what the backup could not answer ─────────────
  // Offline platforms answer from disk only: their resolver IS the backup.
  const offered = refillFieldsFor(platform).filter(field => field !== 'statusChange')
  const wanting = entry && !entry.offline ? working.filter(work => stillWanted(work, offered).length > 0) : []
  const accounts = wanting.length > 0 ? await mappingAccounts(platform) : []

  // ONE LOGIN, ONE POSSIBLE ACCOUNT — written without asking. A row whose only
  // blank was the account then needs no browser at all.
  if (accounts.length === 1) {
    for (const work of wanting) {
      if (fillBlank(work, 'account', accounts[0]?.username)) work.marketplace = true
    }
  }

  const pending = wanting.filter(work => stillWanted(work, offered).length > 0)

  if (pending.length > 0 && entry) {
    const outcome = await askMarketplace(platform, entry.resolve, pending, offered, accounts, (done, current) =>
      publish('marketplace', done, pending.length, current)
    )

    if (!outcome.success) {
      for (const work of pending) work.message = work.message ?? outcome.error.message
    }
  }

  return ok(
    working.map(work => {
      const blank = stillWanted(work, offered)

      return {
        id: work.row.id,
        values: work.values,
        source: sourceOf(work),
        // A row with nothing left to find carries no message, whatever the
        // backup said on the way: the marketplace answered it.
        message: blank.length === 0 ? null : work.message
      }
    })
  )
}

/**
 * Asks the marketplace through Refill Data's own resolver and account probes.
 *
 * Under the automation lock, like every marketplace session, and WITHOUT
 * SIGNING IN: a login that is not live is skipped rather than prompting for a
 * one-time code in the middle of a batch. Its rows keep their blanks and the
 * operator edits them.
 */
const askMarketplace = async (
  platform: string,
  resolve: NonNullable<ReturnType<typeof refillPlatform>>['resolve'],
  pending: Working[],
  offered: RefillField[],
  accounts: MappingCredential[],
  onProgress: (done: number, current: string | null) => void
): Promise<Result<true>> => {
  if (accounts.length === 0) {
    return fail('VALIDATION_ERROR', `No ${platform} logins are configured, so the marketplace could not be asked`)
  }

  return withAutomationLock('bulk-refill', () =>
    withoutSignIn(async () => {
      await prepareCoreWithBrowser(message => logger.info(`[bulk-refill] ${message}`), platform)

      const { mapAwbToAccount, describeMiss, RecentFirst } = loadCore<MappingEngine>('common/accountMapping')
      const pool = new ProbePool(platform)
      const recent = new RecentFirst()
      const contexts = new Map<string, unknown>()
      const only = accounts.length === 1 ? (accounts[0]?.username ?? '') : ''

      try {
        for (const [index, work] of pending.entries()) {
          onProgress(index, work.row.awb)

          try {
            let username = work.row.account || work.values.account || only

            if (!username) {
              const result = await mapAwbToAccount({
                awb: work.row.awb,
                alternates: [work.row.subOrderNumber].filter(Boolean),
                accounts,
                probe: async (account, awb, alternates) => (await pool.probe(account)).ask(awb, alternates),
                keyOf: account => account.username,
                recent,
                logger
              })

              username = result.matched?.username ?? ''

              if (!username) {
                work.message = describeMiss(work.row.awb, result)
                continue
              }
            }

            if (fillBlank(work, 'account', username)) work.marketplace = true

            const fields = stillWanted(work, offered).filter(field => field !== 'accountMapping')

            if (fields.length === 0) continue

            const answer: RefillValues = await resolve({
              doc: { AWBNumber: work.row.awb, subOrderNumber: work.row.subOrderNumber || work.values.subOrderNumber || '' },
              awb: work.row.awb,
              username,
              ticketNumber: null,
              fields,
              contexts
            })

            if (answer.missing) {
              work.message = answer.missing
              continue
            }

            const filled = [
              fillBlank(work, 'subOrderNumber', answer.subOrderNumber),
              fillBlank(work, 'forwardAWB', answer.forwardAWB),
              fillBlank(work, 'sku', answer.sellerSku),
              fillBlank(work, 'pobId', answer.pobId)
            ]

            if (filled.some(Boolean)) work.marketplace = true
          } catch (error) {
            // One row, not the batch: the rest are still worth asking.
            work.message = `${platform} did not answer — ${error instanceof Error ? error.message : String(error)}`
            logger.warn(`[bulk-refill] ${platform} ${work.row.awb}: ${work.message}`)
          }
        }

        onProgress(pending.length, null)

        return ok(true as const)
      } finally {
        await pool.closeAll()
        await closeRefillContexts(contexts)
      }
    })
  )
}
