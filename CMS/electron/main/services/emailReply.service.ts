import type {
  AjioEmailCounts,
  AjioEmailDetails,
  AjioEmailPage,
  AjioEmailRow,
  AjioReplyResult,
  AjioReplySender,
  EmailBody,
  MailboxRefetchResult,
  MailboxSummary
} from '@shared/types/emailReply'
import { AJIO_EMAIL_PAGE_SIZES } from '@shared/types/emailReply'
import { fail, ok, type Result } from '@shared/types/result'
import { plainText } from '@main/automations/common/claimResources'
import { processName, withProcessLogResult } from '@main/automations/common/processLog'
import {
  fetchAjioRequests,
  markOriginalRead,
  sendPreparedReply,
  type FetchedMessage,
  type MailboxCredentials,
  type PreparedMail
} from '@main/automations/platforms/ajio/email-reply/mailTransport'
import { apiRequest } from './httpClient'
import { logger } from './logger'
import { getAccessToken } from './session.store'

/**
 * The AJIO email auto-reply: read from TrackVid, and refetched and answered
 * from this machine.
 *
 * THE READS are the three GETs the web admin's Integrations tab and AJIO Emails
 * page make: `/mailboxes/list`, `/emails/counts`, `/emails/list-by-status`.
 *
 * REFETCH AND REPLY talk to the mail server from here, over the mailbox's own
 * IMAP and SMTP, so an operator does not wait for the backend's polling cycle.
 * Everything that decides anything stays on the backend — see the bottom of
 * this file.
 *
 * EVERY FIELD IS PICKED, never passed through. `/mailboxes/list` answers with
 * the whole mailbox document, OAuth access token included; mapping onto this
 * app's own shape here is what keeps that token out of the renderer.
 */

/** The backend's mailbox document, as much of it as is read here. */
interface MailboxDocument {
  _id?: unknown
  id?: unknown
  email?: unknown
  displayName?: unknown
  provider?: unknown
  authType?: unknown
  status?: unknown
  createdAt?: unknown
  inboxSync?: { lastSyncedAt?: unknown } | null
}

interface EmailDocument {
  _id?: unknown
  subject?: unknown
  sender?: { name?: unknown; email?: unknown } | null
  to?: unknown
  cc?: unknown
  status?: unknown
  receivedAt?: unknown
  snippet?: unknown
  mailboxId?: unknown
  retryAttempts?: unknown
  ajioAcknowledgementReplied?: unknown
  replyDetail?: {
    repliedAt?: unknown
    errorMessage?: unknown
    sentBy?: unknown
    subject?: unknown
    to?: unknown
    cc?: unknown
  } | null
}

/**
 * `/emails/list-by-status` scans the company's emails with an unindexed `$or`
 * and has been measured at several seconds on a large company. The default
 * budget would report a timeout for a page that was on its way.
 */
const SLOW_READ_MS = 60_000

/**
 * The first day the backend counts Pending from. Passed for Replied too, so the
 * two counts cover all time — the same span the list covers when it is given no
 * dates — and a tab's count cannot disagree with its own list.
 */
const ALL_TIME_FROM = '2024-10-25'

/** Dates are counted in the operator's day, as the web admin counts them. */
const TIMEZONE = 'Asia/Kolkata'

