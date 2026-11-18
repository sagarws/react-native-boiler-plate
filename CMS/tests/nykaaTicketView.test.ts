import { describe, expect, it, vi } from 'vitest'

/**
 * The Nykaa ticket window, as api-network-records (9).json shows the portal's
 * ticket page: the ticket, its conversations (threads in full, HTML content),
 * and its attachments.
 *
 * Pinned: the ticket matches by number or Zoho id, "out" is this seller and
 * "in" is Nykaa's team, HTML becomes text, unset custom fields stay out of the
 * Details, and a closed ticket takes no reply.
 */

vi.mock('@main/automations/common/claimResources', () => ({
  plainText: (html: unknown) =>
    typeof html === 'string' ? html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
}))

const { toTicketThread } = await import(
  '@main/automations/platforms/nykaa/claim-management/api-based-flow/ticketView'
)

const bundle = (ticket: Record<string, unknown> = {}) => ({
  id: '77727001633349779',
  ticket: {
    id: '77727001633349779',
    ticketNumber: '7162792',
    subject: 'Wrong Product Returned - Same Brand',
    status: 'Reopen',
    createdTime: '2026-10-26T09:15:43.000Z',
    channel: 'Web',
    customFields: { 'AWB Number': '133901455819012', 'OMS Issues': 'false', Gender: null },
    ...ticket
  },
  conversations: [
    {
      type: 'thread',
      direction: 'out',
      responder: { name: 'jyothi' },
      createdTime: '2026-10-30T12:53:38.013Z',
      summary: 'Hi Team, Noted…',
      content: '<div><p>Hi Team,</p><p>Noted. We are coordinating.</p></div>'
    },
    {
      type: 'thread',
      direction: 'in',
      responder: { name: 'Pooja Jaiswar' },
      createdTime: '2026-10-30T09:56:55.817Z',
      summary: 'Kindly provide correct unpacking footage.'
    },
    {
      type: 'comment',
      direction: 'out',
      commenter: { name: ' jyothi' },
      commentedTime: '2026-10-30T13:55:51.873Z',
      content: 'Hi Team, any update on this ticket please?',
      attachments: [
        {
          name: 'queue_order_video.mp4',
          href: 'https://dispute.nykaa.com/portal/api/tickets/1/comments/2/attachments/3/content'
        }
      ]
    }
  ],
  attachments: []
})

describe('Nykaa toTicketThread', () => {
  it('maps the ticket, oldest message first, seller on the right', () => {
    const thread = toTicketThread(bundle(), '7162792')

    expect(thread).not.toBeNull()
    expect(thread?.platform).toBe('nykaa')
    expect(thread?.title).toBe('Wrong Product Returned - Same Brand')
    expect(thread?.status).toBe('Reopen')
    expect(thread?.comments.map((comment) => [comment.author, comment.mine])).toEqual([
      ['Pooja Jaiswar', false],
      ['You', true],
      ['You', true]
    ])
    // The full thread's HTML becomes text; an entry without content keeps its summary.
    expect(thread?.comments[1]?.text).toBe('Hi Team, Noted. We are coordinating.')
    expect(thread?.comments[0]?.text).toBe('Kindly provide correct unpacking footage.')
    expect(thread?.attachments).toEqual([
      { name: 'queue_order_video.mp4', url: 'https://dispute.nykaa.com/portal/api/tickets/1/comments/2/attachments/3/content' }
    ])
    expect(thread?.canReply).toBe(true)
  })

  it('shows only the custom fields that carry a value', () => {
    const details = toTicketThread(bundle(), '7162792')?.sections.find((section) => section.title === 'Claim details')

    expect(details?.fields).toEqual([{ label: 'AWB Number', value: '133901455819012' }])
  })

  it('matches by Zoho id as well as by number, and refuses another ticket', () => {
    expect(toTicketThread(bundle(), '77727001633349779')).not.toBeNull()
    expect(toTicketThread(bundle(), '9999999')).toBeNull()
  })

  it('a closed ticket takes no reply', () => {
    expect(toTicketThread(bundle({ status: 'Closed' }), '7162792')?.canReply).toBe(false)
  })
})
