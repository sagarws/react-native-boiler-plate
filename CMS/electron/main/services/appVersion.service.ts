import { app } from 'electron'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { clearRoutingCache, routing } from './automationRouting.service'
import { logger } from './logger'

/**
 * Tells the backend which build of this app the company is running.
 *
 * Support's first question about any desktop fault is "what version are you
 * on", and the answer used to be whatever the operator remembered — or a
 * screenshot of the sidebar, if someone thought to ask for one. The app knows
 * exactly, so it says so, once, at sign-in.
 *
 * REPORTED WHEN IT DIFFERS, not only when it is missing. "Missing" is the first
 * run; every run after an update is the case that actually matters, and a
 * version recorded once would then describe a build nobody is running. One
 * string comparison is cheaper than being wrong about it for months.
 *
 * NOTHING DEPENDS ON IT. It is a fact about the estate, not a switch: no flow
 * reads it, so a failure to report costs nothing and must never be allowed to
 * interrupt a sign-in. Hence fire-and-forget, with the error logged and
 * swallowed — an operator cannot act on "could not record the version", and
 * showing it would teach them to ignore the next message too.
 */

export const reportAppVersion = async (): Promise<void> => {
  const token = getAccessToken()

  if (!token) return

  const version = app.getVersion()

  if (!version) return

  // The routing read is the one the app already makes at sign-in, so asking it
  // for the recorded version costs no extra round trip — it is served from the
  // same cache the rest of the startup reads.
  const current = await routing()

  if (!current.success) {
    logger.warn('Could not read the recorded app version; not reporting this run')

    return
  }

  const recorded = typeof current.data.cmsAppVersion === 'string' ? current.data.cmsAppVersion : ''

  if (recorded === version) return

  const response = await apiRequest<{ cmsAppVersion?: string }>('/cms/app-version', {
    token,
    method: 'PUT',
    body: { cmsAppVersion: version }
  })

  if (!response.success) {
    logger.warn(`Could not record this app version (${version}): ${response.error.message}`)

    return
  }

  // The cached routing still carries the old version, and the next caller would
  // compare against it and report again.
  clearRoutingCache()
  logger.info(`Recorded this machine's app version with TrackVid: ${recorded || '(none)'} → ${version}`)
}
