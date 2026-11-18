import { fail, ok } from '@shared/types/result'
import type { TicketThread } from '@shared/types/ticketThread'
import type { TicketThreadProvider } from '@main/automations/common/ticketThread'
import { withReplyFilesOnDisk } from '@main/automations/common/replyFiles'
import { loadCore } from '@main/automations/common/coreLoader'
import { claimCredentials } from '@main/services/claimSession.service'
import { storedSession } from '@main/services/sessionReuse.service'
import { logger } from '@main/services/logger'
import { toTicketThread } from './ticketView'

/**
 * Nykaa's ticket window: read a filed claim's ticket and reply on it, through
 * the dispute portal's own ticket calls (core `ticketThread`, from
 * api-network-records (9).json).
 *
 * The session is the claim's: the stored one when it rebuilds into a context,
 * the same login the claim runner would make otherwise.
 */

interface NykaaSession {
  jar: Record<string, string>
  portalId?: string
  userId?: string | null
}

interface NykaaLogin {
  loginNykaaApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string>; portalId?: string; userId?: string | null } }
  ) => Promise<unknown>
}

interface NykaaTicketCore {
  fetchTicketThread: (ctx: unknown, ticket: string) => Promise<unknown>
  uploadAttachment: (ctx: unknown, filePath: string) => Promise<string>
  replyTicket: (ctx: unknown, input: { ticket: string; content: string; attachmentIds: string[] }) => Promise<unknown>
}

const core = (): NykaaTicketCore =>
  loadCore<NykaaTicketCore>('platforms/nykaa/claim-management/api-based-flow/ticketThread')

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The same session the claim runner uses — see runClaim's `ctx`. */
const contextFor = async (username: string): Promise<unknown> => {
  const credentials = await claimCredentials('nykaa', username)

  if (credentials.context) return credentials.context

  const stored = (await storedSession('nykaa', username)) as NykaaSession | null
  const { loginNykaaApi } = loadCore<NykaaLogin>('platforms/nykaa/claim-management/api-based-flow/claimApiFlow')

  return loginNykaaApi(
    { username, password: credentials.password, _id: credentials.credentialId },
    {
      session: {
        jar: stored?.jar ?? credentials.jar,
        ...(stored?.portalId ? { portalId: stored.portalId } : {}),
        ...(stored?.userId ? { userId: stored.userId } : {})
      }
    }
  )
}

const read = async (flow: NykaaTicketCore, ctx: unknown, ticket: string): Promise<TicketThread> => {
  const thread = toTicketThread(await flow.fetchTicketThread(ctx, ticket), ticket)

  if (!thread) throw new Error(`Nykaa answered with a different ticket than ${ticket}`)

  return thread
}

const open: TicketThreadProvider['open'] = async ({ username, ticket }) => {
  try {
    const flow = core()
    const thread = await read(flow, await contextFor(username), ticket)

    logger.info(
      `[nykaa-ticket] ${username}: opened ${ticket} (${thread.status ?? 'no status'}, ${thread.comments.length} update(s))`
    )

    return ok(thread)
  } catch (error) {
    logger.warn(`[nykaa-ticket] ${username}: could not open ${ticket}: ${message(error)}`)

    return fail('INTERNAL_ERROR', `Could not open Nykaa ticket ${ticket}: ${message(error)}`)
  }
}

const reply: TicketThreadProvider['reply'] = async ({ username, ticket, text, files }) => {
  try {
    const flow = core()
    const ctx = await contextFor(username)

    // Uploaded first, one by one, then listed on the comment — as the portal does.
    const attachmentIds = await withReplyFilesOnDisk(files, async (onDisk) => {
      const ids: string[] = []

      for (const { path } of onDisk) ids.push(await flow.uploadAttachment(ctx, path))

      return ids
    })

    await flow.replyTicket(ctx, { ticket, content: text, attachmentIds })
    logger.info(
      `[nykaa-ticket] ${username}: replied on ${ticket} (${text ? `${text.length} chars` : 'no text'}, ${files.length} file(s))`
    )

    return ok(await read(flow, ctx, ticket))
  } catch (error) {
    logger.warn(`[nykaa-ticket] ${username}: reply on ${ticket} failed: ${message(error)}`)

    return fail('INTERNAL_ERROR', `Could not reply on Nykaa ticket ${ticket}: ${message(error)}. Nothing was sent.`)
  }
}

export const nykaaTicketThread: TicketThreadProvider = { open, reply }
