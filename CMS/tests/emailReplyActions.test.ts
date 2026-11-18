import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Refetch and Reply, run from this machine against the mailbox's own servers.
 *
 * What is pinned here is the ORDER of the conversation with TrackVid, because
 * every safety property of the feature is an ordering:
 *
 *   - sign-in before claim, so a refused password never leaves an email locked
 *   - claim before send, so TrackVid's worker cannot answer the same request
 *   - complete after send, always — sent or failed — so the lock is dropped
 *   - "sent but not recorded" is never reported as a plain success
 *
 * and that the mailbox password goes to the mail transport and nowhere else.
 */

interface Call {
  path: string
  method: string
  body: unknown
}

interface State {
  calls: Call[]
  answers: Record<string, unknown>
  token: string | null
  fetched: unknown[]
  sendError: Error | null
  sent: unknown[]
  marked: string[]
}

const state = vi.hoisted(
  (): State => ({
    calls: [],
    answers: {},
    token: 'jwt',
    fetched: [],
    sendError: null,
    sent: [],
    marked: []
  })
)

/** Answers by route, so each step of the conversation can be scripted. */
const answerFor = (path: string): unknown => {
  const key = Object.keys(state.answers).find(prefix => path.startsWith(prefix))

  return key ? state.answers[key] : { success: false, error: { code: 'INTERNAL_ERROR', message: 'unscripted' } }
}

vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { method?: string; body?: unknown } = {}) => {
    state.calls.push({ path, method: options.method ?? 'GET', body: options.body })

    return Promise.resolve(answerFor(path))
  }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => state.token }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'ajio email',
  withProcessLogResult: (_name: string, fn: () => Promise<unknown>) => fn()
}))
vi.mock('@main/automations/platforms/ajio/email-reply/mailTransport', () => ({
  fetchAjioRequests: (credentials: { password: string }) => {
    state.calls.push({ path: 'IMAP fetch', method: 'IMAP', body: credentials.password })

    return Promise.resolve(state.fetched)
  },
  markOriginalRead: (_credentials: unknown, messageId: string) => {
    state.marked.push(messageId)

    return Promise.resolve(true)
  },
  sendPreparedReply: (credentials: { password: string }, mail: unknown) => {
    state.calls.push({ path: 'SMTP send', method: 'SMTP', body: credentials.password })

    if (state.sendError) return Promise.reject(state.sendError)

    state.sent.push(mail)

    return Promise.resolve('<sent-1@seller.com>')
  }
}))

const { ingestBatches, refetchMailbox, replyToAjioEmail, updateMailboxLastSync } = await import(
  '@main/services/emailReply.service'
)

const MAILBOX = '0123456789abcdef01234567'
const EMAIL = 'abcdef0123456789abcdef01'
const SECRET = 'app-password-123'

const CREDENTIALS = {
  success: true,
  data: {
    mailboxId: MAILBOX,
    email: 'seller@gmail.com',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    username: 'seller@gmail.com',
    password: SECRET,
    folder: 'INBOX',
    since: '2026-10-27T00:00:00.000Z',
    subjectPattern: 'CCTV FOOTAGE REQUIRED',
    expectedSender: 'seller.communication@ajio.com',
    maxMessagesPerIngest: 25
  }
}

const MAIL = {
  from: '"Seller" <seller@gmail.com>',
  to: '"seller.communication@ajio.com" <seller.communication@ajio.com>',
  cc: null,
  subject: 'Re: CCTV FOOTAGE REQUIRED||INC1',
  html: '<p>Hi Team AJIO</p>',
  inReplyTo: '<orig@ajio.com>',
  references: '<orig@ajio.com>',
  headers: {}
}

const claimAnswer = (expiresInMs: number) => ({
  success: true,
  data: {
    claimId: 'claim-1',
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    mail: MAIL,
    originalMessageId: '<orig@ajio.com>'
  }
})

const paths = (): string[] => state.calls.map(call => `${call.method} ${call.path}`)

beforeEach(() => {
  state.calls.length = 0
  state.sent.length = 0
  state.marked.length = 0
  state.fetched = []
  state.sendError = null
  state.token = 'jwt'
  state.answers = { [`/mailboxes/${MAILBOX}/desktop-credentials`]: CREDENTIALS }
})

