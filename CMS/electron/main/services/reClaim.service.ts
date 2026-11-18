import { randomUUID } from 'node:crypto'
import { app, dialog } from 'electron'
import { basename, join } from 'node:path'
import type {
  ReClaimJobArchive,
  ReClaimProgress,
  ReClaimResult,
  ReClaimRow,
  ReClaimSheet,
  ReClaimSummary,
  ReClaimTicket
} from '@shared/types/reClaim'
import { RE_CLAIM_EVENTS } from '@shared/constants/channels'
import {
  RE_CLAIM_BATCH_SIZE,
  batchCountFor,
  batchOf
} from '@shared/constants/reClaim'
import { broadcast } from '../ipc/broadcast'
import { fail, ok, type Result } from '@shared/types/result'
import { claimCredentials } from './claimSession.service'
import { credentialsFor } from './company.service'
import { withAutomationLock } from './automationLock'
import { loadCore } from '../automations/common/coreLoader'
import { logger } from './logger'
import { automationsHalted } from './schedulerPause.store'
import { writeReClaimJob } from './reClaimArchive.store'
import { reportClaimActivity } from './claimActivity.service'

/**
 * Re-claim — reopening a Myntra claim that has already been decided.
 *
 * A rejected SPF claim is not the end of it: the partner portal lets a seller
 * dispute one with an argument and the same proofs, and Myntra re-validates.
 * The operator brings a rejection export and works down it.
 *
 * A SHEET ROW IS AN INSTRUCTION, NOT A PAYLOAD. The export carries the ticket,
 * its category and its dates; the dispute needs the order, the return, the
 * tracking id, the SKU, the style and the proof URLs — none of which are in it.
 * Those are read back from Myntra by ticket id, which is also the only way to
 * be sure they still match what Myntra holds. So each row is: fetch, build,
 * dispute, read back.
 *
 * ONE TICKET AT A TIME, pressed per row. A sheet of rejections is not a batch
 * to fire off — each dispute is an argument a person is making, and the
 * description is theirs to write.
 */

interface HumanPace {
  pacedPause: (
    index: number,
    options: { baseMs?: number; ratio?: number; onWait?: (ms: number) => void }
  ) => Promise<number>
}

interface ReClaimCore {
  readReClaimSheet: (path: string) => { rows: ReClaimRow[]; missing: string[] }
  /** Writes the blank export. Built from the same column list the reader uses. */
  writeReClaimTemplate: (outputPath: string) => string
  /** The columns read. `REQUIRED_SHEET_COLUMNS` are the ones a row is useless without. */
  SHEET_COLUMNS: string[]
  REQUIRED_SHEET_COLUMNS: string[]
  buildFwTicketPayload: (
    claim: Record<string, unknown>,
    // No `returnReason`: the dispute is always filed under "Others", fixed in
    // the core so no caller can send a value the portal never sends.
    input: { description: string; issueCategory?: string }
  ) => Record<string, unknown>
  createFwTicket: (
    jar: Record<string, string>,
    payload: Record<string, unknown>
  ) => Promise<{ ok: boolean; message: string; row: Record<string, unknown> | null }>
}

interface MyntraFlow {
  fetchClaimByTicketId: (jar: Record<string, string>, ticketId: string) => Promise<ReClaimTicket>
}

const core = (): ReClaimCore =>
  loadCore<ReClaimCore>('platforms/myntra/re-claim/api-based-flow/reClaim')

const flow = (): MyntraFlow =>
  loadCore<MyntraFlow>('platforms/myntra/claim-management/api-based-flow/claimApiFlow')

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Tries to read the ticket back, and says so in the log when it cannot. */
const readTicket = async (
  jar: Record<string, string>,
  ticketId: string
): Promise<ReClaimTicket | null> => {
  try {
    return await flow().fetchClaimByTicketId(jar, ticketId)
  } catch (error) {
    // Logged rather than swallowed. A read-back that quietly returns null is
    // why a whole run showed "Raised" instead of Myntra's own word for what
    // happened, with nothing anywhere saying why.
    logger.warn(
      `[re-claim] ${ticketId}: could not read the ticket back — ${
        error instanceof Error ? error.message : String(error)
      }`
    )

    return null
  }
}

