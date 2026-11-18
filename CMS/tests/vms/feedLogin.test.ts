import { describe, expect, it } from 'vitest'
import { parseFeedLogin, readAlreadyLoggedIn, toFeedOptions } from '@main/vms/feedLogin.mapping'

/**
 * `POST /auth/feed-token` answers with the feed-login body, and the recorder
 * reads the SessionState Argos Watch built from it. These pin the port of
 * Argos' mapping and the station-lock (409) answer.
 */

const FEED_LOGIN_BODY = {
  accessToken: '  tok-123  ',
  user: {
    _id: 'u1',
    email: 'desk@acme.in',
    name: { firstName: 'Desk', lastName: 'One' },
    phone: { code: '+91', number: '99999', countryCode: 'IN' },
    feedId: 'f1',
    feed: {
      _id: 'f1',
      feedName: 'Packing 1',
      isDisable: false,
      cameraType: 'webcam',
      rtspURL: '',
      isAllowCameraDateChange: true
    },
    companyId: 'c1',
    company: {
      _id: 'c1',
      name: 'Acme',
      ecommercePlatform: [{ _id: 'p1', name: 'Meesho', isActive: true }],
      compressPercentage: 'Medium',
      returnConditionPopup: { isShow: true },
      settings: {
        multiStepRecording: {
          mode: true,
          totalFeed: 2,
          feedIds: [
            { feedId: 'f1', step: 1 },
            { _id: 'f2', step: 2 },
            { feedId: 'f3', step: 0 }
          ]
        },
        desktopAppResolution: { asPerCamera: false, resolution: ' 1920x1080 ' }
      }
    }
  }
}

describe('feed-login body → SessionState user (Argos mapping)', () => {
  it('maps the nested user exactly as Argos did', () => {
    const parsed = parseFeedLogin(FEED_LOGIN_BODY)
    expect(parsed?.token).toBe('tok-123')
    const user = parsed!.user
    expect(user.id).toBe('u1')
    expect(user.name).toEqual({ firstName: 'Desk', lastName: 'One', fullName: 'Desk One' })
    expect(user.displayName).toBe('Desk One')
    expect(user.feedId).toBe('f1')
    expect(user.feed.feedName).toBe('Packing 1')
    expect(user.feed.isAllowCameraDateChange).toBe(true)
    expect(user.feed).not.toHaveProperty('onvif_ip')
    expect(user.company.id).toBe('c1')
    expect(user.company.ecommercePlatform).toEqual([{ id: 'p1', name: 'Meesho', isActive: true }])
    expect(user.company.compressPercentage).toBe('medium')
    expect(user.company.returnConditionPopup).toEqual({ isShow: true, isRedirectOnBad: false })
    expect(user.company.multiStepRecording).toEqual({
      mode: true,
      totalFeed: 2,
      feedIds: [
        { feedId: 'f1', step: 1 },
        { feedId: 'f2', step: 2 }
      ]
    })
    expect(user.company.desktopAppResolution).toEqual({ asPerCamera: false, resolution: '1920x1080' })
  })

  it('defaults a partial payload instead of crashing', () => {
    const parsed = parseFeedLogin({ accessToken: 't', user: { email: 'x@y.z' } })
    expect(parsed?.user.displayName).toBe('x@y.z')
    expect(parsed?.user.company.compressPercentage).toBe('similar')
    expect(parsed?.user.company).not.toHaveProperty('multiStepRecording')
    expect(parsed?.user.company).not.toHaveProperty('desktopAppResolution')
    expect(parsed?.user.feed.feedName).toBe('')
  })

  it('refuses a body with no token or no user', () => {
    expect(parseFeedLogin({ user: FEED_LOGIN_BODY.user })).toBeNull()
    expect(parseFeedLogin({ accessToken: 't' })).toBeNull()
    expect(parseFeedLogin(null)).toBeNull()
  })
})

describe('station lock (409)', () => {
  it('reads alreadyLoggedIn + feedName from a 409', () => {
    expect(
      readAlreadyLoggedIn(409, { isSuccess: false, data: { feedName: 'Packing 1', alreadyLoggedIn: true } })
    ).toEqual({ feedName: 'Packing 1' })
  })

  it('ignores any other status or shape', () => {
    expect(readAlreadyLoggedIn(400, { data: { alreadyLoggedIn: true, feedName: 'x' } })).toBeNull()
    expect(readAlreadyLoggedIn(409, { data: null })).toBeNull()
    expect(readAlreadyLoggedIn(409, { data: { feedName: 'x' } })).toBeNull()
  })
})

describe('common-feed rows → picker options', () => {
  it('keeps id/name/disabled and drops deleted rows', () => {
    expect(
      toFeedOptions([
        { _id: 'a', feedName: 'A', isDisable: false, isDeleted: false },
        { _id: 'b', feedName: 'B', isDisable: true },
        { _id: 'c', feedName: 'C', isDeleted: true },
        { feedName: 'no id' }
      ])
    ).toEqual([
      { id: 'a', name: 'A', disabled: false },
      { id: 'b', name: 'B', disabled: true }
    ])
    expect(toFeedOptions(null)).toEqual([])
  })
})