describe('Reply', () => {
  it('signs in, claims, sends, then records — in that order', async () => {
    state.answers[`/emails/desktop-reply/${EMAIL}/claim`] = claimAnswer(5 * 60_000)
    state.answers[`/emails/desktop-reply/${EMAIL}/complete`] = {
      success: true,
      data: { status: 'replied', replyId: '<sent-1@seller.com>' }
    }

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(result.success && result.data.outcome).toBe('replied')
    expect(paths()).toEqual([
      `GET /mailboxes/${MAILBOX}/desktop-credentials`,
      `POST /emails/desktop-reply/${EMAIL}/claim`,
      'SMTP SMTP send',
      `POST /emails/desktop-reply/${EMAIL}/complete`
    ])
    expect(state.calls.at(-1)?.body).toEqual({ claimId: 'claim-1', outcome: 'sent', messageId: '<sent-1@seller.com>' })
    // The worker marks AJIO's original read before it replies; so does this.
    expect(state.marked).toEqual(['<orig@ajio.com>'])
    // TrackVid's prepared message, unchanged.
    expect(state.sent).toEqual([MAIL])
  })

  it('claims nothing when the sign-in is refused', async () => {
    state.answers[`/mailboxes/${MAILBOX}/desktop-credentials`] = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Only app-password mailboxes can be used from the desktop app.' }
    }

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(result.success).toBe(false)
    expect(paths()).toEqual([`GET /mailboxes/${MAILBOX}/desktop-credentials`])
  })

  it("reports TrackVid's refusal as an outcome for the row, and sends nothing", async () => {
    state.answers[`/emails/desktop-reply/${EMAIL}/claim`] = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'This email has already been replied to.' }
    }

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(result).toMatchObject({
      success: true,
      data: { outcome: 'refused', message: 'This email has already been replied to.' }
    })
    expect(paths()).not.toContain('SMTP SMTP send')
  })

  it('does not send on a claim about to lapse, and gives the claim back', async () => {
    state.answers[`/emails/desktop-reply/${EMAIL}/claim`] = claimAnswer(20_000)
    state.answers[`/emails/desktop-reply/${EMAIL}/complete`] = { success: true, data: { status: 'failed' } }

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(result.success && result.data.outcome).toBe('failed')
    expect(paths()).not.toContain('SMTP SMTP send')
    expect(state.calls.at(-1)).toMatchObject({ path: `/emails/desktop-reply/${EMAIL}/complete`, body: { outcome: 'failed' } })
  })

  it("records the mail server's refusal, so the claim is dropped and the attempt counted", async () => {
    state.answers[`/emails/desktop-reply/${EMAIL}/claim`] = claimAnswer(5 * 60_000)
    state.answers[`/emails/desktop-reply/${EMAIL}/complete`] = { success: true, data: { status: 'failed' } }
    state.sendError = Object.assign(new Error('Invalid login'), {
      code: 'EAUTH',
      response: '535-5.7.8 Username and Password not accepted\nmore detail'
    })

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(result).toMatchObject({ success: true, data: { outcome: 'failed' } })
    expect(result.success && result.data.message).toContain('535-5.7.8 Username and Password not accepted')
    expect(state.calls.at(-1)?.body).toEqual({
      claimId: 'claim-1',
      outcome: 'failed',
      error: { code: 'EAUTH', message: '535-5.7.8 Username and Password not accepted' }
    })
  })

  it('never calls a reply that went out but was not recorded a success', async () => {
    state.answers[`/emails/desktop-reply/${EMAIL}/claim`] = claimAnswer(5 * 60_000)
    state.answers[`/emails/desktop-reply/${EMAIL}/complete`] = {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Cannot reach the TrackVid server.' }
    }

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(result).toMatchObject({ success: true, data: { outcome: 'sent-unrecorded', replyId: '<sent-1@seller.com>' } })
  })

  it('keeps the password between the backend and the mail transport', async () => {
    state.answers[`/emails/desktop-reply/${EMAIL}/claim`] = claimAnswer(5 * 60_000)
    state.answers[`/emails/desktop-reply/${EMAIL}/complete`] = { success: true, data: { status: 'replied' } }

    const result = await replyToAjioEmail({ emailId: EMAIL, mailboxId: MAILBOX })

    expect(JSON.stringify(result)).not.toContain(SECRET)
    // Handed to SMTP; never sent back to TrackVid in any body.
    const posted = state.calls.filter(call => call.method === 'POST')

    expect(posted.length).toBeGreaterThan(0)
    expect(posted.some(call => JSON.stringify(call.body ?? null).includes(SECRET))).toBe(false)
  })

  it('refuses ids that are not ids before anything is asked', async () => {
    expect((await replyToAjioEmail({ emailId: '../admin', mailboxId: MAILBOX })).success).toBe(false)
    expect((await replyToAjioEmail({ emailId: EMAIL })).success).toBe(false)
    expect(state.calls).toHaveLength(0)
  })
})