/** How long Myntra is given to move a disputed ticket off its old status. */
const READ_BACK_TRIES = 3
const READ_BACK_GAP_MS = 1200

/**
 * Reads the ticket back after a dispute, waiting for the status to actually
 * change.
 *
 * The dispute and the status are two different systems at Myntra's end: the
 * POST returns before the ticket has moved, so an immediate read hands back the
 * status the ticket had BEFORE — REJECTED, the very thing being disputed — or
 * nothing at all. Re-reading until it differs from `priorStatus` is what turns
 * the row's pill into AWAITING_AGENT_RESPONSE rather than this app's own word.
 *
 * Only for an accepted dispute. A refusal legitimately leaves the status where
 * it was, and waiting for a change that is never coming would add four seconds
 * to every failure in the run.
 */
const readBackAfterDispute = async (
  jar: Record<string, string>,
  ticketId: string,
  priorStatus: string | null
): Promise<ReClaimTicket | null> => {
  let latest: ReClaimTicket | null = null

  for (let attempt = 0; attempt < READ_BACK_TRIES; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, READ_BACK_GAP_MS))

    const ticket = await readTicket(jar, ticketId)

    // Kept even when it is unchanged — a stale status is still better than the
    // fallback word, and it is what is returned if the wait runs out.
    if (ticket?.found) latest = ticket

    if (ticket?.status && ticket.status !== priorStatus) return ticket
  }

  return latest
}

/**
 * The Myntra login these calls run as.
 *
 * The portal scopes a ticket to the seller whose session asks, so the account
 * is not a preference — a dispute sent with the wrong one simply cannot see the
 * ticket. Named explicitly when the company has several, and the only one used
 * when it has one.
 */
const myntraSession = async (username?: string): Promise<Result<Record<string, string>>> => {
  const accounts = await credentialsFor('myntra')
  const usable = accounts.filter(account => account.username.length > 0)

  if (usable.length === 0) return fail('VALIDATION_ERROR', 'No Myntra login is configured')

  const wanted = text(username)
  const chosen = wanted
    ? usable.find(account => account.username.toLowerCase() === wanted.toLowerCase())
    : usable.length === 1
      ? usable[0]
      : undefined

  if (!chosen) {
    return fail(
      'VALIDATION_ERROR',
      wanted
        ? `${wanted} is not a Myntra login on this company`
        : `This company has ${usable.length} Myntra logins — choose which one to dispute from`
    )
  }

  const credentials = await claimCredentials('myntra', chosen.username)
  // Myntra's flow takes the jar itself rather than a context object.
  const jar = (credentials.context as { jar?: Record<string, string> })?.jar ?? credentials.jar

  return ok(jar)
}

/** The Myntra accounts a dispute can be sent from. */
export const reClaimAccounts = async (): Promise<Result<string[]>> => {
  const accounts = await credentialsFor('myntra')

  return ok(accounts.map(account => account.username).filter(name => name.length > 0))
}

/**
 * Writes the blank rejection export wherever the operator asks for it.
 *
 * The sheet Myntra exports is the intended input, but an operator working from
 * a ticket list in an email or a message has nothing to upload — and the one
 * column that matters, `ticketId`, is not guessable from the modal's text alone.
 * The template is the same columns the reader looks for, written by the core so
 * the two cannot drift.
 */
