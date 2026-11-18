import type {
  TicketThread,
  TicketThreadAttachment,
  TicketThreadComment,
  TicketThreadSection
} from '@shared/types/ticketThread'
import {
  MAX_COMMENTS,
  display,
  fieldsOf,
  httpsUrl,
  humaniseKey,
  list,
  record,
  remainingFieldsOf,
  text
} from '@main/automations/common/ticketValues'

// Re-exported: the AJIO tests and earlier callers import it from here.
export { humaniseKey }

/**
 * An AJIO ticket — the `result` of GET /malekith/castellan/api/v1/tickets/{id}
 * (the core's `getTicket`) — in the shared ticket-window shape.
 *
 * PURE and exported for tests. The input is a marketplace response, so every
 * field is coerced; comments arrive as HTML ("<br />") and are turned into
 * text by the caller-supplied `htmlToText` — the core's, so the claim flow and
 * this window read AJIO's markup the same way.
 */

/** The ticket fields the portal's Details panel leads with, in its order. */
const TICKET_FIELDS: readonly [string, string][] = [
  ['ticketId', 'Ticket ID'],
  ['status', 'Status'],
  ['ticketType', 'Ticket type'],
  ['issueType', 'Issue type'],
  ['subIssueType', 'Sub issue type'],
  ['priority', 'Priority'],
  ['orderId', 'Order ID'],
  ['fulfilmentType', 'Fulfilment type'],
  ['storeName', 'Store'],
  ['assignmentGroup', 'Assignment group'],
  ['createdDate', 'Created'],
  ['resolvedDate', 'Resolved'],
  ['resolvedBy', 'Resolved by'],
  ['resolution', 'Resolution'],
  ['sellerContactNo', 'Seller contact'],
  ['sellerEmail', 'Seller email']
]

/** Shown elsewhere in the window, so not repeated as "other" fields. */
const SHOWN_ELSEWHERE = new Set(['description', 'issueTitle', 'comments', 'attachments', 'orderDetails'])

const sectionsOf = (ticket: Record<string, unknown>): TicketThreadSection[] => {
  const skip = new Set([...TICKET_FIELDS.map(([key]) => key), ...SHOWN_ELSEWHERE])

  const sections: TicketThreadSection[] = [
    { title: 'Ticket', fields: fieldsOf(ticket, TICKET_FIELDS) },
    { title: 'Order details', fields: remainingFieldsOf(record(ticket.orderDetails), new Set()) },
    // Anything else AJIO sends — "show all data", including fields added later.
    { title: 'Other', fields: remainingFieldsOf(ticket, skip) }
  ]

  return sections.filter((section) => section.fields.length > 0)
}

const attachmentOf = (value: unknown): TicketThreadAttachment => {
  const raw = record(value)

  return {
    name: display(raw.fileName) || 'Attachment',
    url: httpsUrl(raw.url)
  }
}

const commentOf =
  (htmlToText: (html: string) => string) =>
  (value: unknown): TicketThreadComment => {
    const raw = record(value)
    const authorType = display(raw.authorType).toUpperCase()
    const mine = authorType === 'SELLER'

    return {
      author: mine ? 'You' : display(raw.authorName) || 'AJIO',
      mine,
      at: display(raw.createdAt) || null,
      text: htmlToText(text(raw.content))
    }
  }

export const toTicketThread = (
  raw: unknown,
  ticket: string,
  htmlToText: (html: string) => string
): TicketThread | null => {
  const result = record(raw)

  // The detail answers for the ticket asked for; anything else is not this claim's.
  if (display(result.ticketId) !== ticket) return null

  return {
    platform: 'ajio',
    ticket,
    title: display(result.issueTitle) || null,
    status: display(result.status) || null,
    createdAt: display(result.createdDate) || null,
    description: text(result.description).trim(),
    attachments: list(result.attachments).map(attachmentOf),
    comments: list(result.comments).slice(0, MAX_COMMENTS).map(commentOf(htmlToText)),
    sections: sectionsOf(result),
    // AJIO's window offers a comment box on every status, REJECTED included.
    canReply: true
  }
}
