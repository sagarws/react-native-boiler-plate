import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'

/**
 * Re-queues one AJIO claim's Drive conversion — the copy of its CCTV video and
 * screenshots from S3 to Google Drive that AJIO's claim attaches.
 *
 * The same call the admin panel's retry icon makes (`/cms/:id/retry-drive`).
 * The server holds every rule: AJIO only, this company's claim only, and only
 * while Drive Status is "failed". It flips the claim to "pending" before it
 * answers, which is what the screen shows next.
 */
export const retryDriveConversion = async (payload: unknown): Promise<Result<{ cmsId: string }>> => {
  const input = (payload ?? {}) as { cmsId?: unknown }
  const cmsId = typeof input.cmsId === 'string' ? input.cmsId.trim() : ''

  if (!cmsId) return fail('VALIDATION_ERROR', 'Say which claim to retry.')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to retry the Drive upload')

  const response = await apiRequest<unknown>(`/cms/${encodeURIComponent(cmsId)}/retry-drive`, {
    method: 'POST',
    token,
    body: {}
  })

  return response.success ? ok({ cmsId }) : response
}
