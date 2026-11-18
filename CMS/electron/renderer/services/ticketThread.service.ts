import { TICKET_THREAD_CHANNELS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import type { TicketReplyInput, TicketThread, TicketThreadTarget } from '@shared/types/ticketThread'
import { invoke } from './ipcClient'

/** Reads a filed claim's ticket from the marketplace. */
export const openTicketThread = (target: TicketThreadTarget): Promise<Result<TicketThread>> =>
  invoke<TicketThread>(TICKET_THREAD_CHANNELS.open, target)

/** Uploads the files and/or adds the comment, and answers with the ticket as it now reads. */
export const replyToTicketThread = (input: TicketReplyInput): Promise<Result<TicketThread>> =>
  invoke<TicketThread>(TICKET_THREAD_CHANNELS.reply, input)
