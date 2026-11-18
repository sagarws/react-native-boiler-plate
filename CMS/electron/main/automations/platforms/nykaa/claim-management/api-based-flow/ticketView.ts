import type {
  TicketThread,
  TicketThreadAttachment,
  TicketThreadComment,
  TicketThreadField,
  TicketThreadSection
} from '@shared/types/ticketThread'
import { plainText } from '@main/automations/common/claimResources'
import {
  MAX_COMMENTS,
  display,
  fieldsOf,
  httpsUrl,
  list,
  oldestFirst,
  record,
  remainingFieldsOf,
  text
} from '@main/automations/common/ticketValues'

/**
 * Nykaa's ticket — a Zoho Desk portal ticket — as the ticket window shows it.
 *
 * The core hands over what the portal's own ticket page reads
 * (`fetchTicketThread`): the ticket, its conversations (threads in full, with
 * HTML `content`) and its attachment list. Everything here is data from the
 * portal: HTML becomes plain text, and only https links survive.
 */

/** The ticket-level fields the portal's page shows, in its order. */
const TICKET_FIELDS: readonly [string, string][] = [
  ['ticketNumber', 'Ticket number'],
  ['status', 'Status'],
  ['category', 'Category'],
  ['subCategory', 'Sub category'],
  ['classification', 'Classification'],
  ['priority', 'Priority'],
  ['channel', 'Channel'],
  ['createdTime', 'Created'],
  ['modifiedTime', 'Updated'],
  ['dueDate', 'Due'],
  ['customerResponseTime', 'Last customer response'],
  ['closedTime', 'Closed']
]

/** Shown elsewhere in the window, or internal ids — not repeated as "other" fields. */
const SHOWN_ELSEWHERE = new Set([
  'subject',
  'description',
  'customFields',
  'cf',
  'products',
  'contact',
  'assignee',
  'id',
  'contactId',
  'departmentId',
  'assigneeId',
  'productId',
  'layoutId',
  'accountId',
  'teamId',
  'webUrl'
])

/**
 * The claim's own form: Zoho's custom fields. Most are unset on any one ticket
 * (and "false" for an unticked checkbox), so only those carrying a value show.
 */
const customFieldsOf = (value: unknown): TicketThreadField[] =>
  Object.entries(record(value))
    .map(([label, raw]) => ({ label, value: display(raw) }))
    .filter((field) => field.value !== '' && field.value.toLowerCase() !== 'false')

/** A file the portal links, from the ticket's list or from a conversation. */
const attachmentOf = (value: unknown): TicketThreadAttachment => {
  const raw = record(value)

  return { name: display(raw.name) || 'Attachment', url: httpsUrl(raw.href) }
}

const commentOf = (value: unknown): TicketThreadComment => {
  const raw = record(value)
  // "out" is this seller writing — from the portal, a reply or a comment; "in"
  // is Nykaa's team, usually by email.
  const mine = display(raw.direction).toLowerCase() === 'out'
  const author = display(record(raw.responder).name) || display(record(raw.commenter).name)
  const body = plainText(raw.content) || text(raw.summary).trim()

  return {
    author: mine ? 'You' : author || 'Nykaa',
    mine,
    at: display(raw.createdTime) || display(raw.commentedTime) || null,
    text: body
  }
}

export interface NykaaTicketRaw {
  id?: unknown
  ticket?: unknown
  conversations?: unknown
  attachments?: unknown
}

export const toTicketThread = (raw: unknown, ticket: string): TicketThread | null => {
  const bundle = record(raw) as NykaaTicketRaw
  const data = record(bundle.ticket)

  // The answer is for the ticket asked for — by its number, or Zoho's id.
  if (display(data.ticketNumber) !== ticket && display(data.id) !== ticket) return null

  const skip = new Set([...TICKET_FIELDS.map(([key]) => key), ...SHOWN_ELSEWHERE])
  const conversations = list(bundle.conversations)

  const sections: TicketThreadSection[] = [
    { title: 'Ticket', fields: fieldsOf(data, TICKET_FIELDS) },
    { title: 'Claim details', fields: customFieldsOf(data.customFields) },
    // Anything else Zoho sends — "show all data", including fields added later.
    { title: 'Other', fields: remainingFieldsOf(data, skip) }
  ]

  // The ticket's own files, then any a conversation carries, without repeats.
  const seen = new Set<string>()
  const attachments = [
    ...list(bundle.attachments),
    ...conversations.flatMap((entry) => list(record(entry).attachments))
  ]
    .map(attachmentOf)
    .filter((file) => {
      const key = `${file.name}|${file.url ?? ''}`

      if (seen.has(key)) return false
      seen.add(key)

      return true
    })

  const comments = oldestFirst(conversations.map(commentOf), (comment) => comment.at).filter(
    (comment) => comment.text !== ''
  )

  const status = display(data.status) || null

  return {
    platform: 'nykaa',
    ticket,
    title: display(data.subject) || null,
    status,
    createdAt: display(data.createdTime) || null,
    description: plainText(data.description) || '',
    attachments,
    comments: comments.slice(-MAX_COMMENTS),
    sections: sections.filter((section) => section.fields.length > 0),
    // The portal takes a comment on any open ticket; a closed one is reopened
    // from Zoho's own "reopen" flow, not by commenting.
    canReply: (status ?? '').toLowerCase() !== 'closed'
  }
}
