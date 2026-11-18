import { EMAIL_REPLY_CHANNELS } from '@shared/constants/channels'
import {
  ajioEmailCounts,
  ajioEmailDetails,
  listAjioEmails,
  listMailboxes,
  refetchMailbox,
  replyToAjioEmail,
  updateMailboxLastSync
} from '../services/emailReply.service'
import { registerHandler } from './handler'

/**
 * The reads are GETs against TrackVid. Refetch and Reply talk to the mailbox's
 * own mail server from this machine; every input is checked in the service
 * before it becomes a URL or reaches a server.
 */
export const registerEmailReplyIpc = (): void => {
  registerHandler(EMAIL_REPLY_CHANNELS.mailboxes, () => listMailboxes())
  registerHandler(EMAIL_REPLY_CHANNELS.counts, ajioEmailCounts)
  registerHandler(EMAIL_REPLY_CHANNELS.list, listAjioEmails)
  registerHandler(EMAIL_REPLY_CHANNELS.details, ajioEmailDetails)
  registerHandler(EMAIL_REPLY_CHANNELS.refetch, refetchMailbox)
  registerHandler(EMAIL_REPLY_CHANNELS.reply, replyToAjioEmail)
  registerHandler(EMAIL_REPLY_CHANNELS.lastSync, updateMailboxLastSync)
}
