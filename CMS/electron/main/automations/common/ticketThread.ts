import type { Result } from '@shared/types/result'
import type { TicketThread } from '@shared/types/ticketThread'

/** A file the service has already checked: allowed extension, size, and the type to send. */
export interface CheckedReplyFile {
  name: string
  mimeType: string
  data: Uint8Array
  /** Goes up as the comment's video (Snapdeal), not as an attachment. */
  video: boolean
}

/**
 * A marketplace's ticket, as the Claims page's ticket window needs it.
 *
 * One per platform, in TICKET_THREADS (automations/registry). The service in
 * front has validated everything: a trimmed account, a ticket id of digits, and
 * a reply that is a comment, files, or both.
 */
export interface TicketThreadProvider {
  open: (input: { username: string; ticket: string }) => Promise<Result<TicketThread>>
  /** Uploads the files, then adds the comment, then answers with the ticket as it now reads. */
  reply: (input: {
    username: string
    ticket: string
    text: string
    files: CheckedReplyFile[]
  }) => Promise<Result<TicketThread>>
}
