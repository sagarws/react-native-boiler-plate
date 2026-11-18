import { awbLookup, readCoverage } from '@main/services/masterBackup.store'
import { reportAccounts } from '@main/services/masterDataReport.service'
import { claimCredentials } from '@main/services/claimSession.service'
import { leasedSession } from '@main/services/browserLease.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { openSignedInAjioPage } from '@main/automations/platforms/ajio/common/signedInPage'
import { logger } from '@main/services/logger'
import type { RefillInput, RefillValues } from '@main/automations/refill/types'

/**
 * The one AJIO field that is NOT on this machine.
 *
 * A ticket's state lives with AJIO — the reports backed up here say what was
 * returned, never what was decided about a claim. So the status is read from
 * the help centre by the ticket number the row already carries, through a
 * signed-in page: AJIO sits behind Akamai and answers `fetch` from inside its
 * own page, which is why every other AJIO call in this app works the same way.
 */
interface AjioTicketFlow {
  getTicketStatus: (
    page: unknown,
    input: { sellerId: string; ticketId: string; from: string; to: string }
  ) => Promise<string | null>
  mapAjioTicketStatus: (status: string | null) => string | null
}

/** How far back the ticket list is asked to look. AJIO requires a range. */
const TICKET_WINDOW_DAYS = 120

const ymd = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const ticketStatus = async (
  username: string,
  ticketNumber: string
): Promise<{ status: string | null; marketplaceStatus: string | null }> => {
  const core = loadCore<AjioTicketFlow>(
    'platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow'
  )
  const credentials = await claimCredentials('ajio', username)
  const today = new Date()
  const from = new Date(today)

  from.setDate(from.getDate() - TICKET_WINDOW_DAYS)

  const { page, context, release } = await leasedSession(`ajio:${username}`, async () => {
    const opened = await openSignedInAjioPage({ username, password: credentials.password })

    return { browser: opened.browser, page: opened.page, context: { sellerId: opened.sellerId } }
  })

  try {
    const marketplaceStatus = await core.getTicketStatus(page, {
      sellerId: context.sellerId,
      ticketId: ticketNumber,
      from: ymd(from),
      to: ymd(today)
    })

    return { marketplaceStatus, status: core.mapAjioTicketStatus(marketplaceStatus) }
  } finally {
    // A no-op while a run holds the lease; a real close when it does not.
    await release()
  }
}

/**
 * AJIO — answered from this machine, not from AJIO.
 *
 * Every other platform's refill is a question put to a seller portal. AJIO's is
 * a lookup: the app already keeps a copy of the portal's return report
 * (Settings → AJIO master data backup), and a claim's return AWB is a row in
 * it. That row carries the forward leg, the seller SKU and the POB — the three
 * blanks a scanned claim arrives without — so there is nothing to log in to and
 * nothing to wait for.
 *
 * THE ACCOUNT COMES FROM THE POB. A place of business sits under exactly one
 * AJIO login, so the row names its own account once the POB is matched against
 * each account's POB list. That is also why AJIO needs no probe sweep: the
 * other platforms find the account by asking each login in turn whether it can
 * see the AWB, and here the answer is already written down.
 *
 * WHAT IT CANNOT DO is answer for a month that was never backed up. A row that
 * is not in the copy is NOT FOUND — the question was asked and answered, and
 * the answer was no. It is not a failure, which would send somebody looking for
 * a bug rather than at the row, and the message says what the copy actually
 * holds so the three real causes can be told apart: the return is newer than
 * the last sync, the month was never backed up, or the AWB on the claim is not
 * an AJIO return AWB at all.
 */

/** POB → the account that holds it, built once per run. */
let pobOwners: Map<string, string> | null = null

const ownersByPob = async (): Promise<Map<string, string>> => {
  if (pobOwners) return pobOwners

  const accounts = await reportAccounts()
  const owners = new Map<string, string>()

  if (accounts.success) {
    for (const account of accounts.data) {
      for (const pobId of account.pobIds) {
        const key = pobId.trim().toUpperCase()

        // First wins. A POB under two logins is a configuration mistake, and
        // silently preferring the later one would make the run's answer depend
        // on the order the accounts happened to come back in.
        if (key && !owners.has(key)) owners.set(key, account.username)
      }
    }
  }

  pobOwners = owners

  return owners
}

/** Dropped between runs, so an account added since is picked up. */
export const forgetPobOwners = (): void => {
  pobOwners = null
}

/**
 * What the backup holds, in one sentence.
 *
 * Stated with the run rather than left to the operator to go and look, because
 * "not in the backup" has three different fixes and the dates are what tell
 * them apart.
 */
const notHeld = async (awb: string): Promise<string> => {
  const coverage = await readCoverage('return')
  const days = coverage.days.map(day => day.date).sort()
  const span =
    days.length > 0 ? `${days[0]} → ${days[days.length - 1]}` : 'nothing backed up yet'

  return (
    `${awb} is not in this machine's AJIO return backup ` +
    `(${coverage.rows.toLocaleString()} row(s), ${span}). ` +
    'Sync the newest days, back up the month it belongs to, or check the AWB on the claim.'
  )
}

export const ajioRefill = async ({
  awb,
  fields,
  username,
  ticketNumber
}: RefillInput): Promise<RefillValues> => {
  const values: RefillValues = {}

  /**
   * The status first, and on its own terms: it needs a ticket number and a
   * browser, where everything else here needs neither. A row with no ticket has
   * no claim to report on — that is not a failure, it is a row nobody has filed
   * yet.
   */
  if (fields.includes('statusChange') && ticketNumber && username) {
    try {
      const read = await ticketStatus(username, ticketNumber)

      values.marketplaceStatus = read.marketplaceStatus
      // Null for a ticket AJIO has not ruled on: the row keeps the status it
      // has rather than being rewritten to the same thing every sweep.
      if (read.status) values.status = read.status
    } catch (error) {
      // The local fields are the bulk of this and cost nothing — losing them
      // because the help centre was unreachable would be a poor trade.
      logger.warn(
        `[refill] ajio ${awb}: could not read ticket ${ticketNumber} — ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const localFields = fields.filter(field => field !== 'statusChange')

  if (localFields.length === 0) return values

  const lookup = await awbLookup('return')
  const match = lookup.get(awb.trim().toUpperCase())

  if (!match) {
    // The status, if it was read, still stands: it came from AJIO rather than
    // from the backup, and the backup not holding the row says nothing about it.
    return { ...values, missing: await notHeld(awb) }
  }

  // Only when it is a different number: a row searched by its forward AWB would
  // otherwise be "filled" with the value it was searched by.
  if (fields.includes('forwardAwbNumber') && match.forwardAwb && match.forwardAwb !== awb) {
    values.forwardAWB = match.forwardAwb
  }

  if (fields.includes('sellerSku') && match.sellerSku) values.sellerSku = match.sellerSku
  if (fields.includes('pobId') && match.pobId) values.pobId = match.pobId

  if (fields.includes('accountMapping') && match.pobId) {
    values.username = (await ownersByPob()).get(match.pobId.trim().toUpperCase()) ?? null
  }

  return values
}
