/**
 * A filed claim's ticket as the marketplace shows it — details, attachments
 * and the comment thread — for the Claims page's ticket window.
 *
 * Platform-agnostic on purpose: the window renders this shape and nothing else,
 * so another marketplace is one main-process provider (TICKET_THREADS in
 * automations/registry) and no UI change.
 *
 * Everything in here came from a marketplace API and is DATA: text is rendered
 * as text, never as HTML, and only https URLs are ever made into links.
 */

export interface TicketThreadField {
  label: string
  value: string
}

export interface TicketThreadSection {
  title: string
  fields: TicketThreadField[]
}

export interface TicketThreadAttachment {
  name: string
  /** https only; null when the marketplace gave none that is safe to open. */
  url: string | null
}

export interface TicketThreadComment {
  author: string
  /** Written by this seller account — drawn on the right, as the portal does. */
  mine: boolean
  at: string | null
  text: string
}

export interface TicketThread {
  platform: string
  ticket: string
  title: string | null
  status: string | null
  createdAt: string | null
  description: string
  attachments: TicketThreadAttachment[]
  comments: TicketThreadComment[]
  /** "Details", in groups — the ticket, the order it is about, everything else. */
  sections: TicketThreadSection[]
  /** False when the marketplace says this ticket takes no reply (Meesho's `enable_reply_workflow`). */
  canReply: boolean
}

export interface TicketThreadTarget {
  platform: string
  username: string
  ticket: string
}

export interface TicketReplyFile {
  name: string
  data: Uint8Array
}

/** A reply is a comment, files, or both — never neither. */
export interface TicketReplyInput extends TicketThreadTarget {
  text: string
  files: TicketReplyFile[]
}

export const ticketReplyFileExtension = (name: string): string =>
  (name.split('.').pop() ?? '').toLowerCase()

/**
 * What one marketplace's ticket window takes in a reply.
 *
 * The type sent is derived from the extension in the main process, never
 * trusted from the renderer: Windows labels a .zip
 * `application/x-zip-compressed`, which no portal lists.
 */
export interface TicketReplyRules {
  /** Extension → the MIME type sent. */
  files: Readonly<Record<string, string>>
  /** The chips the window shows, in the portal's order. */
  labels: readonly string[]
  /**
   * Extensions that go up as the comment's VIDEO rather than as an attachment —
   * Snapdeal's separate "Attach video", one per comment. Empty elsewhere.
   */
  videoExtensions: readonly string[]
  maxFileBytes: number
  /** Videos may be larger than files where the portal says so. */
  maxVideoBytes: number
  maxFiles: number
  maxChars: number
  /** One line under "File upload", in the portal's terms. */
  hint: string
}

const MB = 1024 * 1024

const IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' } as const

/**
 * Per marketplace, keyed like TICKET_THREAD_PLATFORMS. Each list is the one the
 * portal's own window offers:
 *   AJIO      PNG, PDF, DOCX, PPT, XLSX, ZIP, JPEG, MP4 — 10 MB each, one per request
 *   Meesho    images, PDF and MP4, uploaded one by one, then sent with the reply
 *   Snapdeal  images and files ("ATTACH") plus one video ("ATTACH VIDEO") per comment
 *   Nykaa     a Zoho Desk portal comment: files uploaded first, then listed on it
 */
export const TICKET_REPLY_RULES: Readonly<Record<string, TicketReplyRules>> = {
  ajio: {
    files: {
      ...IMAGES,
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip: 'application/zip',
      mp4: 'video/mp4'
    },
    labels: ['PNG', 'PDF', 'DOCX', 'PPT', 'XLSX', 'ZIP', 'JPEG', 'MP4'],
    videoExtensions: [],
    maxFileBytes: 10 * MB,
    maxVideoBytes: 10 * MB,
    maxFiles: 5,
    maxChars: 5_000,
    hint: 'Screenshots, photos or documents that support the claim.'
  },
  meesho: {
    files: { ...IMAGES, pdf: 'application/pdf', mp4: 'video/mp4' },
    labels: ['PNG', 'JPEG', 'PDF', 'MP4'],
    videoExtensions: [],
    // Meesho states 25 MB in its own refusal ("File too large. Maximum size: 25MB").
    maxFileBytes: 25 * MB,
    maxVideoBytes: 25 * MB,
    maxFiles: 5,
    maxChars: 5_000,
    hint: 'Images, a PDF or the unpacking video — sent together with the reply.'
  },
  nykaa: {
    files: {
      ...IMAGES,
      pdf: 'application/pdf',
      mp4: 'video/mp4',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    },
    labels: ['PNG', 'JPEG', 'PDF', 'MP4', 'XLSX', 'DOCX'],
    videoExtensions: [],
    // Zoho Desk's portal limit per attachment.
    maxFileBytes: 20 * MB,
    maxVideoBytes: 20 * MB,
    maxFiles: 5,
    maxChars: 5_000,
    hint: 'Images, a PDF or the unpacking video — uploaded, then sent with the comment.'
  },
  snapdeal: {
    files: { ...IMAGES, pdf: 'application/pdf', mp4: 'video/mp4' },
    labels: ['PNG', 'JPEG', 'PDF', 'MP4 (one video)'],
    videoExtensions: ['mp4'],
    maxFileBytes: 10 * MB,
    maxVideoBytes: 25 * MB,
    maxFiles: 5,
    maxChars: 5_000,
    hint: 'Images and files go as attachments; one MP4 goes as the comment video.'
  }
}

export const ticketReplyRules = (platform: string): TicketReplyRules | null =>
  TICKET_REPLY_RULES[platform.toLowerCase().trim()] ?? null

/** Upper bound across platforms, for messages that are not about one of them. */
export const TICKET_REPLY_MAX_CHARS = 5_000
