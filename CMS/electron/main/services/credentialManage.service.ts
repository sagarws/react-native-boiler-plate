import { PLATFORMS } from '@trackvid/automation-core/common/platforms'
import { PLATFORM_SESSION_EVENTS } from '@shared/constants/channels'
import { fail, ok, type Result } from '@shared/types/result'
import { broadcast } from '../ipc/broadcast'
import { forgetCompanySession, refreshCompany } from './company.service'
import { apiRequest } from './httpClient'
import { forgetSession } from './localSession.store'
import { logger } from './logger'
import { signInAndRecord } from './credentialVerify.service'
import { forgetSessionRejected } from './sessionRejection.store'
import { getAccessToken } from './session.store'

/**
 * Adding and removing a marketplace login from the Login page — the desktop's
 * version of the admin panel's account list.
 *
 * ADD = SAVE, THEN PROVE. The login is stored UNVERIFIED (/cms/credential-add),
 * then signed in with — the same `captureSession` call, credential id included,
 * that the Re-capture button makes, so it honours the platform's Auto/Manual
 * sign-in and leaves a session behind when it works — and marked verified or
 * unverified from that outcome (`signInAndRecord`). A password that does not
 * work is saved but kept out of every automation, which is what the admin
 * panel does with a failed check too.
 *
 * WHY NOT THE ADMIN PANEL'S ENDPOINT: /master-setting/ecom-logininfo-insup
 * rebuilds the platform's whole login list, so every other login on it would
 * lose its id and its session. These two touch one login each.
 */

export interface AddedCredential {
  platform: string
  username: string
  /** The sign-in worked and the login is marked verified. */
  verified: boolean
  /** Why it is not verified, in the marketplace's words — null when it is. */
  reason: string | null
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const knownPlatform = (value: unknown): string => {
  const key = text(value).toLowerCase()

  return PLATFORMS.some(entry => entry.key === key) ? key : ''
}

/** The company copy, the Login page and every gate read the list from it. */
const settle = async (platform: string, username: string): Promise<void> => {
  await refreshCompany().catch(error => logger.warn('[credentials] could not refresh the company copy', error))
  broadcast(PLATFORM_SESSION_EVENTS.changed, { platform, username })
}

export const addCredential = async (payload: unknown): Promise<Result<AddedCredential>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const platform = knownPlatform(input.platform)
  const username = text(input.username)
  const password = typeof input.password === 'string' ? input.password : ''

  if (!platform) return fail('VALIDATION_ERROR', 'Choose a marketplace.')
  if (!username || !password) return fail('VALIDATION_ERROR', 'Enter the username and the password.')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first.')

  const extras: Record<string, string> = {}

  // `cloudflareEmail`: Tata CliQ's Cloudflare Access inbox. The server keeps it
  // only when it looks like an address.
  for (const key of ['accountType', 'phoneNumber', 'vendorCode', 'cloudflareEmail']) {
    if (text(input[key])) extras[key] = text(input[key])
  }

  const added = await apiRequest('/cms/credential-add', {
    method: 'POST',
    token,
    body: { platform, username, password, ...extras }
  })

  if (!added.success) return fail(added.error.code, added.error.message)

  logger.info(`[credentials] ${platform}/${username}: added — signing in to verify it`)

  // The same capture Re-capture runs, and the flag written from its outcome.
  const verdict = await signInAndRecord(platform, username)

  await settle(platform, username)

  logger.info(
    verdict.verified
      ? `[credentials] ${platform}/${username}: added and verified`
      : `[credentials] ${platform}/${username}: added but not verified — ${verdict.reason}`
  )

  return ok({ platform, username, ...verdict })
}

export const removeCredential = async (payload: unknown): Promise<Result<{ platform: string; username: string }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const platform = knownPlatform(input.platform)
  const username = text(input.username)

  if (!platform || !username) return fail('VALIDATION_ERROR', 'Say which login to remove.')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first.')

  const removed = await apiRequest('/cms/credential-remove', {
    method: 'POST',
    token,
    body: { platform, username }
  })

  if (!removed.success) return fail(removed.error.code, removed.error.message)

  // The session went with the credential on the server; this machine's copies
  // and any refusal stamp would otherwise outlive it.
  await forgetSession(platform, username)
  await forgetCompanySession(platform, username)
  await forgetSessionRejected(platform, username)
  await settle(platform, username)

  logger.info(`[credentials] ${platform}/${username}: removed`)

  return ok({ platform, username })
}