const OBJECT_ID = /^[a-f0-9]{24}$/i

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const isoOf = (value: unknown): string | null => {
  if (typeof value !== 'string' && !(value instanceof Date)) return null

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Ids arrive as strings: an ObjectId serialises to its hex in JSON. */
const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const field = (payload: unknown, key: string): unknown =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined

export const toMailboxSummary = (doc: MailboxDocument): MailboxSummary | null => {
  const id = idOf(doc._id ?? doc.id)
  const email = text(doc.email)

  if (!id || !email) return null

  return {
    id,
    email,
    displayName: text(doc.displayName),
    provider: text(doc.provider) ?? 'other',
    authType: doc.authType === 'oauth' || doc.authType === 'password' ? doc.authType : null,
    status: text(doc.status) ?? 'connected',
    lastSyncedAt: isoOf(doc.inboxSync?.lastSyncedAt),
    createdAt: isoOf(doc.createdAt)
  }
}

/** `[{ name, email }]` → the addresses, lower-cased. Anything else is skipped. */
const addressesOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(entry => {
        const email = entry && typeof entry === 'object' ? text((entry as { email?: unknown }).email) : null

        return email ? [email.toLowerCase()] : []
      })
    : []

/** One of the three senders TrackVid records, or null — never a value it did not send. */
const replySenderOf = (value: unknown): AjioReplySender | null =>
  value === 'server' || value === 'web' || value === 'desktop' ? value : null

export const toAjioEmailRow = (doc: EmailDocument): AjioEmailRow | null => {
  const id = idOf(doc._id)

  if (!id) return null

  return {
    id,
    subject: text(doc.subject) ?? '(no subject)',
    senderName: text(doc.sender?.name),
    senderEmail: text(doc.sender?.email),
    status: text(doc.status) ?? 'new',
    receivedAt: isoOf(doc.receivedAt),
    snippet: text(doc.snippet),
    mailboxId: idOf(doc.mailboxId),
    retryAttempts: typeof doc.retryAttempts === 'number' ? doc.retryAttempts : 0,
    repliedAt: isoOf(doc.replyDetail?.repliedAt),
    replyError: text(doc.replyDetail?.errorMessage),
    acknowledged: doc.ajioAcknowledgementReplied === true,
    repliedBy: replySenderOf(doc.replyDetail?.sentBy),
    replySubject: text(doc.replyDetail?.subject),
    replyTo: text(doc.replyDetail?.to),
    replyCc: text(doc.replyDetail?.cc),
    recipients: [...new Set([...addressesOf(doc.to), ...addressesOf(doc.cc)])]
  }
}

/**
 * One mailbox id, or null for "every mailbox". `undefined` is a value that is
 * neither, and is refused before it becomes part of a query string.
 */
const mailboxIdOf = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null

  return typeof value === 'string' && OBJECT_ID.test(value) ? value : undefined
}

export const listMailboxes = async (): Promise<Result<MailboxSummary[]>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to see the mailboxes')

  const response = await apiRequest<{ mailboxes?: MailboxDocument[] }>('/mailboxes/list', {
    token,
    bare: true
  })

  if (!response.success) return response

  const docs = Array.isArray(response.data.mailboxes) ? response.data.mailboxes : []

  return ok(docs.map(toMailboxSummary).filter((row): row is MailboxSummary => row !== null))
}

export const ajioEmailCounts = async (payload: unknown): Promise<Result<AjioEmailCounts>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to see the AJIO emails')

  const mailboxId = mailboxIdOf(field(payload, 'mailboxId'))

  if (mailboxId === undefined) return fail('VALIDATION_ERROR', 'That mailbox is not recognised')

  const query = new URLSearchParams({
    pendingStartDate: ALL_TIME_FROM,
    repliedStartDate: ALL_TIME_FROM,
    timezone: TIMEZONE
  })

  if (mailboxId) query.set('mailboxId', mailboxId)

  const response = await apiRequest<{
    pending?: { total?: unknown }
    replied?: { total?: unknown }
  }>(`/emails/counts?${query.toString()}`, { token, bare: true, timeoutMs: SLOW_READ_MS })

  if (!response.success) return response

  const total = (value: unknown): number => (typeof value === 'number' && value >= 0 ? value : 0)

  return ok({
    pending: total(response.data.pending?.total),
    replied: total(response.data.replied?.total)
  })
}

export const listAjioEmails = async (payload: unknown): Promise<Result<AjioEmailPage>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to see the AJIO emails')

  const status = field(payload, 'status')

  if (status !== 'pending' && status !== 'replied') {
    return fail('VALIDATION_ERROR', 'Say whether to list Pending or Replied emails')
  }

  const mailboxId = mailboxIdOf(field(payload, 'mailboxId'))

  if (mailboxId === undefined) return fail('VALIDATION_ERROR', 'That mailbox is not recognised')

  const page = Math.max(1, Math.floor(Number(field(payload, 'page')) || 1))
  const requested = Number(field(payload, 'pageSize'))
  // One of the sizes the page offers, so a stray number cannot ask the server
  // for a page it will only clamp anyway.
  const pageSize = (AJIO_EMAIL_PAGE_SIZES as readonly number[]).includes(requested)
    ? requested
    : AJIO_EMAIL_PAGE_SIZES[0]

  const query = new URLSearchParams({
    status,
    page: String(page),
    pageSize: String(pageSize),
    timezone: TIMEZONE
  })

  if (mailboxId) query.set('mailboxId', mailboxId)

  const response = await apiRequest<{
    items?: EmailDocument[]
    total?: unknown
    page?: unknown
    pageSize?: unknown
    hasMore?: unknown
  }>(`/emails/list-by-status?${query.toString()}`, { token, bare: true, timeoutMs: SLOW_READ_MS })

  if (!response.success) return response

  const items = Array.isArray(response.data.items) ? response.data.items : []
  const total = typeof response.data.total === 'number' ? response.data.total : items.length

  return ok({
    items: items.map(toAjioEmailRow).filter((row): row is AjioEmailRow => row !== null),
    total,
    page,
    pageSize,
    hasMore: response.data.hasMore === true
  })
}

