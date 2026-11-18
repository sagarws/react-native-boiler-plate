import { fail, type Result } from '@shared/types/result'
import type { BulkFieldOption, BulkUpdateResult } from '@shared/types/cmsList'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'

/**
 * Setting one field to one value across many claims.
 *
 * A THIN PASS-THROUGH, deliberately. Every rule that matters — which fields may
 * be written, what a value may hold, the company scope and the row cap — lives
 * on the server, because it is the only side a caller cannot go around. Copying
 * those checks here would give two answers to one question and let the weaker
 * one win whenever this app is older than the backend.
 *
 * What this adds is the token and a Result shape the renderer already speaks.
 */

export const bulkFieldOptions = async (): Promise<Result<BulkFieldOption[]>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to update claims')

  const response = await apiRequest<BulkFieldOption[]>('/cms/bulk-field-options', {
    method: 'GET',
    token
  })

  return response
}

export const bulkUpdateClaims = async (payload: unknown): Promise<Result<BulkUpdateResult>> => {
  const request = (payload ?? {}) as { cmsIds?: unknown; field?: unknown; value?: unknown }
  const cmsIds = Array.isArray(request.cmsIds) ? request.cmsIds.map(id => String(id)) : []
  const field = typeof request.field === 'string' ? request.field : ''
  // Not trimmed: a field that allows an empty value is cleared with one, and
  // the server decides which those are.
  const value = typeof request.value === 'string' ? request.value : ''

  if (cmsIds.length === 0) return fail('VALIDATION_ERROR', 'Select the claims to update first')
  if (!field) return fail('VALIDATION_ERROR', 'Pick the field to update')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to update claims')

  return apiRequest<BulkUpdateResult>('/cms/bulk-field-update', {
    method: 'POST',
    token,
    body: { cmsIds, field, value }
  })
}
