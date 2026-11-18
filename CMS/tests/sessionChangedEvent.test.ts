import { describe, expect, it } from 'vitest'
import {
  EVENT_CHANNELS,
  IPC_CHANNELS,
  PLATFORM_SESSION_EVENTS,
  isAllowedChannel,
  isAllowedEventChannel
} from '@shared/constants/channels'

/**
 * "A session changed" has to cross the process boundary.
 *
 * The renderer's own pub/sub only ever heard about captures the renderer
 * started. A scheduled Session update runs in the MAIN process, so it would
 * re-capture every session the red banner named and the banner would keep
 * naming them — until somebody pressed Refresh, which is an operator doing the
 * notification by hand.
 *
 * The relay is one line in sessionEvents and one broadcast in
 * platformSession.service, and both are useless if the channel is not on the
 * event allow-list: the preload drops an unknown channel silently and returns a
 * no-op unsubscribe, so the failure would look exactly like the bug it fixes.
 */

describe('platform-session:changed', () => {
  it('is allowed as a main → renderer push', () => {
    expect(EVENT_CHANNELS).toContain(PLATFORM_SESSION_EVENTS.changed)
    expect(isAllowedEventChannel(PLATFORM_SESSION_EVENTS.changed)).toBe(true)
  })

  it('is NOT callable from the renderer', () => {
    // A push channel mistaken for a handler is how a renderer ends up able to
    // tell the main process that a session changed.
    expect(IPC_CHANNELS).not.toContain(PLATFORM_SESSION_EVENTS.changed)
    expect(isAllowedChannel(PLATFORM_SESSION_EVENTS.changed)).toBe(false)
  })

  it('does not collide with an invoke channel name', () => {
    for (const channel of EVENT_CHANNELS) expect(IPC_CHANNELS).not.toContain(channel)
  })
})