/** `/emails/details/:emailId`, as much of it as is read here. */
interface EmailDetailsDocument {
  body?: unknown
  bodyRaw?: unknown
  replyDetail?: { body?: unknown; bodyRaw?: unknown; repliedAt?: unknown; errorMessage?: unknown } | null
}

/**
 * The admin shows `bodyRaw` (the HTML) when there is one, else `body`. Both
 * are kept: the HTML for the sandboxed frame, the text for a mail without it.
 * A `body` that is itself markup counts as HTML, as it does in the admin.
 */
const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i

const bodyOf = (plain: unknown, raw: unknown): EmailBody | null => {
  const rawText = text(raw)
  const plainValue = text(plain)
  const html = rawText ?? (plainValue && LOOKS_LIKE_HTML.test(plainValue) ? plainValue : null)
  const readable = plainValue && plainValue !== html ? plainValue : html ? text(plainText(html)) : null

  return html || readable ? { html, text: readable } : null
}

/** The web admin's expanded row: the received email and the latest reply. */
export const ajioEmailDetails = async (payload: unknown): Promise<Result<AjioEmailDetails>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to see the AJIO emails')

  const emailId = mailboxIdOf(field(payload, 'emailId'))

  if (!emailId) return fail('VALIDATION_ERROR', 'That email is not recognised')

  const response = await apiRequest<EmailDetailsDocument>(`/emails/details/${emailId}`, {
    token,
    bare: true,
    timeoutMs: SLOW_READ_MS
  })

  if (!response.success) return response

  const reply = response.data.replyDetail

  return ok({
    emailId,
    body: bodyOf(response.data.body, response.data.bodyRaw),
    reply: reply
      ? {
          body: bodyOf(reply.body, reply.bodyRaw),
          repliedAt: isoOf(reply.repliedAt),
          errorMessage: text(reply.errorMessage)
        }
      : null
  })
}

/* -------------------------------------------------------------------------- *
 * Refetch and Reply
 *
 *   credentials  GET  /mailboxes/:id/desktop-credentials   sign-in for one run
 *   refetch      IMAP search here → POST /mailboxes/:id/ingest, in batches;
 *                the backend matches, extracts and stores, as its worker does
 *   reply        POST /emails/desktop-reply/:id/claim      locks the email and
 *                returns the reply its worker would send → SMTP here →
 *                POST /emails/desktop-reply/:id/complete   records the outcome
 *
 * THE CLAIM IS WHAT STOPS A SECOND REPLY. The backend's worker takes the same
 * claim before it sends, so an email being answered from here is passed over
 * there, and the other way round.
 * -------------------------------------------------------------------------- */

/** The backend's JSON body limit is 5 MB; base64 adds a third. */
const INGEST_BATCH_BYTES = 3 * 1024 * 1024
/** A claim leaves this much margin before expiry, or the reply is not sent. */
const CLAIM_SAFETY_MS = 60_000
/** Building the reply can upload the video to Drive first. */
const CLAIM_TIMEOUT_MS = 120_000

const refetching = new Set<string>()
const replying = new Set<string>()

const credentialsFor = (token: string, mailboxId: string): Promise<Result<MailboxCredentials>> =>
  apiRequest<MailboxCredentials>(`/mailboxes/${mailboxId}/desktop-credentials`, { token })

/** A mail server's failure in a line: its response when it gave one. */
const mailError = (error: unknown): string => {
  const detail = error as { response?: unknown; responseText?: unknown; message?: unknown }
  const message =
    typeof detail.responseText === 'string'
      ? detail.responseText
      : typeof detail.response === 'string'
        ? detail.response
        : typeof detail.message === 'string'
          ? detail.message
          : 'Unknown mail server error'

  return (message.split('\n')[0] ?? message).slice(0, 300)
}

/**
 * The fetched messages in uploads the backend will take: at most `max` each,
 * and under the body limit once base64 is counted. A single message too large
 * to send at all is left out and counted.
 */
