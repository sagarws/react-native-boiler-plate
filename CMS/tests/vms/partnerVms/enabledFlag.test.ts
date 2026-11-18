import { describe, expect, it } from 'vitest'
import { parseFeedLogin, toAuthUser } from '@main/vms/feedLogin.mapping'

/** The mirror is switched on by one boolean on the feed-login / feed-token user. */
describe('partnerVmsEnabled on the feed session', () => {
  it('is carried from the feed-login body', () => {
    const parsed = parseFeedLogin({ accessToken: 't', user: { _id: 'u', feedId: 'f', partnerVmsEnabled: true } })
    expect(parsed?.user.partnerVmsEnabled).toBe(true)
  })

  it('is off unless the server says exactly true', () => {
    expect(toAuthUser({ _id: 'u' }).partnerVmsEnabled).toBe(false)
    expect(toAuthUser({ _id: 'u', partnerVmsEnabled: 'true' as unknown as boolean }).partnerVmsEnabled).toBe(false)
  })
})
