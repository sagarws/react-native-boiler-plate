import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { getPreferences, setDevMode } from './preferences.service'
import { logger } from './logger'

/**
 * Developer mode — the extra screens, behind a password.
 *
 * THE PASSWORD IS NEVER HELD HERE. It could have arrived with the company
 * document at sign-in and been compared locally, which would be one round trip
 * cheaper and would put the value inside a desktop build that anyone can open
 * devtools on. So what the operator typed goes to the server, and a yes or a no
 * comes back.
 *
 * What IS held here is the answer: a flag in this installation's preferences,
 * so the mode survives a restart. That is deliberate too — a mode that had to be
 * re-unlocked every launch would be turned on once and then worked around.
 *
 * It is not a security boundary and does not pretend to be one: every screen it
 * reveals shows data the operator's own account can already read. It exists so
 * they are not on by accident.
 */

interface VerifyResponse {
  ok: boolean
  configured: boolean
}

export const devModeState = (): Result<{ devMode: boolean }> =>
  ok({ devMode: getPreferences().devMode })

export const verifyDevMode = async (
  payload: unknown
): Promise<Result<{ devMode: boolean; configured: boolean }>> => {
  const typed = (payload as { password?: unknown })?.password
  const password = typeof typed === 'string' ? typed : ''

  if (!password) return fail('VALIDATION_ERROR', 'Enter the developer-mode password')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in before unlocking developer mode')

  const response = await apiRequest<VerifyResponse>('/cms/dev-mode/verify', {
    method: 'POST',
    token,
    // The only place this value exists in this process, and it is not stored,
    // logged or kept after the call.
    body: { password }
  })

  if (!response.success) return response

  if (!response.data.configured) {
    return fail(
      'VALIDATION_ERROR',
      'Developer mode is not configured for this installation. Ask an administrator to set it up.'
    )
  }

  if (!response.data.ok) {
    logger.warn('Developer mode refused — wrong password')

    return fail('VALIDATION_ERROR', 'That is not the developer-mode password.')
  }

  await setDevMode(true)

  return ok({ devMode: true, configured: true })
}

/** No password needed to leave: turning things off is never the risky direction. */
export const disableDevMode = async (): Promise<Result<{ devMode: boolean }>> => {
  await setDevMode(false)

  return ok({ devMode: false })
}
