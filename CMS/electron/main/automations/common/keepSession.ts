import { logger } from '@main/services/logger'
import { publishSession } from '@main/services/platformSession.service'

/**
 * Keeps the session a master import just signed in with.
 *
 * Without this, reuse could never start: a run signed in, used the session and
 * dropped it, so the next run found nothing stored and signed in again — for
 * as many runs as you cared to watch. Capturing a session by hand was the only
 * way one ever reached the company document.
 *
 * The session goes to the backend (the system of record) and into the local
 * company copy, exactly as a hand-captured one does, tagged `cms-desktop` so a
 * platform that binds a session to the machine that minted it — Myntra — knows
 * this one belongs here.
 *
 * ALWAYS best-effort. A session that could not be saved costs the next run a
 * login; failing the import over it would cost the whole report.
 */

/** What the ingest wants. A login's jar is either shape depending on platform. */
interface Cookie {
  name: string
  value: string
  domain: string
}

/**
 * Normalises a login's jar to the cookie list `publishSession` reshapes.
 *
 * `domain` is empty for a name-value jar because the platform never recorded
 * one — `shapeJar` folds those back into a map for the platforms that want a
 * map, and the cookie-array platforms (AJIO) harvest a real domain instead of
 * coming through here.
 */
const asCookies = (jar: unknown): Cookie[] => {
  if (Array.isArray(jar)) return jar as Cookie[]
  if (!jar || typeof jar !== 'object') return []

  return Object.entries(jar as Record<string, unknown>).map(([name, value]) => ({
    name,
    value: String(value),
    domain: ''
  }))
}

export const keepSession = async (
  platform: string,
  username: string,
  jar: unknown,
  extras: Record<string, unknown> = {},
  onProgress?: (message: string) => void
): Promise<void> => {
  try {
    const cookies = asCookies(jar)

    // Not a session. The ingest would reject it, and reporting that as a
    // failure would be noise on a run that is otherwise fine.
    if (cookies.length === 0) return

    const saved = await publishSession(platform, username, cookies, extras)

    if (saved.success) {
      onProgress?.(`Saved the ${platform} login for the next run`)
      logger.info(`[${platform}] saved the session for ${username} (${cookies.length} cookies)`)
    } else {
      logger.warn(`[${platform}] could not save the session for ${username}: ${saved.error.message}`)
    }
  } catch (error) {
    logger.warn(
      `[${platform}] could not save the session for ${username}: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
}