export const downloadReClaimTemplate = async (): Promise<Result<{ path: string }>> => {
  const chosen = await dialog.showSaveDialog({
    title: 'Save the re-claim template',
    defaultPath: join(app.getPath('downloads'), 'myntra-re-claim-template.xlsx'),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  // Same word the bulk-claim template uses, and the renderer swallows it rather
  // than showing a toast — closing a save dialog is not a failure.
  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    return ok({ path: core().writeReClaimTemplate(chosen.filePath) })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}

export const chooseReClaimSheet = async (): Promise<Result<ReClaimSheet>> => {
  const chosen = await dialog.showOpenDialog({
    title: 'Choose the rejection export',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }]
  })

  const path = chosen.filePaths[0]

  if (chosen.canceled || !path) return fail('VALIDATION_ERROR', 'No file chosen')

  try {
    const { readReClaimSheet, REQUIRED_SHEET_COLUMNS } = core()
    const { rows, missing } = readReClaimSheet(path)

    if (rows.length === 0) {
      return fail('VALIDATION_ERROR', 'That sheet has no rows under its header')
    }

    // REFUSED now, where it used to be a warning.
    //
    // It was right to warn when fourteen columns were "expected": a sheet
    // without `closedOn` was still a sheet of tickets. The sheet now asks for
    // three, two of which the dispute cannot be built without — so a file
    // missing one is not thin, it is the wrong file, and letting it through
    // would produce a table of rows that each fail individually for the same
    // reason nobody was told.
    const required = missing.filter(column => REQUIRED_SHEET_COLUMNS.includes(column))

    if (required.length > 0) {
      return fail(
        'VALIDATION_ERROR',
        `That sheet has no ${required.join(' or ')} column — download the template to see the ` +
          'columns a dispute needs.'
      )
    }

    // `issueCategory` absent is normal and not worth a word: it is optional,
    // and every row falls back to the category Myntra already has.

    return ok({ path, source: 'file', rows, missing })
  } catch (error) {
    return fail(
      'VALIDATION_ERROR',
      error instanceof Error ? `That file could not be read — ${error.message}` : 'Unreadable file'
    )
  }
}

/**
 * Rows typed into the app instead of uploaded.
 *
 * The same `ReClaimSheet` the file path produces, so everything downstream —
 * the table, the selection, the run, the archive — cannot tell the difference
 * and does not need to. An operator disputing four tickets off a message should
 * not have to build a spreadsheet to do it.
 *
 * Validated HERE rather than trusted from the renderer: this is the boundary,
 * and the same two rules the sheet is held to apply — a ticket id and an
 * argument, category optional.
 */
export const manualReClaimRows = (payload: unknown): Result<ReClaimSheet> => {
  const entries = Array.isArray((payload as { rows?: unknown })?.rows)
    ? ((payload as { rows: unknown[] }).rows)
    : []

  const rows: ReClaimRow[] = []
  const bad: number[] = []

  entries.forEach((entry, index) => {
    const source = (entry ?? {}) as {
      ticketId?: unknown
      description?: unknown
      issueCategory?: unknown
    }
    const ticketId = text(source.ticketId)
    const description = text(source.description)

    // A half-filled row is the operator still typing, not an error to report —
    // it is dropped. One with a ticket and no argument (or the reverse) is a
    // mistake, and is named by its position so they can find it.
    if (!ticketId && !description) return
    if (!ticketId || !description) {
      bad.push(index + 1)

      return
    }

    rows.push({
      // 1-based like the sheet's, so the table's column means one thing.
      rowNumber: rows.length + 1,
      ticketId,
      description,
      issueCategory: text(source.issueCategory),
      // No sheet behind these, so the row's own three fields ARE the raw cells.
      // Keyed as the sheet keys them, because the table reads `raw`.
      raw: { ticketId, 'RR Remarks': description, issueCategory: text(source.issueCategory) }
    })
  })

  if (bad.length > 0) {
    return fail(
      'VALIDATION_ERROR',
      `Row ${bad.join(', ')} needs both a ticket id and remarks — the category is optional.`
    )
  }

  if (rows.length === 0) return fail('VALIDATION_ERROR', 'Add a ticket id and its remarks first')

  return ok({ path: null, source: 'manual', rows, missing: [] })
}

/** What Myntra currently holds for one ticket. A read; nothing is changed. */
export const reClaimTicket = async (payload: unknown): Promise<Result<ReClaimTicket>> => {
  const request = (payload ?? {}) as { ticketId?: unknown; username?: unknown }
  const ticketId = text(request.ticketId)

  if (!ticketId) return fail('VALIDATION_ERROR', 'That row has no ticket id')

  const session = await myntraSession(text(request.username))

  if (!session.success) return session

  try {
    return ok(await flow().fetchClaimByTicketId(session.data, ticketId))
  } catch (error) {
    return fail(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Could not read the ticket from Myntra'
    )
  }
}