export const ingestBatches = (
  messages: FetchedMessage[],
  max: number
): { batches: FetchedMessage[][]; tooLarge: number } => {
  const batches: FetchedMessage[][] = []
  let current: FetchedMessage[] = []
  let currentBytes = 0
  let tooLarge = 0

  for (const message of messages) {
    if (message.source.length > INGEST_BATCH_BYTES) {
      tooLarge += 1
      continue
    }

    if (current.length >= max || currentBytes + message.source.length > INGEST_BATCH_BYTES) {
      batches.push(current)
      current = []
      currentBytes = 0
    }

    current.push(message)
    currentBytes += message.source.length
  }

  if (current.length > 0) batches.push(current)

  return { batches, tooLarge }
}

/**
 * Reads one mailbox for AJIO footage requests and hands them to TrackVid.
 *
 * One run per mailbox at a time. The window is the backend's — since the last
 * sync less a day, at most a week — and storing is the backend's too, through
 * the same pipeline its worker fetches with, so a request found here becomes
 * the same record it would have made.
 */
export const refetchMailbox = async (payload: unknown): Promise<Result<MailboxRefetchResult>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to refetch a mailbox')

  const mailboxId = mailboxIdOf(field(payload, 'mailboxId'))

  if (!mailboxId) return fail('VALIDATION_ERROR', 'That mailbox is not recognised')
  if (refetching.has(mailboxId)) return fail('VALIDATION_ERROR', 'This mailbox is already being refetched')

  refetching.add(mailboxId)

  try {
    const credentials = await credentialsFor(token, mailboxId)

    if (!credentials.success) return credentials

    const creds = credentials.data

    return await withProcessLogResult(processName('ajio', 'email refetch', creds.email), async () => {
      let fetched: FetchedMessage[]

      try {
        fetched = await fetchAjioRequests(creds)
      } catch (error) {
        return fail('INTERNAL_ERROR', `Could not read ${creds.email}: ${mailError(error)}`)
      }

      const { batches, tooLarge } = ingestBatches(fetched, Math.max(1, creds.maxMessagesPerIngest || 25))
      let uploaded = 0
      let stored = 0
      let refused = 0

      for (const batch of batches) {
        const response = await apiRequest<{ received: number; stored: number; refused: unknown[] }>(
          `/mailboxes/${mailboxId}/ingest`,
          {
            method: 'POST',
            token,
            timeoutMs: SLOW_READ_MS,
            body: {
              messages: batch.map(({ uid, internalDate, envelope, source }) => ({
                uid,
                internalDate,
                envelope,
                source
              }))
            }
          }
        )

        if (!response.success) return response

        uploaded += batch.length
        stored += typeof response.data.stored === 'number' ? response.data.stored : 0
        refused += Array.isArray(response.data.refused) ? response.data.refused.length : 0
      }

      return ok({
        mailboxId,
        found: fetched.length,
        uploaded,
        stored,
        skipped: tooLarge + refused,
        since: creds.since,
        folder: creds.folder,
        at: new Date().toISOString()
      })
    })
  } finally {
    refetching.delete(mailboxId)
  }
}

interface ClaimResponse {
  claimId: string
  expiresAt: string
  mail: PreparedMail
  originalMessageId: string
}

const replyResult = (
  emailId: string,
  outcome: AjioReplyResult['outcome'],
  message: string,
  replyId: string | null = null
): AjioReplyResult => ({ emailId, outcome, message, replyId, at: new Date().toISOString() })

/**
 * Answers one AJIO request from this machine.
 *
 *   1. Sign-in first, so a refused password never leaves an email claimed.
 *   2. Claim: the backend locks the email and returns the reply its worker
 *      would send — or why it will not (already replied, being sent, no order,
 *      no video). That refusal is an outcome for the row, not an error.
 *   3. Mark AJIO's original read, then send over SMTP.
 *   4. Complete: the backend records sent or failed exactly as its worker does,
 *      marks the order answered, and drops the claim.
 *
 * Sent but not recorded is its own outcome: the reply exists at AJIO, and
 * nothing should send it again until somebody has looked.
 */