describe('Refetch', () => {
  const message = (uid: number, bytes: number) => ({
    uid,
    internalDate: '2026-10-27T10:00:00.000Z',
    envelope: { subject: 'CCTV FOOTAGE REQUIRED', messageId: `<m${uid}@ajio.com>` },
    source: 'A'.repeat(bytes),
    bytes
  })

  it('reads the mailbox here, then hands every request to TrackVid', async () => {
    state.fetched = [message(1, 10), message(2, 10)]
    state.answers[`/mailboxes/${MAILBOX}/ingest`] = { success: true, data: { received: 2, stored: 2, refused: [] } }

    const result = await refetchMailbox({ mailboxId: MAILBOX })

    expect(result).toMatchObject({ success: true, data: { found: 2, uploaded: 2, stored: 2, skipped: 0 } })
    expect(paths()).toEqual([
      `GET /mailboxes/${MAILBOX}/desktop-credentials`,
      'IMAP IMAP fetch',
      `POST /mailboxes/${MAILBOX}/ingest`
    ])
    // The raw message goes up; the size used for batching does not.
    expect((state.calls.at(-1)?.body as { messages: Record<string, unknown>[] }).messages[0]).not.toHaveProperty('bytes')
  })

  it('says how many TrackVid refused', async () => {
    state.fetched = [message(1, 10), message(2, 10)]
    state.answers[`/mailboxes/${MAILBOX}/ingest`] = {
      success: true,
      data: { received: 2, stored: 1, refused: [{ index: 1, reason: 'no source' }] }
    }

    const result = await refetchMailbox({ mailboxId: MAILBOX })

    expect(result).toMatchObject({ success: true, data: { found: 2, stored: 1, skipped: 1 } })
  })

  it('uploads nothing when the mailbox holds no request', async () => {
    const result = await refetchMailbox({ mailboxId: MAILBOX })

    expect(result).toMatchObject({ success: true, data: { found: 0, uploaded: 0, stored: 0, folder: 'INBOX', since: '2026-10-27T00:00:00.000Z' } })
    expect(paths()).not.toContain(`POST /mailboxes/${MAILBOX}/ingest`)
  })
})

describe('ingest batches', () => {
  const sized = (bytes: number) => ({
    uid: 1,
    internalDate: null,
    envelope: {
      subject: undefined,
      messageId: undefined,
      inReplyTo: undefined,
      from: undefined,
      replyTo: undefined,
      sender: undefined
    },
    source: 'A'.repeat(bytes),
    bytes
  })

  it('caps each upload by count', () => {
    const { batches } = ingestBatches(Array.from({ length: 30 }, () => sized(10)), 25)

    expect(batches.map(batch => batch.length)).toEqual([25, 5])
  })

  it('caps each upload under the body limit, and leaves out a message too large to send', () => {
    const MB = 1024 * 1024
    const { batches, tooLarge } = ingestBatches([sized(2 * MB), sized(2 * MB), sized(4 * MB)], 25)

    expect(batches.map(batch => batch.length)).toEqual([1, 1])
    expect(tooLarge).toBe(1)
  })
})

describe('Edit last sync date', () => {
  it("sends TrackVid's own route the chosen moment", async () => {
    state.answers[`/mailboxes/${MAILBOX}/last-sync`] = {
      success: true,
      data: { mailboxId: MAILBOX, lastSyncedAt: '2026-10-20T04:30:00.000Z' }
    }

    const result = await updateMailboxLastSync({ mailboxId: MAILBOX, lastSyncedAt: '2026-10-20T04:30:00.000Z' })

    expect(result).toEqual({
      success: true,
      data: { mailboxId: MAILBOX, lastSyncedAt: '2026-10-20T04:30:00.000Z' }
    })
    expect(state.calls).toEqual([
      { path: `/mailboxes/${MAILBOX}/last-sync`, method: 'PATCH', body: { lastSyncedAt: '2026-10-20T04:30:00.000Z' } }
    ])
  })

  it('refuses a future date, a missing date and a bad id before asking', async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString()

    expect((await updateMailboxLastSync({ mailboxId: MAILBOX, lastSyncedAt: future })).success).toBe(false)
    expect((await updateMailboxLastSync({ mailboxId: MAILBOX, lastSyncedAt: 'yesterday' })).success).toBe(false)
    expect((await updateMailboxLastSync({ mailboxId: MAILBOX })).success).toBe(false)
    expect((await updateMailboxLastSync({ mailboxId: 'x', lastSyncedAt: '2026-10-20T04:30:00.000Z' })).success).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it("shows the server's refusal when the feature is switched off there", async () => {
    state.answers[`/mailboxes/${MAILBOX}/last-sync`] = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Manual mailbox sync is disabled on this server (SINGLE_EMAIL_POLLING is not "true").'
      }
    }

    const result = await updateMailboxLastSync({ mailboxId: MAILBOX, lastSyncedAt: '2026-10-20T04:30:00.000Z' })

    expect(result.success).toBe(false)
    expect(!result.success && result.error.message).toContain('SINGLE_EMAIL_POLLING')
  })
})
