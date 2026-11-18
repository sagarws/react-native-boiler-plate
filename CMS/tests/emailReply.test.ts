import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Email Reply page reads TrackVid's AJIO auto-reply and changes nothing.
 *
 * Pinned here: only GETs go out, the mailbox document's OAuth access token
 * never reaches the renderer, and input from the renderer is checked before it
 * becomes a query string.
 */

interface Calls {
  requests: { path: string; options: Record<string, unknown> }[]
  answer: unknown
  token: string | null
}

const calls = vi.hoisted((): Calls => ({ requests: [], answer: null, token: null }))

vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: Record<string, unknown> = {}) => {
    calls.requests.push({ path, options })

    return Promise.resolve(calls.answer)
  }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => calls.token }))

const { requestIds } = await import('@shared/utils/ajioSubject')
const { ajioEmailCounts, ajioEmailDetails, listAjioEmails, listMailboxes } = await import(
  '@main/services/emailReply.service'
)

const MAILBOX = '0123456789abcdef01234567'

beforeEach(() => {
  calls.requests.length = 0
  calls.token = 'jwt'
})

describe('the mailbox list', () => {
  it('keeps the access token in the main process', async () => {
    calls.answer = {
      success: true,
      data: {
        mailboxes: [
          {
            _id: MAILBOX,
            email: 'seller@gmail.com',
            provider: 'google',
            authType: 'password',
            status: 'connected',
            tokens: { accessToken: 'secret-oauth-token' },
            config: { imapHost: 'imap.gmail.com' },
            inboxSync: { lastSyncedAt: '2026-10-28T05:00:00.000Z' },
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }
    }

    const result = await listMailboxes()

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data).toEqual([
      {
        id: MAILBOX,
        email: 'seller@gmail.com',
        displayName: null,
        provider: 'google',
        authType: 'password',
        status: 'connected',
        lastSyncedAt: '2026-10-28T05:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ])
    expect(JSON.stringify(result.data)).not.toContain('secret-oauth-token')
    expect(calls.requests[0]).toMatchObject({ path: '/mailboxes/list', options: { bare: true } })
    expect(calls.requests[0]?.options['method']).toBeUndefined()
  })

  it('asks nothing of the server when nobody is signed in', async () => {
    calls.token = null

    expect((await listMailboxes()).success).toBe(false)
    expect(calls.requests).toHaveLength(0)
  })
})

describe('the AJIO emails', () => {
  it('refuses a status or mailbox it does not recognise', async () => {
    expect((await listAjioEmails({ status: 'everything', page: 1, pageSize: 20 })).success).toBe(false)
    expect(
      (await listAjioEmails({ status: 'pending', page: 1, pageSize: 20, mailboxId: '{"$ne":1}' })).success
    ).toBe(false)
    expect((await ajioEmailCounts({ mailboxId: '../admin' })).success).toBe(false)
    expect(calls.requests).toHaveLength(0)
  })

  it('reads one page, with only the page sizes the page offers', async () => {
    calls.answer = {
      success: true,
      data: {
        items: [
          {
            _id: 'e1',
            subject: 'CCTV FOOTAGE REQUIRED || FN123',
            sender: { name: 'AJIO', email: 'seller.communication@ajio.com' },
            status: 'error',
            receivedAt: '2026-10-27T10:00:00.000Z',
            mailboxId: MAILBOX,
            retryAttempts: 2,
            replyDetail: { errorMessage: 'video_not_found', sentBy: 'desktop' },
            ajioAcknowledgementReplied: false
          }
        ],
        total: 1,
        hasMore: false
      }
    }

    const result = await listAjioEmails({ status: 'pending', page: 3, pageSize: 9999, mailboxId: MAILBOX })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.pageSize).toBe(20)
    expect(result.data.items[0]).toMatchObject({
      id: 'e1',
      status: 'error',
      senderEmail: 'seller.communication@ajio.com',
      replyError: 'video_not_found',
      retryAttempts: 2,
      repliedBy: 'desktop'
    })

    const path = calls.requests[0]?.path ?? ''

    expect(path.startsWith('/emails/list-by-status?')).toBe(true)
    expect(path).toContain('status=pending')
    expect(path).toContain('page=3')
    expect(path).toContain('pageSize=20')
    expect(path).toContain(`mailboxId=${MAILBOX}`)
  })

  it('counts both tabs over the same span the list covers', async () => {
    calls.answer = { success: true, data: { pending: { total: 98 }, replied: { total: 4 } } }

    const result = await ajioEmailCounts({ mailboxId: null })

    expect(result).toEqual({ success: true, data: { pending: 98, replied: 4 } })

    const path = calls.requests[0]?.path ?? ''

    expect(path).toContain('pendingStartDate=2024-10-25')
    expect(path).toContain('repliedStartDate=2024-10-25')
    expect(path).not.toContain('mailboxId')
  })
})

describe('the request column', () => {
  it('leads with the identifiers, not the words every row shares', () => {
    expect(requestIds('CCTV FOOTAGE REQUIRED||INC00115271226||RT233745000||DV00355713')).toEqual([
      'INC00115271226',
      'RT233745000',
      'DV00355713'
    ])
  })

  it('shows any other subject whole', () => {
    expect(requestIds('Re: footage for order 123')).toEqual(['Re: footage for order 123'])
    expect(requestIds('CCTV FOOTAGE REQUIRED')).toEqual(['CCTV FOOTAGE REQUIRED'])
  })
})

describe('who sent a reply', () => {
  it('passes on only the three senders TrackVid records', async () => {
    const { toAjioEmailRow } = await import('@main/services/emailReply.service')

    expect(toAjioEmailRow({ _id: 'a', replyDetail: { sentBy: 'server' } })?.repliedBy).toBe('server')
    expect(toAjioEmailRow({ _id: 'a', replyDetail: { sentBy: 'web' } })?.repliedBy).toBe('web')
    // Older replies, and anything unexpected, read as unknown rather than a guess.
    expect(toAjioEmailRow({ _id: 'a', replyDetail: {} })?.repliedBy).toBeNull()
    expect(toAjioEmailRow({ _id: 'a', replyDetail: { sentBy: 'someone' } })?.repliedBy).toBeNull()
    expect(toAjioEmailRow({ _id: 'a' })?.repliedBy).toBeNull()
  })
})

describe('an expanded email', () => {
  const EMAIL = 'abcdef0123456789abcdef01'
  // The shape `/emails/details/:id` answers with: the mail's HTML under `bodyRaw`.
  const AJIO_HTML =
    '<p>Ticket No:INC00114338459</p><p>Hi Team,</p>' +
    '<table><tr><td style="background:yellow">WFR</td></tr>' +
    '<tr><td>Order ID: FN9544801784</td></tr></table><p>Regards,</p><p>Team AJIO</p>'

  it('hands over the HTML the admin renders, and a text fallback', async () => {
    calls.answer = {
      success: true,
      data: { _id: EMAIL, bodyRaw: AJIO_HTML, meta: { html: AJIO_HTML }, replyDetail: null }
    }

    const result = await ajioEmailDetails({ emailId: EMAIL })

    expect(calls.requests[0]?.path).toBe(`/emails/details/${EMAIL}`)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.body?.html).toBe(AJIO_HTML)
    expect(result.data.body?.text).toContain('Order ID: FN9544801784')
    expect(result.data.reply).toBeNull()
  })

  it('treats a `body` that is markup as HTML, as the admin does', async () => {
    calls.answer = { success: true, data: { body: AJIO_HTML } }

    const result = await ajioEmailDetails({ emailId: EMAIL })

    expect(result.success && result.data.body?.html).toBe(AJIO_HTML)
  })

  it('keeps a plain-text mail as text', async () => {
    calls.answer = { success: true, data: { body: 'Hi Team,\nPlease share the footage.' } }

    const result = await ajioEmailDetails({ emailId: EMAIL })

    expect(result.success && result.data.body).toEqual({
      html: null,
      text: 'Hi Team,\nPlease share the footage.'
    })
  })

  it('carries the reply when one was sent', async () => {
    calls.answer = {
      success: true,
      data: {
        bodyRaw: AJIO_HTML,
        replyDetail: { bodyRaw: '<p>Footage attached</p>', repliedAt: '2026-10-14T05:00:00.000Z' }
      }
    }

    const result = await ajioEmailDetails({ emailId: EMAIL })

    expect(result.success && result.data.reply?.body?.html).toBe('<p>Footage attached</p>')
    expect(result.success && result.data.reply?.repliedAt).toBe('2026-10-14T05:00:00.000Z')
  })

  it('refuses an id that is not an ObjectId before any request', async () => {
    const result = await ajioEmailDetails({ emailId: '../mailboxes/list' })

    expect(result.success).toBe(false)
    expect(calls.requests).toHaveLength(0)
  })
})

describe('the address a row was sent to', () => {
  it('lists To then CC, lower-cased and once each, skipping junk', async () => {
    calls.answer = {
      success: true,
      data: {
        items: [
          {
            _id: 'abcdef0123456789abcdef02',
            subject: 'CCTV FOOTAGE REQUIRED||INC00114338459||DV00342439',
            to: [{ name: 'Dhilepan', email: 'Dhilepan.R@thebearhouse.com' }, { name: 'no email' }],
            cc: [{ email: 'dhilepan.r@thebearhouse.com' }, { email: 'ops@thebearhouse.com' }, 'junk']
          }
        ],
        total: 1
      }
    }

    const result = await listAjioEmails({ status: 'pending', page: 1, pageSize: 20 })

    expect(result.success && result.data.items[0]?.recipients).toEqual([
      'dhilepan.r@thebearhouse.com',
      'ops@thebearhouse.com'
    ])
  })
})
