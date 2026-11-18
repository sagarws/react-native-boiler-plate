import { canEditTicket, MAX_TICKET_LENGTH } from '@shared/constants/claims'
import { fail, ok, type Result } from '@shared/types/result'
import type { TicketUpdateResult } from '@shared/types/cmsList'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'

/**
 * A ticket number typed in by hand — the same write the claim automation makes
 * after it files (`/cms/update-ticket`), minus `source: 'desktop'`: a person
 * typed this one, so the server records it as manual.
 *
 * THE STATUS GATE IS CHECKED HERE TOO, not only by hiding the button. The
 * endpoint moves the claim to In Review unconditionally, so a stale screen
 * offering the editor on a row that has since been Approved would demote it.
 * The status checked is the one the operator was looking at; the server holds
 * no rule of its own.
 */
export const updateClaimTicket = async (payload: unknown): Promise<Result<TicketUpdateResult>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const cmsId = typeof input.cmsId === 'string' ? input.cmsId.trim() : ''
  const ticket = typeof input.ticket === 'string' ? input.ticket.trim() : ''
  const status = typeof input.status === 'string' ? input.status : ''

  if (!cmsId) return fail('VALIDATION_ERROR', 'Say which claim the ticket is for.')
  if (!ticket) return fail('VALIDATION_ERROR', 'Enter the ticket number.')
  if (ticket.length > MAX_TICKET_LENGTH) {
    return fail('VALIDATION_ERROR', `A ticket number is at most ${MAX_TICKET_LENGTH} characters.`)
  }
  if (!canEditTicket(status)) {
    return fail(
      'VALIDATION_ERROR',
      `A ticket can only be added while the claim is Pending, Failed to Proceed or In Review — this one is ${status || 'unknown'}.`
    )
  }

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to update claims')

  const response = await apiRequest<unknown>('/cms/update-ticket', {
    method: 'PUT',
    token,
    body: { _id: cmsId, ticket }
  })

  return response.success ? ok({ cmsId, ticket, status: 'In Review' }) : response
}
