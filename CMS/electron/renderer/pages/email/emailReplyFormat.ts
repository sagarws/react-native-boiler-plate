import type { BadgeTone } from '@renderer/components/ui/Badge'
import type { AjioReplyOutcome, AjioReplySender, MailboxSummary } from '@shared/types/emailReply'

/** "5 min ago", "3 h ago", "2 d ago" — the age of a sync, at a glance. */
export const ago = (iso: string | null, now = Date.now()): string => {
  if (!iso) return 'Never'

  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)

  if (Number.isNaN(minutes)) return 'Never'
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`

  return `${Math.round(minutes / (60 * 24))} d ago`
}

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  outlook: 'Outlook',
  zoho: 'Zoho',
  other: 'Other'
}

export const providerLabel = (provider: string): string => PROVIDER_LABEL[provider] ?? provider

/** A mailbox's connection, in the admin's words. */
export const mailboxStatus = (status: string): { label: string; tone: BadgeTone } =>
  status === 'connected'
    ? { label: 'Connected', tone: 'success' }
    : status === 'token_expired'
      ? { label: 'Sign-in expired', tone: 'warning' }
      : { label: status === 'error' ? 'Error' : status, tone: 'danger' }

/** An email's state. `error` is Pending too — a send that failed is still owed. */
export const emailStatus = (status: string): { label: string; tone: BadgeTone } => {
  switch (status) {
    case 'replied':
      return { label: 'Replied', tone: 'success' }
    case 'manually_replied':
      return { label: 'Marked replied', tone: 'info' }
    case 'error':
      return { label: 'Failed', tone: 'danger' }
    default:
      return { label: 'Pending', tone: 'warning' }
  }
}

/**
 * "Oct 13, 2026, 5:47:03 PM" — the expanded conversation's stamp, worded as
 * the web admin words it (date-fns `PPpp`), so the two read the same.
 */
export const conversationStamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })

/** "6:53 PM" — the time half of a timestamp, under its date. */
export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * Why this app cannot refetch or answer from a mailbox, or null when it can.
 * The backend refuses the same cases; saying so on the button saves the trip.
 */
export const desktopUnsupported = (mailbox: MailboxSummary | undefined): string | null => {
  if (!mailbox) return 'The mailbox for this email is not in the list'
  if (mailbox.authType !== 'password') return 'Only app-password mailboxes can be used from this app'
  if (mailbox.provider === 'outlook' || mailbox.provider === 'zoho') {
    return "This mailbox's provider is handled by TrackVid's server only"
  }

  return null
}

/** A reply's outcome, as the row shows it. */
export const replyOutcome = (outcome: AjioReplyOutcome): { label: string; tone: BadgeTone } => {
  switch (outcome) {
    case 'replied':
      return { label: 'Sent', tone: 'success' }
    case 'refused':
      return { label: 'Not sent', tone: 'warning' }
    case 'sent-unrecorded':
      return { label: 'Sent, not recorded', tone: 'danger' }
    default:
      return { label: 'Failed', tone: 'danger' }
  }
}

/** Who sent a reply, as the Replied tab shows it. Null is a reply from before it was recorded. */
export const repliedBy = (sender: AjioReplySender | null): { label: string; tone: BadgeTone } | null => {
  switch (sender) {
    case 'server':
      return { label: 'Server', tone: 'neutral' }
    case 'web':
      return { label: 'Web admin', tone: 'info' }
    case 'desktop':
      return { label: 'CMS', tone: 'success' }
    default:
      return null
  }
}
