import { fail, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { logger } from './logger'

/**
 * Renews a marketplace session the way Trackvid-Monitor's "Renew" button does.
 *
 * `POST /cms/renew-session` dispatches to the platform's own
 * `login<Platform>Api` through @trackvid/automation-core — the same functions
 * that run mid-batch, carrying years of accumulated portal quirks: the
 * marketing landing page, whichever launcher hides the form, the SSO redirect
 * chain, host-scoped cookies, OTP handling. It also writes the session in the
 * exact shape each platform's ingest expects.
 *
 * Reimplementing that per platform against the live DOM was the wrong instinct.
 * A portal redesign then has to be fixed twice, and the desktop copy is the one
 * nobody notices is broken until an operator cannot sign in.
 *
 * This blocks for the length of a real browser login — 30-60s on the happy path
 * and longer when a portal makes it retry.
 */

/**
 * The shared client defaults to 20s, which is shorter than these logins take:
 * the request would abort while the server was still driving a browser that was
 * about to succeed, and the operator would see a failure for a session that
 * then quietly appeared. Trackvid-Monitor's equivalent proxy allows 180s
 * against the backend's own 150s ceiling; match it.
 */
const RENEW_TIMEOUT_MS = 180_000

export interface RenewResult {
  platform: string
  username: string
  cookieNames?: string[]
  message?: string
}

export const renewSessionOnServer = async (
  platform: string,
  credentialId: string
): Promise<Result<RenewResult>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first')
  if (!credentialId) {
    return fail('VALIDATION_ERROR', 'This credential has no id, so it cannot be renewed')
  }

  logger.info(`Renewing ${platform} via the automation server`)

  return apiRequest<RenewResult>('/cms/renew-session', {
    method: 'POST',
    token,
    body: { platform, credentialId },
    timeoutMs: RENEW_TIMEOUT_MS
  })
}
