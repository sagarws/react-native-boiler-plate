import type {
  TicketThread,
  TicketThreadAttachment,
  TicketThreadComment,
  TicketThreadField,
  TicketThreadSection
} from '@shared/types/ticketThread'
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
 * A Meesho ticket — the `data` of POST /api/experience/support/fetchTicket (the
 * core's `fetchTicket`) — in the shared ticket-window shape.
 *
 * The ticket's own form comes back as `details[]`, one entry per field the
 * claim was filed with. A plain entry is a Details row ("AWB Number"); an
 * image or video entry ("Barcode Image", "Unpacking Video") is evidence, and is
 * listed with the attachments under its label. `updates[]` is the thread.
 *
 * PURE and exported for tests.
 */

/** The ticket-level fields the panel's page shows, in its order. */
const TICKET_FIELDS: readonly [string, string][] = [
  ['ticket_id', 'Ticket ID'],
  ['status', 'Status'],
  ['category_title', 'Category'],
  ['subOrderNum', 'Sub order number'],
  ['created_at', 'Created'],
  ['estimated_response_time', 'Expected response time'],
  ['modified_at', 'Updated'],
  ['ticket_type', 'Ticket type'],
  ['reopen_count', 'Reopen count']
]

/** Shown elsewhere in the window, or internal — not repeated as "other" fields. */
const SHOWN_ELSEWHERE = new Set([
  'title',
  'description',
  'details',
  'updates',
  'last_update',
  'feedback',
  'enable_reply_workflow',
  'enable_reopen_workflow'
])

/** The description is already the window's lead text; repeating it as a row adds nothing. */
const DESCRIPTION_KEYS = new Set(['ticket_desc'])

interface FormParts {
  fields: TicketThreadField[]
  evidence: TicketThreadAttachment[]
}

/** Splits the claim's own form into Details rows and evidence links. */
const formOf = (details: unknown): FormParts => {
  const fields: TicketThreadField[] = []
  const evidence: TicketThreadAttachment[] = []

  for (const entry of list(details).map(record)) {
    const label = display(entry.label) || display(entry.key)

    if (!label || DESCRIPTION_KEYS.has(display(entry.key))) continue

    if (Array.isArray(entry.value)) {
      const links = entry.value.map(httpsUrl)

      links.forEach((url, index) =>
        evidence.push({ name: links.length > 1 ? `${label} ${index + 1}` : label, url })
      )
      continue
    }

    // A dropdown answers with its code ("tampered") and the label it showed ("Tampered").
    const value = display(entry.selectedLabel) || display(entry.value)

    if (value) fields.push({ label, value })
  }

  return { fields, evidence }
}

const commentOf = (value: unknown): TicketThreadComment => {
  const raw = record(value)
  // Every update in the capture is AGENT; anything else is the supplier's own reply.
  const mine = display(raw.entity_type).toUpperCase() !== 'AGENT'

  return {
    author: mine ? 'You' : 'Meesho',
    mine,
    at: display(raw.created_at) || null,
    text: text(raw.ticket_update).trim()
  }
}

export const toTicketThread = (raw: unknown, ticket: string): TicketThread | null => {
  const data = record(raw)

  // The answer is for the ticket asked for, or it is not this claim's.
  if (display(data.ticket_id) !== ticket) return null

  const form = formOf(data.details)
  const skip = new Set([...TICKET_FIELDS.map(([key]) => key), ...SHOWN_ELSEWHERE])

  const sections: TicketThreadSection[] = [
    { title: 'Ticket', fields: fieldsOf(data, TICKET_FIELDS) },
    { title: 'Claim details', fields: form.fields },
    // Anything else Meesho sends — "show all data", including fields added later.
    { title: 'Other', fields: remainingFieldsOf(data, skip) }
  ]

  const comments = oldestFirst(list(data.updates).map(commentOf), (comment) => comment.at)

  return {
    platform: 'meesho',
    ticket,
    title: display(data.title) || null,
    status: display(data.status) || null,
    createdAt: display(data.created_at) || null,
    description: text(data.description).trim(),
    attachments: form.evidence,
    comments: comments.slice(-MAX_COMMENTS),
    sections: sections.filter((section) => section.fields.length > 0),
    // Meesho says per ticket whether it takes a reply; absent means it does.
    canReply: data.enable_reply_workflow !== false
  }
}
