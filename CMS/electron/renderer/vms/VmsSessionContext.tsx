import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { Result } from '@shared/types/result'
import { SIGNED_OUT, type SessionState } from '@shared/vms/auth'
import type { SelectFeedResult, VmsFeedOption } from '@shared/vms/feeds'
import { useAuth } from '@renderer/hooks/useAuth'

import { vmsClient } from './services/vmsClient'
import { store } from './store/store'

/**
 * The feed the VMS records as, for every VMS screen.
 *
 * Argos Watch signed in AS a feed and read its session from `auth:session`.
 * Here the CMS login is the only login: the admin picks a feed in the header,
 * main takes that feed's session (`vms:select-feed` → POST /api/auth/feed-token)
 * and the renderer sees the same `SessionState` Argos Watch's screens read —
 * token never included. The recorder reads `session.user` exactly as Argos'
 * `useAuth().user`.
 *
 * ENABLED ONLY IN VMS MODE and only while the CMS is signed in: in CMS mode
 * nothing here calls main, so a CMS-only installation never starts the local
 * recorder server (`vms:sidecar-port` starts it lazily). Re-enabling re-reads
 * the session, which covers a feed released while the operator was in the CMS.
 *
 * THE RECORDER'S STATE BELONGS TO ONE FEED. When the held feed changes (or the
 * CMS signs out) the VMS store is reset — a half-typed AWB or a screenshot from
 * the previous feed must not be uploaded under the next one.
 */
export interface VmsSessionApi {
  /** The company's feeds for the picker. Disabled ones are listed, not choosable. */
  feeds: VmsFeedOption[]
  /** True until the first feed list arrives (or fails). */
  feedsLoading: boolean
  /** Why the feed list could not be read; null when it could. */
  feedsError: string | null
  /** The held feed's session (SIGNED_OUT when no feed is chosen). */
  session: SessionState
  /** A `selectFeed` call is in flight. */
  selecting: boolean
  /**
   * Take a feed. `{ alreadyLoggedIn: true }` means another desk holds it and
   * nothing changed — ask the operator, then call again with `force: true`.
   */
  selectFeed: (feedId: string, force?: boolean) => Promise<Result<SelectFeedResult>>
  /** Give the held feed back (feed-logout). */
  release: () => Promise<void>
  /** The local recorder server's port, once a feed is held; null otherwise. */
  sidecarPort: number | null
  refreshFeeds: () => Promise<void>
  refreshSidecarPort: () => Promise<void>
}

const NOT_READY: Result<SelectFeedResult> = {
  success: false,
  error: { code: 'INTERNAL_ERROR', message: 'The VMS is not open.' }
}

const VmsSessionContext = createContext<VmsSessionApi>({
  feeds: [],
  feedsLoading: false,
  feedsError: null,
  session: SIGNED_OUT,
  selecting: false,
  selectFeed: () => Promise.resolve(NOT_READY),
  release: () => Promise.resolve(),
  sidecarPort: null,
  refreshFeeds: () => Promise.resolve(),
  refreshSidecarPort: () => Promise.resolve()
})

/**
 * The feed the store's state belongs to. Module-level, like the store: the
 * provider re-mounts when the operator goes to the CMS and back, and coming
 * back to the SAME feed must keep the recorder's state.
 */
let storeFeedId: string | null = null

const feedIdOf = (session: SessionState): string | null =>
  session.authenticated && session.user ? session.user.feedId : null

/** How often a failed feed list is asked for again. */
const FEEDS_RETRY_MS = 15_000

