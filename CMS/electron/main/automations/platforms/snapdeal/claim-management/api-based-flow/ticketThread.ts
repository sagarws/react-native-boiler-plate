import { fail, ok } from '@shared/types/result'
import type { TicketThread } from '@shared/types/ticketThread'
import type { TicketThreadProvider } from '@main/automations/common/ticketThread'
import { withReplyFilesOnDisk } from '@main/automations/common/replyFiles'
import { loadCore } from '@main/automations/common/coreLoader'
import { claimCredentials } from '@main/services/claimSession.service'
import { logger } from '@main/services/logger'
import { currentVideoLink, toTicketThread } from './ticketView'

/**
 * Snapdeal's ticket window, from this machine: read a filed claim's query case,
 * attach images, files and a video, comment.
 *
 * The calls are the core's (claimApiFlow) — the Queries pane's own, captured
 * 2026-10-26:
 *   GET  /queries/caseDetail            getCaseDetail
 *   POST /queries/uploadAttachment      uploadQueryAttachment  ("ATTACH" — images and files)
 *   POST /queries/uploadVideoAttachment uploadQueryVideo       ("ATTACH VIDEO" — one per comment)
 *   POST /queries/addComment            addCaseComment         ({ caseNumber, comment, attachments, videoLink })
 * The uploads come first and their links go with the comment, so it is one
 * post either way. A claim's ticket is the caseId raiseDispute answered with,
 * which is this pane's case number.
 *
 * Plain HTTP with the saved session jar, like the claim flow — no browser.
 */

interface SnapdealTicketCore {
  loginSnapdealApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  getCaseDetail: (ctx: unknown, caseNumber: string) => Promise<unknown>
  uploadQueryAttachment: (ctx: unknown, filePath: string) => Promise<string>
  uploadQueryVideo: (ctx: unknown, filePath: string) => Promise<string>
  addCaseComment: (
    ctx: unknown,
    input: {
      caseNumber: string
      comment: string
      attachments: { name: string; url: string }[]
      videoLink?: string | null
    }
  ) => Promise<{ caseReopened?: boolean }>
}

const core = (): SnapdealTicketCore =>
  loadCore<SnapdealTicketCore>('platforms/snapdeal/claim-management/api-based-flow/claimApiFlow')

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const contextFor = async (flow: SnapdealTicketCore, username: string): Promise<unknown> => {
  const credentials = await claimCredentials('snapdeal', username)

  return (
    credentials.context ??
    flow.loginSnapdealApi(
      { username, password: credentials.password, _id: credentials.credentialId },
      { session: { jar: credentials.jar } }
    )
  )
}

const readRaw = async (flow: SnapdealTicketCore, ctx: unknown, ticket: string): Promise<{ raw: unknown; thread: TicketThread }> => {
  const raw = await flow.getCaseDetail(ctx, ticket)
  const thread = toTicketThread(raw, ticket)

  if (!thread) throw new Error(`Snapdeal answered with a different case than ${ticket}`)

  return { raw, thread }
}

const open: TicketThreadProvider['open'] = async ({ username, ticket }) => {
  try {
    const flow = core()
    const { thread } = await readRaw(flow, await contextFor(flow, username), ticket)

    logger.info(`[snapdeal-ticket] ${username}: opened ${ticket} (${thread.status ?? 'no status'}, ${thread.comments.length} comment(s))`)

    return ok(thread)
  } catch (error) {
    logger.warn(`[snapdeal-ticket] ${username}: could not open ${ticket}: ${message(error)}`)

    return fail(
      'INTERNAL_ERROR',
      `Could not open Snapdeal case ${ticket}: ${message(error)}. ` +
        'If the claim was filed as a dispute without a query case, it has no thread to show here.'
    )
  }
}

const reply: TicketThreadProvider['reply'] = async ({ username, ticket, text, files }) => {
  try {
    const flow = core()
    const ctx = await contextFor(flow, username)
    // Read first: the comment carries the case's video forward when it adds no
    // new one, as the panel does — it always posts the case's current videoLink.
    const { raw } = await readRaw(flow, ctx, ticket)

    const uploaded = await withReplyFilesOnDisk(files, async (onDisk) => {
      const attachments: { name: string; url: string }[] = []
      let videoLink: string | null = null

      for (const { file, path } of onDisk) {
        if (file.video) videoLink = await flow.uploadQueryVideo(ctx, path)
        else attachments.push({ name: file.name, url: await flow.uploadQueryAttachment(ctx, path) })
      }

      return { attachments, videoLink }
    })

    const answer = await flow.addCaseComment(ctx, {
      caseNumber: ticket,
      comment: text,
      attachments: uploaded.attachments,
      videoLink: uploaded.videoLink ?? currentVideoLink(raw)
    })

    logger.info(
      `[snapdeal-ticket] ${username}: commented on ${ticket} (${text ? `${text.length} chars` : 'no text'}, ` +
        `${uploaded.attachments.length} attachment(s)${uploaded.videoLink ? ', 1 video' : ''})` +
        (answer.caseReopened ? ' — the case reopened' : '')
    )

    return ok((await readRaw(flow, ctx, ticket)).thread)
  } catch (error) {
    logger.warn(`[snapdeal-ticket] ${username}: comment on ${ticket} failed: ${message(error)}`)

    // Nothing is posted until every file is up, so a failure here sent nothing.
    return fail('INTERNAL_ERROR', `Could not comment on Snapdeal case ${ticket}: ${message(error)}. Nothing was sent.`)
  }
}

export const snapdealTicketThread: TicketThreadProvider = { open, reply }
