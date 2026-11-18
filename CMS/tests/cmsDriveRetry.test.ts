import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Drive Status retry icon: one AJIO claim's failed Drive conversion, queued
 * again through the admin panel's own endpoint. The server holds the rules;
 * this only has to name the right claim, and refuse without one.
 */

const apiRequest = vi.hoisted(() => vi.fn())
const token = vi.hoisted((): { value: string | null } => ({ value: 'token' }))

vi.mock('@main/services/httpClient', () => ({ apiRequest }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => token.value }))

const { retryDriveConversion } = await import('@main/services/cmsDriveRetry.service')

describe('retryDriveConversion', () => {
  beforeEach(() => {
    token.value = 'token'
    apiRequest.mockReset().mockResolvedValue({ success: true, data: {} })
  })

  it('posts to the claim\'s own retry-drive endpoint', async () => {
    const result = await retryDriveConversion({ cmsId: ' 6ae31cec ' })

    expect(result).toEqual({ success: true, data: { cmsId: '6ae31cec' } })
    expect(apiRequest).toHaveBeenCalledWith('/cms/6ae31cec/retry-drive', {
      method: 'POST',
      token: 'token',
      body: {}
    })
  })

  it('refuses without a claim, and without a sign-in', async () => {
    for (const payload of [null, {}, { cmsId: '' }, { cmsId: 7 }]) {
      expect((await retryDriveConversion(payload)).success).toBe(false)
    }

    token.value = null
    expect((await retryDriveConversion({ cmsId: 'x' })).success).toBe(false)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("passes the server's refusal through, so the toast says why", async () => {
    const refused = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Drive retry is only available when Drive Status is Failed.' }
    }

    apiRequest.mockResolvedValue(refused)

    expect(await retryDriveConversion({ cmsId: 'x' })).toEqual(refused)
  })
})
