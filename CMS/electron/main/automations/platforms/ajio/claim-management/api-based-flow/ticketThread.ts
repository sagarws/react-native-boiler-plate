import { fail, ok, type Result } from '@shared/types/result'
import type { TicketThread } from '@shared/types/ticketThread'
import type { TicketThreadProvider } from '@main/automations/common/ticketThread'
import { loadCore } from '@main/automations/common/coreLoader'
import { claimCredentials } from '@main/services/claimSession.service'
import { leasedSession } from '@main/services/browserLease.service'
import { automationHolder } from '@main/services/automationLock'
import { logger } from '@main/services/logger'
import {
  openSignedInAjioPage,
  type PuppeteerPage
} from '@main/automations/platforms/ajio/common/signedInPage'
import { toTicketThread } from './ticketView'

/**
 * AJIO's ticket window, from this machine: read a filed claim's ticket, attach
 * files to it, comment on it.
 *
 * The calls are the core's (returnDeliveredClaimApiFlow) — the same castellan
 * endpoints the claim flow files with and the portal's own ticket window uses:
 *   GET  /tickets/{id}              getTicket
 *   POST /tickets/{id}/attachments  uploadClaimAttachment  (multipart "files", one file per request)
 *   PUT  /tickets/{id}/comment      postClaimComment       ({ comment })
 * They run inside a signed-in seller.ajio.com page because AJIO sits behind
 * Akamai, which refuses anything that is not a real browser.
 */

interface AjioTicketCore {
  getTicket: (page: PuppeteerPage, input: { sellerId: string; ticketId: string; userLogger?: unknown }) => Promise<unknown>
  uploadClaimAttachment: (
    page: PuppeteerPage,
    input: {
      sellerId: string
      ticketId: string
      fileBase64: string
      fileName: string
      mimeType: string
      userLogger?: unknown
    }
  ) => Promise<true>
  postClaimComment: (
    page: PuppeteerPage,
    input: { sellerId: string; ticketId: string; comment: string; userLogger?: unknown }
  ) => Promise<boolean>
  htmlToText: (html: string) => string
}

const core = (): AjioTicketCore =>
  loadCore<AjioTicketCore>('platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow')

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * A signed-in AJIO page for `work`, released after.
 *
 * Refused while another automation holds the browser rather than queued
 * behind it: a claim batch can hold it for many minutes, and a page borrowed
 * mid-run is navigated under the request (the "Failed to fetch" the POB sync
 * hit). The operator is told what is running and tries again after.
 */
const withAjioPage = async <T>(
  username: string,
  work: (page: PuppeteerPage, sellerId: string) => Promise<T>
): Promise<T> => {
  const busy = automationHolder()

  if (busy) throw new Error(`${busy} is using the AJIO browser right now — try again when it finishes`)

  const credentials = await claimCredentials('ajio', username)
  const { page, context, release } = await leasedSession(`ajio:${username}`, async () => {
    const opened = await openSignedInAjioPage({ username, password: credentials.password })

    return { browser: opened.browser, page: opened.page, context: { sellerId: opened.sellerId } }
  })

  try {
    return await work(page as PuppeteerPage, context.sellerId)
  } finally {
    await release()
  }
}

const read = async (page: PuppeteerPage, sellerId: string, ticket: string): Promise<TicketThread> => {
  const flow = core()
  const raw = await flow.getTicket(page, { sellerId, ticketId: ticket, userLogger: logger })
  const thread = toTicketThread(raw, ticket, flow.htmlToText)

  if (!thread) throw new Error(`AJIO answered with a different ticket than ${ticket}`)

  return thread
}

const open: TicketThreadProvider['open'] = async ({ username, ticket }) => {
  try {
    const thread = await withAjioPage(username, (page, sellerId) => read(page, sellerId, ticket))

    logger.info(`[ajio-ticket] ${username}: opened ${ticket} (${thread.status ?? 'no status'}, ${thread.comments.length} comment(s))`)

    return ok(thread)
  } catch (error) {
    logger.warn(`[ajio-ticket] ${username}: could not open ${ticket}: ${message(error)}`)

    return fail('INTERNAL_ERROR', `Could not open AJIO ticket ${ticket}: ${message(error)}`)
  }
}

/**
 * Files first, one request each as the portal sends them, then the comment —
 * so a comment like "see attached" never lands without its attachment. Stops
 * at the first refusal and says exactly what did and did not go through.
 */
const reply: TicketThreadProvider['reply'] = async ({ username, ticket, text, files }) => {
  try {
    return await withAjioPage(username, async (page, sellerId): Promise<Result<TicketThread>> => {
      const flow = core()
      const sent: string[] = []

      for (const file of files) {
        try {
          await flow.uploadClaimAttachment(page, {
            sellerId,
            ticketId: ticket,
            fileBase64: Buffer.from(file.data).toString('base64'),
            fileName: file.name,
            mimeType: file.mimeType,
            userLogger: logger
          })
          sent.push(file.name)
        } catch (error) {
          const done = sent.length > 0 ? `${sent.join(', ')} uploaded; ` : ''

          return fail(
            'INTERNAL_ERROR',
            `AJIO refused ${file.name}: ${message(error)}. ${done}${text ? 'The comment was not sent.' : ''}`.trim()
          )
        }
      }

      if (text && !(await flow.postClaimComment(page, { sellerId, ticketId: ticket, comment: text, userLogger: logger }))) {
        return fail(
          'INTERNAL_ERROR',
          `AJIO did not accept the comment.${sent.length > 0 ? ` ${sent.join(', ')} uploaded.` : ''}`
        )
      }

      logger.info(
        `[ajio-ticket] ${username}: replied on ${ticket} (${text ? `${text.length} chars` : 'no comment'}, ${files.length} file(s))`
      )

      return ok(await read(page, sellerId, ticket))
    })
  } catch (error) {
    logger.warn(`[ajio-ticket] ${username}: reply on ${ticket} failed: ${message(error)}`)

    return fail('INTERNAL_ERROR', `Could not reply on AJIO ticket ${ticket}: ${message(error)}`)
  }
}

export const ajioTicketThread: TicketThreadProvider = { open, reply }
