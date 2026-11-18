import { app } from 'electron'
import type { Result } from '@shared/types/result'
import { fail, ok } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { clearRoutingCache, routing } from './automationRouting.service'
import { logger } from './logger'

/**
 * The responsible-use notice, shown once and then never again.
 *
 * ONCE PER COMPANY, not per machine. It is an agreement the business makes
 * about how it uses the software; asking every operator to accept the same
 * notice on every laptop turns a considered answer into a dialog people click
 * through without reading, which is the opposite of the point.
 *
 * FAILS CLOSED, and this is the one place in the app where that costs
 * something: if the answer cannot be read, the notice is shown. An operator who
 * is offline sees it again and accepts again, which is a small annoyance —
 * where the other way round is an agreement nobody made being assumed because
 * a request timed out.
 *
 * DECLINING IS RECORDED TOO. "Declined" and "never asked" look identical if
 * only a yes is stored, and the difference matters: one is a company that read
 * the notice and closed the app.
 */

export interface TermsStatus {
  /** True only on an explicit yes on record. Anything else means ask. */
  agreed: boolean
}

export const termsStatus = async (): Promise<Result<TermsStatus>> => {
  if (!getAccessToken()) return fail('VALIDATION_ERROR', 'Sign in first')

  const current = await routing()

  // A token the backend refuses is not "unreadable" — no answer will ever be
  // readable or writable with it, so the notice would sit there forever, and
  // reopening the app restores the same dead token. Reported as the failure it
  // is, so the gate can send the operator back to sign in.
  if (!current.success && current.error.sessionEnded) return current

  // Unreadable is not agreed — see the header.
  if (!current.success) return ok({ agreed: false })

  return ok({ agreed: current.data.cmsTermsAgreed === true })
}

const record = async (agreed: boolean): Promise<Result<TermsStatus>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in first')

  const response = await apiRequest<{ cmsTermsAgreed?: boolean }>('/cms/terms-agreement', {
    token,
    method: 'PUT',
    body: { agreed }
  })

  if (!response.success) return response

  // The cached routing still carries the old answer, and the next read would
  // show the notice to somebody who has just accepted it.
  clearRoutingCache()
  logger.info(`Responsible-use notice ${agreed ? 'accepted' : 'declined'}`)

  return ok({ agreed })
}

/**
 * Accepted. The failure is REPORTED rather than swallowed: letting someone in
 * on an agreement that was never written down means they are asked again
 * tomorrow with no explanation, and the dialog is the only place that can say
 * "that did not save".
 */
export const acceptTerms = async (): Promise<Result<TermsStatus>> => record(true)

/**
 * Declined — recorded, then the app closes, because there is nothing to use it
 * for without the agreement.
 *
 * The write is awaited but not insisted on: someone who has decided to leave
 * should not be held at a dialog by a failing network, so a failed write still
 * closes the app. They are simply asked again next time, which is correct.
 */
export const declineTerms = async (): Promise<Result<TermsStatus>> => {
  const written = await record(false)

  if (!written.success) {
    logger.warn(`Could not record the declined agreement: ${written.error.message}`)
  }

  app.quit()

  return ok({ agreed: false })
}
