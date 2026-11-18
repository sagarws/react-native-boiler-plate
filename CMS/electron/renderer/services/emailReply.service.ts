import { EMAIL_REPLY_CHANNELS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'
import type {
  AjioEmailCounts,
  AjioEmailDetails,
  AjioEmailPage,
  AjioEmailQuery,
  AjioReplyResult,
  MailboxRefetchResult,
  MailboxSummary
} from '@shared/types/emailReply'
import { invoke } from './ipcClient'

/** The mailboxes connected to the AJIO auto-reply. Read-only. */
export const listMailboxes = (): Promise<Result<MailboxSummary[]>> =>
  invoke<MailboxSummary[]>(EMAIL_REPLY_CHANNELS.mailboxes)

/** Pending and Replied, across all time, for one mailbox or all of them. */
export const ajioEmailCounts = (mailboxId: string | null): Promise<Result<AjioEmailCounts>> =>
  invoke<AjioEmailCounts>(EMAIL_REPLY_CHANNELS.counts, { mailboxId })

/** One page of AJIO footage requests. Read-only. */
export const listAjioEmails = (query: AjioEmailQuery): Promise<Result<AjioEmailPage>> =>
  invoke<AjioEmailPage>(EMAIL_REPLY_CHANNELS.list, query)

/** One email's text and its latest reply, for an expanded row. Read-only. */
export const ajioEmailDetails = (emailId: string): Promise<Result<AjioEmailDetails>> =>
  invoke<AjioEmailDetails>(EMAIL_REPLY_CHANNELS.details, { emailId })

/** Reads the mailbox for AJIO requests from this machine and hands them to TrackVid. */
export const refetchMailbox = (mailboxId: string): Promise<Result<MailboxRefetchResult>> =>
  invoke<MailboxRefetchResult>(EMAIL_REPLY_CHANNELS.refetch, { mailboxId })

/** Sends the reply TrackVid prepares, from this machine, and has TrackVid record it. */
export const replyToAjioEmail = (emailId: string, mailboxId: string): Promise<Result<AjioReplyResult>> =>
  invoke<AjioReplyResult>(EMAIL_REPLY_CHANNELS.reply, { emailId, mailboxId })

/** Moves the mailbox's last-sync date; the next fetch reads from there. */
export const updateMailboxLastSync = (
  mailboxId: string,
  lastSyncedAt: string
): Promise<Result<{ mailboxId: string; lastSyncedAt: string | null }>> =>
  invoke(EMAIL_REPLY_CHANNELS.lastSync, { mailboxId, lastSyncedAt })
