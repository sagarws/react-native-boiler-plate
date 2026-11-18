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
  list,
  oldestFirst,
  record,
  remainingFieldsOf,
  text
} from '@main/automations/common/ticketValues'

/**
 * A Snapdeal query case — GET /queries/caseDetail (the core's `getCaseDetail`)
 * — in the shared ticket-window shape.
 *
 * `tktCase` is the case, `lstCaseComments` the thread (newest first, so it is
 * re-ordered for reading) and `lstCaseAttachments` every file on the case. The
 * case's video is a separate `videoLink`, listed with the attachments as the
 * panel lists it.
 *
 * PURE and exported for tests.
 */

const CASE_FIELDS: readonly [string, string][] = [
  ['ticketNumber', 'Ticket number'],
  ['status', 'Status'],
  ['categoryName', 'Category'],
  ['subCategoryName', 'Sub category'],
  ['problemAreaName', 'Problem area'],
  ['createdDate', 'Created'],
  ['lastModifiedDate', 'Last modified'],
  ['ticketSFDCId', 'Reference']
]

/** Shown elsewhere in the window, or a repeat of a field above under its id spelling. */
const SHOWN_ELSEWHERE = new Set(['subject', 'caseSummary', 'videoLink', 'categoryId', 'subCategoryId', 'problemAreaId'])

/**
 * Who wrote a comment. Snapdeal sends only `commentator`, and both captured
 * comments — the seller's own, typed in the panel — came back as "System", so
 * "System" is this seller. Any other name is Snapdeal's team, on the left.
 */
const commentOf = (value: unknown): TicketThreadComment => {
  const raw = record(value)
  const commentator = display(raw.commentator)
  const mine = commentator === '' || commentator.toLowerCase() === 'system'

  return {
    author: mine ? 'You' : commentator,
    mine,
    at: display(raw.createdDate) || null,
    text: text(raw.commentBody).trim()
  }
}

const attachmentOf = (value: unknown): TicketThreadAttachment => {
  const raw = record(value)

  return { name: display(raw.name) || 'Attachment', url: httpsUrl(raw.url) }
}

export const toTicketThread = (raw: unknown, ticket: string): TicketThread | null => {
  const body = record(raw)
  const tktCase = record(body.tktCase)

  // The answer is for the case asked for, or it is not this claim's.
  if (display(tktCase.ticketNumber) !== ticket) return null

  const skip = new Set([...CASE_FIELDS.map(([key]) => key), ...SHOWN_ELSEWHERE])
  const video = httpsUrl(tktCase.videoLink)

  const sections: TicketThreadSection[] = [
    { title: 'Ticket', fields: fieldsOf(tktCase, CASE_FIELDS) },
    {
      title: 'Other',
      fields: [
        ...remainingFieldsOf(tktCase, skip),
        ...fieldsOf(body, [
          ['noOfReopens', 'Times reopened'],
          ['caseReopened', 'Reopened']
        ])
      ]
    }
  ]

  return {
    platform: 'snapdeal',
    ticket,
    title: display(tktCase.subject) || null,
    status: display(tktCase.status) || null,
    createdAt: display(tktCase.createdDate) || null,
    // The panel opens the thread with this as Snapdeal's first line.
    description: text(tktCase.caseSummary).trim(),
    attachments: [
      ...list(body.lstCaseAttachments).map(attachmentOf),
      ...(video ? [{ name: 'Video', url: video }] : [])
    ],
    comments: oldestFirst(list(body.lstCaseComments).map(commentOf), (comment) => comment.at).slice(-MAX_COMMENTS),
    sections: sections.filter((section) => section.fields.length > 0),
    // A comment on a closed case reopens it (caseReopened), so there is always a reply box.
    canReply: true
  }
}

/** The case's current video link, which a comment carries forward when it adds no new one. */
export const currentVideoLink = (raw: unknown): string | null =>
  httpsUrl(record(record(raw).tktCase).videoLink)
