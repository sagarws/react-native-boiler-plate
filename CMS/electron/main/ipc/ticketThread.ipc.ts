import { TICKET_THREAD_CHANNELS } from '@shared/constants/channels'
import { openTicketThread, replyToTicketThread } from '../services/ticketThread.service'
import { registerHandler } from './handler'

export const registerTicketThreadIpc = (): void => {
  registerHandler(TICKET_THREAD_CHANNELS.open, openTicketThread)
  registerHandler(TICKET_THREAD_CHANNELS.reply, replyToTicketThread)
}
