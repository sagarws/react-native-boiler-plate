import type { SessionState } from './auth'

/**
 * The VMS feed session, inside the CMS (VMS_MERGE_PLAN.md).
 *
 * Argos Watch signed in AS a feed. Here the CMS login is the only login: the
 * admin picks a feed, and the main process takes that feed's session from
 * `POST /api/auth/feed-token`. Everything downstream (recorder, uploads,
 * queue) reads the same `SessionState` Argos Watch's renderer read from
 * `auth:session` — so its screens port without changing what they consume.
 */

/** One entry in the header's feed picker. Never carries credentials. */
export interface VmsFeedOption {
  id: string
  name: string
  /** A disabled feed is listed (so the operator sees it exists) but cannot be chosen. */
  disabled: boolean
}

/** `vms:select-feed` payload. */
export interface SelectFeedInput {
  feedId: string
  /**
   * The operator confirmed taking a feed that is signed in on another desk.
   * Without it, such a feed answers `{ alreadyLoggedIn: true }` and nothing
   * changes — the same takeover warning Argos Watch showed at its login.
   */
  force?: boolean
}

/** `vms:select-feed` result. */
export type SelectFeedResult =
  | { alreadyLoggedIn: false; session: SessionState }
  | { alreadyLoggedIn: true; feedName: string }

/**
 * Argos Watch channel → merged channel. The payload and result shapes are
 * Argos Watch's own, unchanged; only the names moved under `vms:`.
 *
 *   auth:session                  → vms:feed-session       (SessionState)
 *   auth:logout                   → vms:release-feed
 *   system:disk-info              → vms:disk-info
 *   system:ist-date               → vms:ist-date
 *   system:camera-date-permission → vms:camera-date-permission
 *   system:sidecar-port           → vms:sidecar-port
 *   system:probe-api / ping-api   → vms:probe-api
 *   system:stream-diagnostics     → vms:stream-diagnostics
 *   system:media-permissions(-request), media-privacy-settings → vms:media-permissions(-request), vms:media-privacy-settings
 *   queue:*                       → vms:queue-*            (counts, list-failed, list-pending, retry, delete-failed)
 *   order:check-exists / product-details → vms:order-check-exists / vms:order-product-details
 *   usage:fetch                   → vms:usage
 *   queue:counts-changed (event)  → vms:queue-counts-changed
 *
 * Dropped with the feed login: auth:login, auth:check-already-login,
 * auth:credentials-* (the CMS login and `selectFeed` replace them), and
 * Argos Watch's own update:* / preferences:* (the CMS's serve both modes).
 */