export const VmsSessionProvider = ({ enabled, children }: { enabled: boolean; children: ReactNode }) => {
  const auth = useAuth()
  const active = enabled && auth.status === 'authenticated'

  const [feeds, setFeeds] = useState<VmsFeedOption[]>([])
  const [feedsLoading, setFeedsLoading] = useState(true)
  const [feedsError, setFeedsError] = useState<string | null>(null)
  const [session, setSessionState] = useState<SessionState>(SIGNED_OUT)
  const [selecting, setSelecting] = useState(false)
  const [sidecarPort, setSidecarPort] = useState<number | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    // Set back to true on every mount: React's StrictMode (development) mounts,
    // unmounts and remounts once, and a flag only ever cleared on unmount stayed
    // false after that — every result was then dropped and the feed list sat on
    // "Loading…" forever.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** Every session write goes through here, so the store reset cannot be missed. */
  const applySession = useCallback((next: SessionState): void => {
    const nextFeed = feedIdOf(next)
    if (nextFeed !== storeFeedId) {
      // Signed out of the feed, or onto a different one: a fresh recorder.
      // (null → a feed is a first pick, but the store may still hold the state
      // of a feed released earlier, so it is reset then too.)
      store.reset()
      storeFeedId = nextFeed
    }
    if (mountedRef.current) setSessionState(next)
  }, [])

  const refreshFeeds = useCallback(async (): Promise<void> => {
    const response = await vmsClient.feeds()
    if (!mountedRef.current) return
    if (response.success) {
      setFeeds(response.data)
      setFeedsError(null)
    } else {
      setFeedsError(response.error.message)
    }
    setFeedsLoading(false)
  }, [])

  // A failed feed list retries itself: a network drop of a few seconds should
  // clear on its own, not wait for someone to press Try again.
  useEffect(() => {
    if (!active || !feedsError) return
    const timer = setInterval(() => void refreshFeeds(), FEEDS_RETRY_MS)
    return () => clearInterval(timer)
  }, [active, feedsError, refreshFeeds])

  const refreshSidecarPort = useCallback(async (): Promise<void> => {
    const response = await vmsClient.sidecarPort()
    if (mountedRef.current && response.success) setSidecarPort(response.data)
  }, [])

  // Entering VMS mode: the feed list, and whatever session main still holds.
  useEffect(() => {
    if (!active) return
    let cancelled = false

    const unsubscribe = vmsClient.onFeedSessionChange((next) => {
      if (!cancelled) applySession(next)
    })

    // setState happens after the await inside refreshFeeds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshFeeds()
    void vmsClient.feedSession().then((response) => {
      if (!cancelled && response.success) applySession(response.data)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [active, applySession, refreshFeeds])

  // The CMS signed out: main has released the feed; drop the renderer's copy.
  useEffect(() => {
    if (auth.status === 'unauthenticated') applySession(SIGNED_OUT)
  }, [auth.status, applySession])

  // The recorder's local server, once there is a feed to record for.
  const heldFeedId = feedIdOf(session)
  useEffect(() => {
    if (!active || !heldFeedId) return
    void refreshSidecarPort()
  }, [active, heldFeedId, refreshSidecarPort])

  const selectFeed = useCallback(
    async (feedId: string, force = false): Promise<Result<SelectFeedResult>> => {
      setSelecting(true)
      try {
        const response = await vmsClient.selectFeed(force ? { feedId, force: true } : { feedId })
        if (response.success && !response.data.alreadyLoggedIn) applySession(response.data.session)
        return response
      } finally {
        if (mountedRef.current) setSelecting(false)
      }
    },
    [applySession]
  )

  const release = useCallback(async (): Promise<void> => {
    const response = await vmsClient.releaseFeed()
    if (response.success) applySession(SIGNED_OUT)
  }, [applySession])

  const value = useMemo<VmsSessionApi>(
    () => ({
      feeds,
      feedsLoading,
      feedsError,
      session,
      selecting,
      selectFeed,
      release,
      sidecarPort: heldFeedId ? sidecarPort : null,
      refreshFeeds,
      refreshSidecarPort
    }),
    [
      feeds,
      feedsLoading,
      feedsError,
      session,
      selecting,
      selectFeed,
      release,
      heldFeedId,
      sidecarPort,
      refreshFeeds,
      refreshSidecarPort
    ]
  )

  return <VmsSessionContext.Provider value={value}>{children}</VmsSessionContext.Provider>
}

/** The held feed's session and the picker's actions. Safe without a provider. */
export const useVmsSession = (): VmsSessionApi => useContext(VmsSessionContext)
