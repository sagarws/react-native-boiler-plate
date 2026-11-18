import { fail, type Result } from '@shared/types/result'
import {
  ticketReplyFileExtension,
  ticketReplyRules,
  type TicketReplyRules,
  type TicketThread
} from '@shared/types/ticketThread'
import type { CheckedReplyFile } from '../automations/common/ticketThread'
import { ticketThreadProvider } from '../automations/registry'

/**
 * The Claims page's ticket window — validation in front of the per-platform
 * provider (TICKET_THREADS).
 *
 * Everything from the renderer is checked here before a marketplace is
 * touched: a provider acts with a signed-in seller account, so an unchecked id
 * or file would be a request made in that seller's name.
 */

const field = (payload: unknown, key: string): unknown =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined

const trimmed = (value: unknown, max = 320): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** A ticket id as AJIO issues them — digits, nothing a URL could carry. */
const TICKET_ID = /^\d{1,20}$/

interface Target {
  platform: string
  username: string
  ticket: string
}

const targetOf = (payload: unknown): Target | string => {
  const platform = trimmed(field(payload, 'platform'), 40)
  const username = trimmed(field(payload, 'username'))
  const ticket = trimmed(field(payload, 'ticket'), 40)

  if (!platform || !username) return 'This claim has no marketplace account'
  if (!TICKET_ID.test(ticket)) return 'This claim has no ticket id to open'

  return { platform, username, ticket }
}

/** No path separators or control characters: the name goes into a multipart body. */
const safeName = (value: string): string =>
  Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char))
    .join('')

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`

/** The platform's own file rules; the type sent is derived from the extension, never trusted. */
const filesOf = (value: unknown, rules: TicketReplyRules): CheckedReplyFile[] | string => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'The files were not readable'
  if (value.length > rules.maxFiles) return `Attach at most ${rules.maxFiles} files at a time`

  const files: CheckedReplyFile[] = []

  for (const entry of value) {
    const name = safeName(trimmed(field(entry, 'name'), 200))
    const data = field(entry, 'data')
    const extension = ticketReplyFileExtension(name)
    const mimeType = rules.files[extension]
    const video = rules.videoExtensions.includes(extension)
    const limit = video ? rules.maxVideoBytes : rules.maxFileBytes

    if (!name || !(data instanceof Uint8Array) || data.byteLength === 0) return 'A file was empty'
    if (!mimeType) return `${name} cannot be attached — use ${rules.labels.join(', ')}`
    if (data.byteLength > limit) return `${name} is over ${mb(limit)}`

    files.push({ name, mimeType, data, video })
  }

  if (files.filter((file) => file.video).length > 1) return 'Attach one video per comment'

  return files
}

export const openTicketThread = async (payload: unknown): Promise<Result<TicketThread>> => {
  const target = targetOf(payload)

  if (typeof target === 'string') return fail('VALIDATION_ERROR', target)

  const provider = ticketThreadProvider(target.platform)

  if (!provider) return fail('VALIDATION_ERROR', `${target.platform} tickets cannot be opened here`)

  return provider.open({ username: target.username, ticket: target.ticket })
}

export const replyToTicketThread = async (payload: unknown): Promise<Result<TicketThread>> => {
  const target = targetOf(payload)

  if (typeof target === 'string') return fail('VALIDATION_ERROR', target)

  const rules = ticketReplyRules(target.platform)

  if (!rules) return fail('VALIDATION_ERROR', `${target.platform} tickets cannot be replied to here`)

  const rawText = field(payload, 'text')
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  const files = filesOf(field(payload, 'files'), rules)

  if (typeof files === 'string') return fail('VALIDATION_ERROR', files)
  // A comment, files, or both — never neither.
  if (!text && files.length === 0) return fail('VALIDATION_ERROR', 'Write a comment or attach a file first')
  if (text.length > rules.maxChars) {
    return fail('VALIDATION_ERROR', `Keep the comment under ${rules.maxChars} characters`)
  }

  const provider = ticketThreadProvider(target.platform)

  if (!provider) return fail('VALIDATION_ERROR', `${target.platform} tickets cannot be replied to here`)

  return provider.reply({ username: target.username, ticket: target.ticket, text, files })
}
