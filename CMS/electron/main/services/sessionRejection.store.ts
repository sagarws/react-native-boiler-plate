import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { platformKey } from '@shared/utils/platformKey'
import { logger } from './logger'
import { broadcast } from '../ipc/broadcast'
import { PLATFORM_SESSION_EVENTS } from '@shared/constants/channels'

/**
 * Sessions the marketplace itself has refused, remembered on this machine.
 *
 * THE BUG THIS EXISTS TO FIX. Two parts of this app answered "is this session
 * usable" and answered differently, because they were asking different
 * questions:
 *
 *   the Sessions page, the banner and the Session update card compared
 *   `expiresAt` to the clock — a GUESS made when the session was captured;
 *
 *   a claim asked the marketplace, through `reusableSession`.
 *
 * So a Snapdeal jar well inside its window read "Saved" everywhere an operator
 * could see it, while Snapdeal answered the probe with a rejection — and the
 * night's Auto claim passed its claims over for "no session" under a Session
 * update card that had just reported nothing to do. The operator's reasonable
 * conclusion was that the skip was wrong. It was not: the card was.
 *
 * The probe already knew. It simply threw the answer away, so the only place
 * the truth ever appeared was a log line. This keeps it: a `dead` verdict is
 * written here, `healthOf` reads it back as the `rejected` state, and every
 * screen and every task then says the same thing about that account.
 *
 * ONLY AN EXPLICIT REJECTION IS RECORDED. `unverifiable` and `probe-failed`
 * mean the probe could not tell — AJIO is permanently in the first, a flaky
 * network puts anything in the second — and writing those here would paint the
 * Sessions page red over a question nobody ever answered.
 *
 * CLEARED WHEN A SESSION IS CAPTURED, in `rememberCompanySession`, which is the
 * one funnel every capture path goes through. A rejection that outlived the
 * session it was about would be a permanently red account that re-capturing
 * could not fix — the same class of bug in the other direction.
 */

/**
 * A write here CHANGES WHAT EVERY SCREEN SHOULD SAY, so it says so.
 *
 * THE BUG THIS FIXES, which is the other half of the one above. The verdict was
 * being recorded correctly and nothing told the app: the Login page reads
 * session health when it mounts and when a capture lands, so an account the
 * marketplace refused during a claim run kept reading "Saved" there — while
 * Settings → Login update, read a moment later, said "Rejected". Two screens,
 * one source, two answers, and the one an operator trusts is whichever they
 * happened to open last.
 *
 * DEBOUNCED, because a sweep rejects several accounts in a row and each screen
 * answers this by re-reading the company's credentials over HTTP. One burst of
 * verdicts is one re-read, which is what the operator experiences anyway.
 *
 * Fired from the STORE rather than from each caller: there are five of them
 * across claims, refills, captures and the nightly probe, and a verdict that
 * reaches disk but not the screen is exactly the bug being fixed.
 */
const ANNOUNCE_AFTER_MS = 750

let announcement: NodeJS.Timeout | null = null

const announceChange = (): void => {
  if (announcement) clearTimeout(announcement)

  announcement = setTimeout(() => {
    announcement = null

    try {
      broadcast(PLATFORM_SESSION_EVENTS.changed, { reason: 'session-rejection' })
    } catch (error) {
      // A broadcast that cannot be sent — no window yet, during startup — must
      // not fail the write that triggered it.
      logger.warn('[session-rejection] could not announce the change', error)
    }
  }, ANNOUNCE_AFTER_MS)

  // Node keeps the process alive for a pending timer; this one must never be
  // the reason the app does not quit.
  announcement.unref?.()
}

interface StoredRejection {
  /** `<platformKey>:<lowercased username>` — the record's id. */
  key: string
  /** Canonical platform key, for reading back without re-deriving it. */
  platform: string
  username: string
  /** When the marketplace refused it, ISO. */
  at: string
  /** What the probe said, for the Sessions page to show. */
  detail: string
}

let collection: JsonCollection<StoredRejection> | null = null

export const initialiseSessionRejections = (): void => {
  collection = new JsonCollection<StoredRejection>({
    name: 'session-rejections',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<StoredRejection> | null => collection

const keyOf = (platform: string, username: string): string =>
  `${platformKey(platform)}:${username.trim().toLowerCase()}`

const read = async (): Promise<StoredRejection[]> =>
  (await store()
    ?.read()
    .catch(() => [] as StoredRejection[])) ?? []

/**
 * The marketplace refused this account's session.
 *
 * Best effort, like everything else that records rather than decides: a claim
 * that ran correctly must not fail because a note about it could not be
 * written.
 */
export const rememberSessionRejected = async (
  platform: string,
  username: string,
  detail: string
): Promise<void> => {
  if (!username.trim()) return

  const key = keyOf(platform, username)

  try {
    await store()?.mutate(records => ({
      records: [
        ...records.filter(record => record.key !== key),
        {
          key,
          platform: platformKey(platform),
          username: username.trim(),
          at: new Date().toISOString(),
          detail
        }
      ],
      result: undefined
    }))

    announceChange()
  } catch (error) {
    logger.warn(`[session-rejection] could not record ${key}`, error)
  }
}

/** A fresh session for this account — whatever was wrong with the old one is over. */
export const forgetSessionRejected = async (
  platform: string,
  username: string
): Promise<void> => {
  const key = keyOf(platform, username)

  try {
    const cleared = await store()?.mutate(records => {
      const kept = records.filter(record => record.key !== key)

      // Nothing to do, and a write nobody asked for: every capture calls this,
      // and most accounts have never been rejected.
      return kept.length === records.length
        ? { records, result: false }
        : { records: kept, result: true }
    })

    // Only when something actually went. An account turning from Rejected back
    // to Saved is exactly as worth announcing as the other direction — but
    // every capture calls this, and most have nothing to clear.
    if (cleared) announceChange()
  } catch (error) {
    logger.warn(`[session-rejection] could not clear ${key}`, error)
  }
}

/**
 * Every rejection held, by `<platformKey>:<username>`.
 *
 * Read once per session-health fetch rather than per credential — it is one
 * small file, and a read per account would be dozens of them for one screen.
 */
export const sessionRejections = async (): Promise<Map<string, StoredRejection>> =>
  new Map((await read()).map(record => [record.key, record]))

export const sessionRejectionKey = keyOf
