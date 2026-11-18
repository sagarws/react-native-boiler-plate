import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { credentialFor, credentialsFor } from './company.service'
import { autoLoginEnabled } from './automationRouting.service'
import { getPreferences } from './preferences.service'

/**
 * One marketplace password, for a scripted sign-in.
 *
 * Read from the local company document, which already holds it — the app keeps
 * an encrypted copy of the whole record, so a per-credential round trip buys
 * nothing but a dependency on the network at the moment a sign-in starts.
 *
 * The password is never cached separately, never written to disk by this
 * service and never logged; it goes straight from the document into the login
 * window. The one way it reaches the renderer is `revealCredentialPassword`,
 * below, and only on a machine that has switched Visible Login info on.
 *
 * THE AUTO-LOGIN GATE IS ENFORCED HERE TOO.
 *
 * `/cms/credential-secret` refuses when `settings.isAutoLoginOnActiveSession`
 * is off for the platform, so that switch in Monitor genuinely stops the
 * password being reachable rather than just changing what a button does.
 * Reading locally would have quietly bypassed it, so the same check runs first
 * — against the same setting, out of the same document.
 */

export interface CredentialSecret {
  platform: string
  username: string
  password: string
  accountType?: string
  vendorCode?: string
}

/**
 * `NO_PASSWORD_STORED` and a 403 are both ordinary answers, not faults: some
 * credentials are session-only, and a company can turn auto-login off. Both
 * come back as a failed Result whose message is what the operator should read
 * before signing in by hand.
 */
export const credentialSecret = async (
  platform: string,
  username: string
): Promise<Result<CredentialSecret>> => {
  // The company's own policy, checked before the password is read rather than
  // after — mirroring what the backend endpoint does.
  if (!(await autoLoginEnabled(platform))) {
    return fail(
      'VALIDATION_ERROR',
      `Auto-login is turned off for ${platform}. Sign in manually, or enable it in Monitor.`
    )
  }

  const local = await credentialFor(platform, username)

  if (local?.password) {
    return ok({
      platform,
      username: local.username,
      password: local.password,
      accountType: local.accountType,
      vendorCode: local.vendorCode
    })
  }

  // No local copy yet — a first run before the document has been fetched, or a
  // machine with no keychain to hold it. Ask the backend directly.
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first')

  const response = await apiRequest<CredentialSecret>('/cms/credential-secret', {
    method: 'POST',
    token,
    body: { platform, username }
  })

  if (!response.success) return response
  if (!response.data?.password) {
    return fail('NOT_FOUND', `No password is stored for ${username}`)
  }

  return ok(response.data)
}

/**
 * One login's password, for the Login page to show under its username.
 *
 * ONE GATE: Settings → Common settings → Visible Login info, read on every
 * call, so switching it off stops the next password going out rather than the
 * next launch's. The auto-login policy is deliberately NOT applied — it decides
 * whether a password is TYPED for the operator, and a manual platform is
 * exactly where the operator needs to read it.
 *
 * Read from the local copy INCLUDING logins the marketplace refused:
 * `credentialFor` leaves those out because nothing should sign in with them,
 * but a refused login is the row someone is fixing, so its password is the one
 * most worth seeing. The server is asked only when there is no local copy.
 *
 * Only the password is returned; the renderer already has everything else.
 */
export const revealCredentialPassword = async (
  payload: unknown
): Promise<Result<{ password: string }>> => {
  if (!getPreferences().showLoginInfo) {
    return fail('VALIDATION_ERROR', 'Turn on Visible Login info in Settings to see passwords.')
  }

  const input = (payload ?? {}) as { platform?: unknown; username?: unknown }
  const platform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : ''
  const username = typeof input.username === 'string' ? input.username.trim() : ''

  if (!platform || !username) {
    return fail('VALIDATION_ERROR', 'Choose the account to show the password for')
  }

  const wanted = username.toLowerCase()
  const local = (await credentialsFor(platform, { includeRefused: true })).find(
    c => c.username.trim().toLowerCase() === wanted
  )

  if (local?.password) return ok({ password: local.password })

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first')

  const response = await apiRequest<CredentialSecret>('/cms/credential-secret', {
    method: 'POST',
    token,
    body: { platform, username }
  })

  if (!response.success) return response
  if (!response.data?.password) return fail('NOT_FOUND', 'No password is saved for this account')

  return ok({ password: response.data.password })
}
