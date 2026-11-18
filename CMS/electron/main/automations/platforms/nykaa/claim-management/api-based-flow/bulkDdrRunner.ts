import type { NykaaDdrResultRow } from '@shared/types/nykaaBulkDdr'
import { ticketEntry, type DdrEntry, type DdrGroup, type NykaaTicketEntry } from './bulkDdrSheet'

/**
 * Files one Nykaa login's DDR rows, one ticket at a time.
 *
 * The filing is the core's `fileNykaaClaim` — the same sequence a single claim
 * and the automation server use: it looks the return AWB up in the account's
 * ticket list first and reports an existing ticket rather than raising a second
 * one, and `createTicket` paces itself between tickets.
 *
 * Dependencies are passed in so this has no Electron or session code in it and
 * every outcome below is testable.
 */

interface FiledTicket {
  ticketId: string
  alreadyExisted: boolean
}

export interface DdrRunnerDeps {
  /** The account's claim context. `fresh` after Nykaa said the session expired. */
  openContext: (account: string, fresh: boolean) => Promise<unknown>
  fileClaim: (ctx: unknown, entry: NykaaTicketEntry, awb: string) => Promise<FiledTicket>
  template: { subject: string; body: string }
  /** Checked before every row: true stops the account where it is. */
  shouldStop: () => Promise<boolean>
  onResult: (row: NykaaDdrResultRow) => Promise<void>
  attemptOf: (entry: DdrEntry) => number
}

const errorCode = (error: unknown): string =>
  typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : ''

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const resultRow = (
  account: string,
  entry: DdrEntry,
  attempt: number,
  fields: Pick<NykaaDdrResultRow, 'result' | 'reason' | 'ticketNumber'>
): NykaaDdrResultRow => ({
  sheetRow: entry.sheetRow,
  awb: entry.awb,
  sku: entry.sku,
  vendorCode: entry.vendorCode,
  returnType: entry.returnType,
  account,
  attempt,
  timestamp: new Date().toISOString(),
  ...fields
})

/**
 * Returns `stopped: true` when `shouldStop` cut the account short — the rows it
 * never reached are left for the caller to settle.
 */
export const runDdrGroup = async (group: DdrGroup, deps: DdrRunnerDeps): Promise<{ stopped: boolean }> => {
  const { account } = group
  let ctx: unknown

  try {
    ctx = await deps.openContext(account, false)
  } catch (error) {
    // Every row for this account depended on the session — each fails with it.
    const reason = `Nykaa login could not be used: ${errorText(error)}`

    for (const entry of group.entries) {
      await deps.onResult(resultRow(account, entry, deps.attemptOf(entry), { result: 'Failed', reason, ticketNumber: '' }))
    }

    return { stopped: false }
  }

  let renewed = false

  for (const [index, entry] of group.entries.entries()) {
    if (await deps.shouldStop()) return { stopped: true }

    const attempt = deps.attemptOf(entry)
    const ticket = ticketEntry(entry, deps.template)

    const file = async (): Promise<NykaaDdrResultRow> => {
      const filed = await deps.fileClaim(ctx, ticket, entry.awb)

      return filed.alreadyExisted
        ? resultRow(account, entry, attempt, {
            result: 'Already Filed',
            reason: `Nykaa already has ticket #${filed.ticketId} for this return AWB — no new ticket raised`,
            ticketNumber: filed.ticketId
          })
        : resultRow(account, entry, attempt, { result: 'Success', reason: '', ticketNumber: filed.ticketId })
    }

    const sessionLost = async (error: unknown): Promise<{ stopped: boolean }> => {
      await deps.onResult(failedRow(account, entry, attempt, error))
      await failRest(group.entries.slice(index + 1), account, deps, 'Nykaa session expired and could not be renewed')

      return { stopped: false }
    }

    let row: NykaaDdrResultRow

    try {
      row = await file()
    } catch (error) {
      if (errorCode(error) !== 'AUTH_EXPIRED') {
        row = failedRow(account, entry, attempt, error)
      } else if (renewed) {
        return sessionLost(error)
      } else {
        // Once per account: a run of hundreds can outlive a Nykaa session.
        // `claimCredentials` decides whether renewing is allowed here.
        renewed = true

        try {
          ctx = await deps.openContext(account, true)
        } catch (renewError) {
          return sessionLost(renewError)
        }

        try {
          row = await file()
        } catch (retryError) {
          if (errorCode(retryError) === 'AUTH_EXPIRED') return sessionLost(retryError)

          row = failedRow(account, entry, attempt, retryError)
        }
      }
    }

    await deps.onResult(row)
  }

  return { stopped: false }
}

const failedRow = (account: string, entry: DdrEntry, attempt: number, error: unknown): NykaaDdrResultRow => {
  const code = errorCode(error)

  if (code === 'CLAIM_SUBMIT_DISABLED') {
    return resultRow(account, entry, attempt, {
      result: 'Dry Run',
      reason: 'Claim submit is disabled on this build — nothing was filed',
      ticketNumber: ''
    })
  }

  return resultRow(account, entry, attempt, {
    result: 'Failed',
    reason: code === 'RATE_LIMITED' ? `Nykaa is rate-limiting — retry later (${errorText(error)})` : errorText(error),
    ticketNumber: ''
  })
}

const failRest = async (entries: DdrEntry[], account: string, deps: DdrRunnerDeps, reason: string): Promise<void> => {
  for (const entry of entries) {
    await deps.onResult(resultRow(account, entry, deps.attemptOf(entry), { result: 'Failed', reason, ticketNumber: '' }))
  }
}
