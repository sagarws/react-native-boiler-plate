import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

/**
 * AJIO's footage requests, read and answered over the seller's own mailbox.
 *
 * ONLY THE TWO CONVERSATIONS WITH THE MAIL SERVER LIVE HERE. Which messages
 * count, what the reply says, who it goes to and how it threads are all
 * TrackVid's (prepareAutoReply on the backend, the same code its worker sends
 * with), so this file has no rules of its own to drift from them: it searches
 * the way the worker searches, hands back raw messages, and sends the message
 * it is given.
 *
 * Credentials arrive from the backend for one run and are dropped with it.
 * Nothing here logs them, stores them or returns them.
 */

export interface MailboxCredentials {
  mailboxId: string
  email: string
  imap: { host: string; port: number; secure: boolean }
  smtp: { host: string; port: number; secure: boolean }
  username: string
  password: string
  /** The folder the backend's worker reads — INBOX, a delegated path, or All Mail. */
  folder: string
  /** ISO. Where this refetch starts. */
  since: string
  subjectPattern: string
  expectedSender: string
  maxMessagesPerIngest: number
}

interface EnvelopeAddress {
  name: string | undefined
  address: string | undefined
}

/** One message as the backend's ingest route takes it. */
export interface FetchedMessage {
  uid: number
  internalDate: string | null
  envelope: {
    subject: string | undefined
    messageId: string | undefined
    inReplyTo: string | undefined
    from: EnvelopeAddress[] | undefined
    replyTo: EnvelopeAddress[] | undefined
    sender: EnvelopeAddress[] | undefined
  }
  /** Base64 of the raw RFC 822 source. */
  source: string
  /** Decoded size, for batching under the backend's body limit. */
  bytes: number
}

/** The reply exactly as the backend prepared it. */
export interface PreparedMail {
  from: string
  to: string | string[]
  cc: string | string[] | null
  subject: string
  html: string
  inReplyTo: string
  references: string | string[]
  headers: Record<string, string>
}

/** Bounded so a dead server cannot hold a button spinning for minutes. */
const CONNECT_MS = 20_000
const SOCKET_MS = 60_000

const imapClient = (credentials: MailboxCredentials): ImapFlow =>
  new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: credentials.imap.secure,
    auth: { user: credentials.username, pass: credentials.password },
    // Its default logger writes every command to stdout, LOGIN included.
    logger: false,
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: SOCKET_MS,
    disableAutoIdle: true
  })

/** Logs out, and says nothing if the connection is already gone. */
const close = async (client: ImapFlow): Promise<void> => {
  try {
    await client.logout()
  } catch {
    // Already closed or never opened: there is nothing left to release, and
    // the run's own result is what the operator needs to see.
    client.close()
  }
}

/**
 * Opens the backend's folder, or the provider's All Mail by its special-use
 * flag when that name is localised ("[Gmail]/Alle Nachrichten"), or INBOX.
 */
const openFolder = async (client: ImapFlow, folder: string) => {
  try {
    return await client.getMailboxLock(folder)
  } catch (error) {
    if (folder === 'INBOX') throw error

    const all = (await client.list()).find(entry => entry.specialUse === '\\All')

    return client.getMailboxLock(all?.path ?? 'INBOX')
  }
}

/**
 * The AJIO footage requests since `credentials.since`, raw.
 *
 * THE WORKER'S SEARCH: subject on the server, sender by DOMAIN — a FROM search
 * matches the whole From header, display name included, so a group-forwarded
 * copy still comes back. The backend then filters exactly, on everything
 * the raw source carries.
 */
export const fetchAjioRequests = async (
  credentials: MailboxCredentials,
  shouldStop: () => boolean = () => false
): Promise<FetchedMessage[]> => {
  const client = imapClient(credentials)
  // The 'error' event fires on a dropped socket; unhandled, it would take the
  // main process down with it. The awaited call reports the failure instead.
  client.on('error', () => undefined)

  await client.connect()

  try {
    const lock = await openFolder(client, credentials.folder)

    try {
      const domain = credentials.expectedSender.split('@')[1] ?? credentials.expectedSender
      const uids = await client.search(
        { since: new Date(credentials.since), subject: credentials.subjectPattern, from: domain },
        { uid: true }
      )

      if (!uids || uids.length === 0 || shouldStop()) return []

      const messages = await client.fetchAll(
        uids,
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: true }
      )

      return messages
        .filter(message => message.source && message.source.length > 0)
        .map(message => ({
          uid: message.uid,
          internalDate: message.internalDate ? new Date(message.internalDate).toISOString() : null,
          envelope: {
            subject: message.envelope?.subject,
            messageId: message.envelope?.messageId,
            inReplyTo: message.envelope?.inReplyTo,
            from: message.envelope?.from?.map(({ name, address }) => ({ name, address })),
            replyTo: message.envelope?.replyTo?.map(({ name, address }) => ({ name, address })),
            sender: message.envelope?.sender?.map(({ name, address }) => ({ name, address }))
          },
          source: (message.source as Buffer).toString('base64'),
          bytes: (message.source as Buffer).length
        }))
    } finally {
      lock.release()
    }
  } finally {
    await close(client)
  }
}

/**
 * Marks AJIO's original as read, as the worker does before it replies — so the
 * seller's inbox shows it answered. Best effort: a failure here must not stop
 * the reply, and the caller does not wait on it for longer than it takes.
 */
export const markOriginalRead = async (
  credentials: MailboxCredentials,
  messageId: string
): Promise<boolean> => {
  const client = imapClient(credentials)
  client.on('error', () => undefined)

  try {
    await client.connect()
    const lock = await openFolder(client, credentials.folder)

    try {
      const uids = await client.search({ header: { 'Message-ID': messageId } }, { uid: true })

      if (!uids || uids.length === 0) return false

      return await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } catch {
    // Reported as `false`; the reply goes out regardless, as it does from the
    // worker when its own mark-read fails.
    return false
  } finally {
    await close(client)
  }
}

/** Sends the prepared reply over the mailbox's SMTP. Answers with the sent Message-ID. */
export const sendPreparedReply = async (
  credentials: MailboxCredentials,
  mail: PreparedMail
): Promise<string> => {
  const transport = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.secure,
    auth: { user: credentials.username, pass: credentials.password },
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: SOCKET_MS
  })

  try {
    const info = await transport.sendMail({
      from: mail.from,
      to: mail.to,
      ...(mail.cc ? { cc: mail.cc } : {}),
      subject: mail.subject,
      html: mail.html,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      headers: mail.headers,
      // The message carries a link, never an attachment: nothing may be read
      // from this machine's disk or fetched from a URL into the message.
      disableFileAccess: true,
      disableUrlAccess: true,
      encoding: 'utf-8'
    })

    return info.messageId
  } finally {
    transport.close()
  }
}
