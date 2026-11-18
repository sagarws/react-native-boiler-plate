import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { logger } from './logger'

/**
 * Tells TrackVid how many claims a finished pass got ACCEPTED, for the
 * NDR/DDR and Re-Open columns of the Accounts page (`POST /cms/claim-activity`).
 *
 * Neither flow has a CMS record behind it — an AJIO NDR/DDR claim is filed
 * straight from a sheet, a Myntra re-claim reopens a ticket that already
 * exists — so nothing else would ever count them.
 *
 * ONE CALL PER PASS, with the tickets the marketplace accepted in THAT pass.
 * The caller works out the number; a refused or failed ticket is never in it.
 *
 * NEVER THROWS, never fails the run: the claims are already filed when this
 * runs, and a count that did not reach the server is a smaller number on a
 * report, not a reason to tell the operator their run went wrong.
 */
export const reportClaimActivity = async (counts: {
  ndrDdrClaims?: number
  reOpenClaims?: number
}): Promise<void> => {
  const ndrDdrClaims = Math.max(0, Math.floor(counts.ndrDdrClaims ?? 0))
  const reOpenClaims = Math.max(0, Math.floor(counts.reOpenClaims ?? 0))

  if (ndrDdrClaims === 0 && reOpenClaims === 0) return

  const token = getAccessToken()

  if (!token) {
    logger.warn('[claim-activity] not signed in — counts not reported', { ndrDdrClaims, reOpenClaims })

    return
  }

  try {
    const response = await apiRequest('/cms/claim-activity', {
      method: 'POST',
      token,
      body: { ndrDdrClaims, reOpenClaims }
    })

    if (!response.success) {
      logger.warn(`[claim-activity] counts not recorded: ${response.error.message}`, { ndrDdrClaims, reOpenClaims })
    }
  } catch (error) {
    logger.warn('[claim-activity] counts not recorded', error)
  }
}
