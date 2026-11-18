import { fail, ok } from '@shared/types/result'
import type { TicketThread } from '@shared/types/ticketThread'
import type { TicketThreadProvider } from '@main/automations/common/ticketThread'
import { withReplyFilesOnDisk } from '@main/automations/common/replyFiles'
import { loadCore } from '@main/automations/common/coreLoader'
import { claimCredentials } from '@main/services/claimSession.service'
import { logger } from '@main/services/logger'
import { toTicketThread } from './ticketView'

/**
 * Meesho's ticket window, from this machine: read a filed claim's support
 * ticket, attach files, reply.
 *
 * The calls are the core's (claimApiFlow) — the panel's own, captured 2026-10-26:
 *   POST /api/experience/support/fetchTicket                                  fetchTicket
 *   POST /api/experience/support/api/v1/upload/supplier-support/input-attachment  uploadAttachment
 *   POST /api/experience/support/replyTicket                                  replyTicket
 * A reply is ONE request: the files are uploaded first, each answering with a
 * link, and the links go with the text. So a reply can never land without its
 * files, or the files without the reply.
 *
 * Plain HTTP with the saved session jar — the same context the claim flow
 * uses — so no browser opens and nothing waits on the automation lock.
 */

interface MeeshoTicketCore {
  loginMeeshoApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  fetchTicket: (ctx: unknown, ticketId: string) => Promise<unknown>
  uploadAttachment: (ctx: unknown, filePath: string) => Promise<string>
  replyTicket: (
    ctx: unknown,
    input: { ticketId: string; reply: string; attachmentUrls: string[] }
  ) => Promise<unknown>
}

const core = (): MeeshoTicketCore =>
  loadCore<MeeshoTicketCore>('platforms/meesho/claim-management/api-based-flow/claimApiFlow')

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const contextFor = async (flow: MeeshoTicketCore, username: string): Promise<unknown> => {
  const credentials = await claimCredentials('meesho', username)

  return (
    credentials.context ??
    flow.loginMeeshoApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )
  )
}

const read = async (flow: MeeshoTicketCore, ctx: unknown, ticket: string): Promise<TicketThread> => {
  const thread = toTicketThread(await flow.fetchTicket(ctx, ticket), ticket)

  if (!thread) throw new Error(`Meesho answered with a different ticket than ${ticket}`)

  return thread
}

const open: TicketThreadProvider['open'] = async ({ username, ticket }) => {
  try {
    const flow = core()
    const thread = await read(flow, await contextFor(flow, username), ticket)

    logger.info(`[meesho-ticket] ${username}: opened ${ticket} (${thread.status ?? 'no status'}, ${thread.comments.length} update(s))`)

    return ok(thread)
  } catch (error) {
    logger.warn(`[meesho-ticket] ${username}: could not open ${ticket}: ${message(error)}`)

    return fail('INTERNAL_ERROR', `Could not open Meesho ticket ${ticket}: ${message(error)}`)
  }
}

const reply: TicketThreadProvider['reply'] = async ({ username, ticket, text, files }) => {
  try {
    const flow = core()
    const ctx = await contextFor(flow, username)

    const attachmentUrls = await withReplyFilesOnDisk(files, async (onDisk) => {
      const urls: string[] = []

      // One at a time, as the panel uploads them — and so a refusal names its file.
      for (const { path } of onDisk) urls.push(await flow.uploadAttachment(ctx, path))

      return urls
    })

    await flow.replyTicket(ctx, { ticketId: ticket, reply: text, attachmentUrls })

    logger.info(
      `[meesho-ticket] ${username}: replied on ${ticket} (${text ? `${text.length} chars` : 'no text'}, ${files.length} file(s))`
    )

    return ok(await read(flow, ctx, ticket))
  } catch (error) {
    logger.warn(`[meesho-ticket] ${username}: reply on ${ticket} failed: ${message(error)}`)

    // Nothing is posted until every file is up, so a failure here sent nothing.
    return fail('INTERNAL_ERROR', `Could not reply on Meesho ticket ${ticket}: ${message(error)}. Nothing was sent.`)
  }
}

export const meeshoTicketThread: TicketThreadProvider = { open, reply }
