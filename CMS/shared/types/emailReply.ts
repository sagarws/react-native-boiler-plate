/**
 * The AJIO email auto-reply, as this app SHOWS it — never as it changes it.
 *
 * The feature lives in TrackVid: the backend reads each connected mailbox,
 * answers AJIO's "CCTV FOOTAGE REQUIRED" emails with the order's video, and the
 * web admin is where mailboxes are added and templates edited. This app only
 * reads the two lists the admin shows, so an operator at this machine can see
 * whether the replies are going out without opening a browser.
 *
 * Shapes are this app's own, not the backend's documents: the mailbox record
 * carries an OAuth access token, and nothing past the main process should ever
 * hold one.
 */

/** One mailbox connected to the auto-reply. */
export interface MailboxSummary {
  id: string
  email: string
  displayName: string | null
  /** google | outlook | zoho | other. */
  provider: string
  /** `password` is an IMAP/SMTP app password; `oauth` a provider sign-in. */
  authType: 'oauth' | 'password' | null
  /** connected | error | token_expired. */
  status: string
  /** ISO. When the backend last read this mailbox. */
  lastSyncedAt: string | null
  createdAt: string | null
}

/** Pending is new, fetched or failed to send; Replied is replied or marked replied. */
export type AjioEmailTab = 'pending' | 'replied'

export interface AjioEmailCounts {
  pending: number
  replied: number
}

/** One AJIO footage request, and what became of the reply to it. */
export interface AjioEmailRow {
  id: string
  subject: string
  senderName: string | null
  senderEmail: string | null
  /** new | fetched | error | replied | manually_replied. */
  status: string
  receivedAt: string | null
  snippet: string | null
  mailboxId: string | null
  retryAttempts: number
  repliedAt: string | null
  /** Why the last send failed, when it did. */
  replyError: string | null
  /** AJIO wrote back to say the footage was received. */
  acknowledged: boolean
  /**
   * Who sent the reply: TrackVid's automatic worker, a web admin button, or
   * this app. Null for replies sent before TrackVid recorded it.
   */
  repliedBy: AjioReplySender | null
  /** The latest reply's subject, To and CC, as TrackVid recorded them. */
  replySubject: string | null
  replyTo: string | null
  replyCc: string | null
  /**
   * The addresses it was sent to (To, then CC), lower-cased. Names the mailbox
   * when its record is gone: a removed mailbox's emails keep its old id.
   */
  recipients: string[]
}

export type AjioReplySender = 'server' | 'web' | 'desktop'

export interface AjioEmailPage {
  items: AjioEmailRow[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface AjioEmailQuery {
  status: AjioEmailTab
  page: number
  pageSize: number
  /** One mailbox, or every mailbox the company has. */
  mailboxId?: string | null
}

/** One side of the conversation: the mail's HTML when it had one, and its text. */
export interface EmailBody {
  /**
   * The mail's own HTML, untouched. Only ever shown inside a sandboxed iframe
   * (no scripts, no navigation, no popups) — never put into this window's DOM.
   */
  html: string | null
  /** The text part, or the HTML converted — for a mail with no HTML. */
  text: string | null
}

/** One email opened from its row: what AJIO sent and what went back. */
export interface AjioEmailDetails {
  emailId: string
  /** The received email, or null when TrackVid holds no body for it. */
  body: EmailBody | null
  /** The latest reply, or null when none was attempted. */
  reply: {
    body: EmailBody | null
    repliedAt: string | null
    errorMessage: string | null
  } | null
}

export const AJIO_EMAIL_PAGE_SIZES = [20, 50, 100] as const

/* -------------------------------------------------------------------------- *
 * Refetch and Reply — done by THIS app, over the mailbox's own IMAP and SMTP.
 *
 * The backend stays the system of record: it hands over the sign-in, stores
 * what was fetched through the same pipeline its worker uses, builds the reply
 * and records the outcome. Only the two network conversations with the mail
 * server happen here, so an operator does not wait for the polling cycle.
 * -------------------------------------------------------------------------- */

/** What one Refetch did, for the row it was pressed on. */
export interface MailboxRefetchResult {
  mailboxId: string
  /** AJIO footage requests the mailbox held in the window searched. */
  found: number
  /** Of those, sent to TrackVid. */
  uploaded: number
  /** Stored or refreshed by TrackVid — acknowledgements and duplicates are not. */
  stored: number
  /** Too large to upload, or refused by TrackVid's checks. */
  skipped: number
  /** ISO. The start of the window searched. */
  since: string
  /**
   * The IMAP folder searched — INBOX, or All Mail when the company chose it in
   * the web admin. Shown with the count, so "0 found" says where it looked: a
   * Gmail filter that archives AJIO mail leaves INBOX empty without any error.
   */
  folder: string
  /** ISO. When this run finished. */
  at: string
}

export type AjioReplyOutcome =
  /** Sent, and recorded in TrackVid. */
  | 'replied'
  /** TrackVid would not hand it over: already replied, being sent, no order, no video. */
  | 'refused'
  /** The mail server would not send it. Recorded in TrackVid as a failed attempt. */
  | 'failed'
  /** Sent, but TrackVid could not be told. It must be checked before anything retries it. */
  | 'sent-unrecorded'

export interface AjioReplyResult {
  emailId: string
  outcome: AjioReplyOutcome
  /** The one line to show: why it was refused or failed, or what was recorded. */
  message: string
  replyId: string | null
  at: string
}