export const replyToAjioEmail = async (payload: unknown): Promise<Result<AjioReplyResult>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to reply')

  const emailId = mailboxIdOf(field(payload, 'emailId'))
  const mailboxId = mailboxIdOf(field(payload, 'mailboxId'))

  if (!emailId || !mailboxId) return fail('VALIDATION_ERROR', 'That email is not recognised')
  if (replying.has(emailId)) return fail('VALIDATION_ERROR', 'A reply to this email is already being sent')

  replying.add(emailId)

  try {
    const credentials = await credentialsFor(token, mailboxId)

    if (!credentials.success) return credentials

    const creds = credentials.data

    return await withProcessLogResult(processName('ajio', 'email reply', emailId), async () => {
      const claimed = await apiRequest<ClaimResponse>(`/emails/desktop-reply/${emailId}/claim`, {
        method: 'POST',
        token,
        timeoutMs: CLAIM_TIMEOUT_MS
      })

      // The backend's 4xx is a decision about THIS email; anything else is a
      // failure to ask, and is reported as one.
      if (!claimed.success) {
        return claimed.error.code === 'INTERNAL_ERROR'
          ? claimed
          : ok(replyResult(emailId, 'refused', claimed.error.message))
      }

      const { claimId, expiresAt, mail, originalMessageId } = claimed.data

      const complete = (body: Record<string, unknown>) =>
        apiRequest<{ status: string; replyId?: string }>(`/emails/desktop-reply/${emailId}/complete`, {
          method: 'POST',
          token,
          body: { claimId, ...body }
        })

      // Building the reply can take most of a minute; sending on a claim about
      // to lapse is how the worker and this app would both answer.
      if (Date.parse(expiresAt) - Date.now() < CLAIM_SAFETY_MS) {
        await complete({
          outcome: 'failed',
          error: { code: 'claim_expiring', message: 'Preparing the reply took too long' }
        })

        return ok(replyResult(emailId, 'failed', 'Preparing the reply took too long; nothing was sent. Try again.'))
      }

      await markOriginalRead(creds, originalMessageId)

      let messageId: string

      try {
        messageId = await sendPreparedReply(creds, mail)
      } catch (error) {
        const message = mailError(error)
        const code =
          typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'smtp_failed'
        const recorded = await complete({ outcome: 'failed', error: { code, message } })

        if (!recorded.success) {
          logger.warn('[email-reply] the failure could not be recorded', {
            emailId,
            error: recorded.error.message
          })
        }

        return ok(replyResult(emailId, 'failed', `The mail server refused it: ${message}`))
      }

      const recorded = await complete({ outcome: 'sent', messageId })

      if (!recorded.success) {
        logger.error('[email-reply] reply SENT but not recorded', {
          emailId,
          messageId,
          error: recorded.error.message
        })

        return ok(
          replyResult(
            emailId,
            'sent-unrecorded',
            `Sent, but TrackVid could not record it (${recorded.error.message}). Check before retrying.`,
            messageId
          )
        )
      }

      return ok(replyResult(emailId, 'replied', 'Reply sent and recorded', recorded.data.replyId ?? messageId))
    })
  } finally {
    replying.delete(emailId)
  }
}

/**
 * Moves a mailbox's last-sync date — TrackVid's own route, the web admin's
 * calendar button. The next fetch, the server's or a Refetch from here, reads
 * from that date again; TrackVid resets its folder cursors with it, and an
 * email already answered is never answered twice.
 *
 * The server only allows it with SINGLE_EMAIL_POLLING on; when it is off, its
 * refusal is the message shown.
 */
export const updateMailboxLastSync = async (
  payload: unknown
): Promise<Result<{ mailboxId: string; lastSyncedAt: string | null }>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to change the last sync date')

  const mailboxId = mailboxIdOf(field(payload, 'mailboxId'))

  if (!mailboxId) return fail('VALIDATION_ERROR', 'That mailbox is not recognised')

  const raw = field(payload, 'lastSyncedAt')
  const date = typeof raw === 'string' ? new Date(raw) : null

  if (!date || Number.isNaN(date.getTime())) return fail('VALIDATION_ERROR', 'Choose a date and time')
  // Checked here as well as on the server: a future watermark means "fetch
  // nothing" until the clock catches up.
  if (date.getTime() > Date.now()) return fail('VALIDATION_ERROR', 'The last sync date cannot be in the future')

  const response = await apiRequest<{ mailboxId: string; lastSyncedAt: string | null }>(
    `/mailboxes/${mailboxId}/last-sync`,
    { method: 'PATCH', token, body: { lastSyncedAt: date.toISOString() } }
  )

  if (!response.success) return response

  return ok({ mailboxId, lastSyncedAt: isoOf(response.data?.lastSyncedAt) ?? date.toISOString() })
}