/**
 * Reopens one ticket, then reads it back.
 *
 * The read-back is the point of the second call: `createFwTicket` answers
 * "dispute raised", and what an operator needs next is what Myntra now SAYS
 * about the ticket — the new status, and the reason behind it.
 */
/**
 * One dispute, WITHOUT the lock.
 *
 * The lock belongs to the unit of work, and there are two: a single ticket an
 * operator pressed, and a bulk run over a sheet. The run holds it once for the
 * whole sheet — so the per-ticket step must not take it again. It is FIFO and
 * not reentrant, and a run that took it twice waited on itself: 751 tickets
 * stuck at 0, forever, which is exactly what happened.
 *
 * The same split the claim processor already makes between `runClaim` and
 * `processClaims`, and for the same reason.
 */
const disputeOne = async (payload: unknown): Promise<Result<ReClaimResult>> => {
  const request = (payload ?? {}) as {
    ticketId?: unknown
    description?: unknown
    issueCategory?: unknown
    username?: unknown
  }

  const ticketId = text(request.ticketId)
  const description = text(request.description)

  if (!ticketId) return fail('VALIDATION_ERROR', 'That row has no ticket id')
  if (!description) {
    // The argument IS the dispute. Myntra accepts an empty one and simply
    // rejects it again, which costs the seller their one reopen.
    return fail('VALIDATION_ERROR', 'Write the reason for disputing this claim first')
  }

  const session = await myntraSession(text(request.username))

  if (!session.success) return session

  const jar = session.data

  try {
      const { buildFwTicketPayload, createFwTicket } = core()
      const { fetchClaimByTicketId } = flow()

      // Read FIRST. The dispute needs half a dozen identifiers the sheet does
      // not carry, and reading them back is also what proves the ticket is
      // still the one the sheet is talking about.
      const before = await fetchClaimByTicketId(jar, ticketId)

      if (!before.found || !before.row) {
        // A RESULT, not a failure. Everything below reports itself in the
        // ticket window — where the operator already is — and a `fail` here
        // would send this one message to a toast instead, alone and without the
        // payload that explains it.
        return ok({
          ticketId,
          ok: false,
          message: `Myntra has no ticket ${ticketId} on this account — check the account, or the sheet.`,
          ticket: before,
          payload: null,
          error: 'The ticket could not be read, so nothing was sent.'
        })
      }

      const body = buildFwTicketPayload(before.row, {
        description,
        issueCategory: text(request.issueCategory)
      })

      let raised: { ok: boolean; message: string }

      try {
        raised = await createFwTicket(jar, body)
      } catch (error) {
        // The payload travels with the failure. A refused dispute is nearly
        // always a payload question, and a sentence on its own cannot say
        // which part Myntra objected to.
        return ok({
          ticketId,
          ok: false,
          message: 'Myntra refused the dispute',
          ticket: before,
          payload: body,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      logger.info(`[re-claim] ${ticketId}: ${raised.ok ? 'disputed' : 'refused'} — ${raised.message}`)

      // Read back whatever happened, including a refusal: the reason Myntra
      // gives is on the ticket, not in the reply.
      const after = raised.ok
        ? await readBackAfterDispute(jar, ticketId, before.status)
        : await readTicket(jar, ticketId)

      return ok({
        ticketId,
        ok: raised.ok,
        message: raised.message,
        ticket: after,
        // Shown on success too — "what did we actually send" is the first
        // question when a dispute lands and then goes nowhere.
        payload: body,
        error: raised.ok ? null : raised.message
      })
  } catch (error) {
    return fail(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Could not reopen the ticket'
    )
  }
}

/**
 * One dispute, pressed on its own.
 *
 * Takes the lock — it is a marketplace write, and two of them against one
 * seller session at once is what the lock exists to stop. The bulk run does not
 * come through here; it holds the lock itself and calls `disputeOne` directly.
 */
export const submitReClaim = async (payload: unknown): Promise<Result<ReClaimResult>> => {
  const result = await withAutomationLock('re-claim', () => disputeOne(payload))

  // The Re-Open column of the Accounts page: only a dispute Myntra accepted.
  if (result.success && result.data.ok) await reportClaimActivity({ reOpenClaims: 1 })

  return result
}


/* ------------------------------------------------------------------------- *
 * The bulk run.
 *
 * Same three calls per ticket as pressing one row — read, dispute, read back —
 * but worked down the whole sheet, and PACED. Forty identical requests exactly
 * five seconds apart is not a person, and Myntra's portal is the kind that
 * eventually notices; a randomised gap costs nothing and does not look like a
 * script.
 *
 * STOPPABLE, and stoppable is not the same as cancellable: the ticket in flight
 * finishes. Abandoning a dispute half-sent is how a ticket ends up reopened
 * with nobody's record of it.
 * ------------------------------------------------------------------------- */

/** The gap between tickets, before jitter. Roughly a person reading a row. */
const BASE_GAP_MS = 5000

let progress: ReClaimProgress | null = null
let stopping = false

export const reClaimProgress = (): Result<ReClaimProgress | null> => ok(progress)

/** Ends the run after the ticket in flight — never mid-dispute. */
export const stopReClaim = (): Result<{ stopping: boolean }> => {
  if (progress?.running) stopping = true

  return ok({ stopping })
}

/**
 * Starts a run and hands back its job id.
 *
 * FIRE AND FORGET, deliberately. This used to be awaited: the renderer called
 * it and sat on the promise until the last ticket, which made the modal the
 * run's owner — close it, or navigate away, and the operator had no way back to
 * a run that was still going and no record of it afterwards. A run of several
 * hundred tickets is hours of that.
 *
 * So it returns as soon as the job exists. Progress arrives on the same
 * broadcast it always did, the job is written to disk before the first dispute
 * and again when it ends, and the Jobs page is where it is read back. Nothing
 * about the run depends on a window staying open.
 *
 * The automation lock is taken INSIDE the detached work, not around this
 * function: the lock queues, so a claim dispatched mid-run waits its turn
 * rather than being refused — but the caller must not wait with it.
 */
export const startBulkReClaim = async (payload: unknown): Promise<Result<{ jobId: string }>> => {
  const request = (payload ?? {}) as {
    tickets?: unknown
    description?: unknown
    username?: unknown
    source?: unknown
    fileName?: unknown
  }

  // A fallback, not the source. Every row carries its own argument now (the
  // sheet's "RR Remarks"); this is what a row that somehow arrived without one
  // falls back to, which keeps an older caller that sent only a global
  // description working exactly as it did.
  const fallback = text(request.description)

  const tickets = Array.isArray(request.tickets)
    ? request.tickets
        .map(entry => {
          const row = (entry ?? {}) as {
            ticketId?: unknown
            description?: unknown
            issueCategory?: unknown
          }

          return {
            ticketId: text(row.ticketId),
            description: text(row.description) || fallback,
            issueCategory: text(row.issueCategory)
          }
        })
        .filter(entry => entry.ticketId.length > 0 && entry.description.length > 0)
    : []

  // The in-flight run is stopped by `stopReClaim` when the switch goes off;
  // this stops a new one starting while it is off.
  if (await automationsHalted()) {
    return fail('CONFLICT', 'Automations are switched off — switch them on to start a re-claim.')
  }

  const username = text(request.username)
  const source: ReClaimJobArchive['source'] = request.source === 'manual' ? 'manual' : 'file'
  // The name, not the path. The renderer holds the sheet's full path and there
  // is no reason for a job record — which an operator reads months later — to
  // carry somebody's home directory.
  const chosenFile = text(request.fileName)
  const fileName = chosenFile ? basename(chosenFile) : null

  if (tickets.length === 0) {
    return fail('VALIDATION_ERROR', 'No ticket has both an id and remarks to dispute with')
  }

  const jobId = randomUUID()
  const startedAt = new Date().toISOString()

  // Written BEFORE the first dispute. A crash three tickets in must still leave
  // a job on disk to recover — see recoverInterruptedReClaims.
  await writeReClaimJob({
    jobId,
    status: 'running',
    startedAt,
    finishedAt: null,
    error: null,
    username,
    source,
    fileName,
    total: tickets.length,
    raised: 0,
    refused: 0,
    tickets: [],
    failures: []
  })

  void withAutomationLock('re-claim-bulk', () =>
    disputeEvery({ jobId, startedAt, tickets, username, source, fileName })
  ).catch(async error => {
    // The loop reports individual refusals itself, so reaching here means the
    // run as a whole broke — no session, the lock rejecting, a bug. Recorded on
    // the job, because a job that vanished is indistinguishable from one that
    // was never started.
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`[re-claim] job ${jobId} failed — ${message}`)

    await writeReClaimJob({
      jobId,
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: message,
      username,
      source,
      fileName,
      total: tickets.length,
      raised: 0,
      refused: 0,
      tickets: [],
      failures: []
    })
  })

  logger.info(`[re-claim] job ${jobId} started — ${tickets.length} tickets as ${username || 'the only login'}`)

  return ok({ jobId })
}

/**
 * The run itself: every ticket, paced like a person, then archived.
 *
 * Returns the summary for a caller that wants it (the tests, and the IPC
 * handler kept for compatibility); the operator reads it off the progress
 * broadcast and the Jobs page.
 */
const disputeEvery = async ({
  jobId,
  startedAt,
  tickets,
  username,
  source,
  fileName
}: {
  jobId: string
  startedAt: string
  tickets: { ticketId: string; description: string; issueCategory: string }[]
  username: string
  source: ReClaimJobArchive['source']
  fileName: string | null
}): Promise<ReClaimSummary> => {
  const { pacedPause } = loadCore<HumanPace>('common/humanPace')

  const results: ReClaimResult[] = []
  const refusals: { ticketId: string; message: string }[] = []
  const raisedTickets: ReClaimJobArchive['tickets'] = []

  let raised = 0
  let refused = 0

  stopping = false

  // Typed off the progress payload so the tick and this stay one shape.
  let last: ReClaimProgress['last'] = null
  let stopped = false

  const batchCount = batchCountFor(tickets.length)

  const publish = (ticketId: string, running: boolean, waitingMs = 0): void => {
    // Derived from what has FINISHED, never counted up separately: a second
    // counter is a second thing to get wrong on the stop path, and this one
    // cannot disagree with `done`.
    const batch = results.length < tickets.length ? batchOf(results.length) : batchCount

    progress = {
      jobId,
      done: results.length,
      total: tickets.length,
      batch: tickets.length > 0 ? batch : 0,
      batchCount,
      batchDone: results.length % RE_CLAIM_BATCH_SIZE,
      raised,
      refused,
      ticketId,
      running,
      waitingMs,
      refusals,
      last
    }

    broadcast(RE_CLAIM_EVENTS.progress, progress)
  }

  /**
   * The run so far, on disk, at every batch boundary.
   *
   * WITHOUT THIS, RECOVERY WAS A PROMISE THE RECORD COULD NOT KEEP.
   * `recoverInterruptedReClaims` says the disputes already raised stay in the
   * record — but the only record written before the end was the opening one,
   * with `tickets: []`. A crash two thousand tickets into a run of three
   * thousand left a job that said it had raised nothing, while Myntra was
   * re-validating two thousand disputes nobody here had a list of.
   *
   * Every fifty rather than every ticket: the disputes are five seconds apart,
   * so the most this can lose is the last partial batch, and a whole-file
   * rewrite per ticket over a four-hour run is a lot of writing for a minute's
   * worth of work.
   */
  const checkpoint = async (): Promise<void> => {
    if (results.length === 0 || results.length % RE_CLAIM_BATCH_SIZE !== 0) return

    await writeReClaimJob({
      jobId,
      status: 'running',
      startedAt,
      finishedAt: null,
      error: null,
      username,
      source,
      fileName,
      total: tickets.length,
      raised,
      refused,
      tickets: raisedTickets,
      failures: refusals.map(refusal => ({
        ticketId: refusal.ticketId,
        reason: refusal.message
      }))
    })

    logger.info(
      `[re-claim] job ${jobId} checkpoint — batch ${batchOf(results.length - 1)} of ${batchCount}, ` +
        `${results.length} of ${tickets.length} done`
    )
  }

  try {
    for (const [index, ticket] of tickets.entries()) {
      if (stopping) {
        logger.info(`[re-claim] stopped after ${results.length} of ${tickets.length}`)
        stopped = true
        break
      }

      // Announced WHILE waiting, with the gap, so the pause reads as pacing
      // rather than as the window having frozen.
      await pacedPause(index, {
        baseMs: BASE_GAP_MS,
        onWait: waitingMs => publish(ticket.ticketId, true, waitingMs)
      })

      if (stopping) {
        stopped = true
        break
      }

      publish(ticket.ticketId, true)

      const one = await disputeOne({
        ticketId: ticket.ticketId,
        issueCategory: ticket.issueCategory,
        description: ticket.description,
        username
      })

      if (!one.success) {
        // A refusal to even try — no session, no ticket id. Recorded as a
        // result so the run reports it rather than stopping on it.
        refused += 1
        refusals.push({ ticketId: ticket.ticketId, message: one.error.message })
        results.push({
          ticketId: ticket.ticketId,
          ok: false,
          message: one.error.message,
          ticket: null,
          payload: null,
          error: one.error.message
        })
        last = { ticketId: ticket.ticketId, ok: false, message: one.error.message, status: null }

        // Announced as soon as it is known: over an hour-long run, rows that
        // only filled in at the end would leave an operator watching a
        // progress bar and nothing else.
        publish(ticket.ticketId, true)

        await checkpoint()

        continue
      }

      results.push(one.data)

      if (one.data.ok) {
        raised += 1
        raisedTickets.push({
          ticketId: ticket.ticketId,
          status: one.data.ticket?.status ?? null
        })
      } else {
        refused += 1
        refusals.push({ ticketId: ticket.ticketId, message: one.data.message })
      }

      last = {
        ticketId: ticket.ticketId,
        ok: one.data.ok,
        message: one.data.message,
        // The read-back status, which `disputeOne` has already fetched. Null
        // when that read failed — the row then says raised or refused, which
        // is still true, just less than Myntra would have said.
        status: one.data.ticket?.status ?? null
      }

      publish(ticket.ticketId, true)

      await checkpoint()
    }
  } finally {
    // Stored before it is announced: the window answers the terminal tick by
    // asking for the run, and publishing first would answer with the previous
    // one. The same ordering the SKU sweep needed.
    progress = {
      jobId,
      done: results.length,
      total: tickets.length,
      batch: tickets.length > 0 ? batchOf(Math.max(0, results.length - 1)) : 0,
      batchCount,
      batchDone: results.length % RE_CLAIM_BATCH_SIZE,
      raised,
      refused,
      ticketId: '',
      running: false,
      waitingMs: 0,
      refusals,
      last
    }

    broadcast(RE_CLAIM_EVENTS.progress, progress)
    stopping = false

    // The job record, whatever happened. `total` stays what the run set out to
    // do rather than what it reached, so a stopped job says 12 of 400 instead
    // of pretending it only ever had 12.
    await writeReClaimJob({
      jobId,
      status: stopped ? 'stopped' : 'done',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: null,
      username,
      source,
      fileName,
      total: tickets.length,
      raised,
      refused,
      tickets: raisedTickets,
      failures: refusals.map(refusal => ({
        ticketId: refusal.ticketId,
        reason: refusal.message
      }))
    })

    // The Re-Open column of the Accounts page: every dispute Myntra accepted in
    // this run, stopped or not — those tickets are reopened either way.
    await reportClaimActivity({ reOpenClaims: raised })
  }

  logger.info(`[re-claim] job ${jobId}: ${raised} raised, ${refused} refused of ${tickets.length}`)

  return { total: tickets.length, raised, refused, results }
}
