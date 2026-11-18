import { platformKey } from '@shared/utils/platformKey'
import { autoCaptureOnRunningProcess } from '../config/sessionCapturePolicy'
import { logger } from './logger'

/**
 * May the work running right now sign in to a marketplace?
 *
 * WHY THE REFILL SAYS NO. Refill Data asks marketplaces for the blanks on a
 * claim. When it met a dead session it signed in by script — one browser, one
 * real login, per account — in the middle of a sweep of hundreds of rows. That
 * is the Login update's job, it runs first for exactly that reason, and a
 * refill doing it again means a run that was meant to be a few API calls turns
 * into a night of browser sessions. A session that is dead when the refill
 * reaches it should fail the row and leave the sign-in to the task that owns it.
 *
 * AMBIENT, NOT A PARAMETER, and that is the point. Nine platform resolvers call
 * `claimCredentials`, and threading a flag through all nine means nine chances
 * to miss one — and the one missed is a platform that quietly still opens a
 * browser, which is the bug this exists to prevent. One setter, one reader.
 *
 * SAFE BECAUSE AUTOMATIONS ARE SERIALISED. `withAutomationLock` runs one
 * automation at a time, so there is no second piece of work whose sign-in this
 * could suppress by accident. The `finally` restores the previous value rather
 * than clearing it, so nesting cannot leave the flag down.
 */

/**
 * REFUSED BY DEFAULT — the operator's rule: no automation signs in on its own.
 *
 * A master import that found no reusable Myntra session opened Chrome and
 * signed in by script in the middle of the night, with no Login update
 * running, and nothing on screen said which process it was. Signing in is the
 * SESSION LOGIN's job — the Login update task, Re-capture, Verify — and those
 * go through `captureSession`, which does not consult this flag. Everything
 * else reuses the stored session or fails saying so, and the Login update
 * repairs it.
 *
 * `withSignIn` is the explicit opt-in for anything that must sign in; nothing
 * outside session capture should need it.
 */
let allowed = false

/**
 * Platforms the current work may sign in to, and no others.
 *
 * FILING A CLAIM IS THE CASE. A claim that meets an expired session used to
 * fail — "the saved login is expired and this run does not sign in — HTTP
 * 401" — and wait for the Login update. Where the company has set
 * `isAutoLoginOnActiveSession` for that platform, signing in by script is
 * exactly what it asked for, so the claim run re-captures the session itself
 * and files. A platform with auto-login OFF stays refused: there a person
 * signs in, and a claim run is not going to open a window at 04:00.
 *
 * A SET, resolved before the work starts, because the gates that read it are
 * synchronous — AJIO's and Tata CliQ's in-page sign-in among them.
 */
let allowedPlatforms: ReadonlySet<string> = new Set()

/**
 * The company's `settings.isAutoLoginOnActiveSession`, as last read.
 *
 * Kept here, in step with automationRouting's read, because the gates that need
 * it are synchronous. Null until the first read: until then nothing is known to
 * be auto-login, and nothing signs in on its strength — the safe way to fall.
 */
let autoLoginSettings: Record<string, unknown> | null = null

/** Called whenever the routing settings are read. */
export const rememberAutoLoginSettings = (settings: Record<string, unknown> | null | undefined): void => {
  autoLoginSettings = settings && typeof settings === 'object' ? settings : {}
}

/**
 * Auto-login on for this platform, by the last read — unset counts as on, as
 * `autoLoginEnabled` reads it. False when nothing has been read yet.
 */
const autoLoginKnownOn = (platform: string): boolean =>
  autoLoginSettings !== null && autoLoginSettings[platformKey(platform)] !== false

/**
 * May the current work sign in — to `platform`, when one is named?
 *
 * False unless something has opted in: `withSignIn` for every platform,
 * `withSignInFor` for the named ones. Without a platform, only the first counts.
 *
 * AND, IN A BUILD WITH AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true, every
 * platform whose auto-login is on — in ANY running process, Refill and imports
 * included, `withoutSignIn` notwithstanding. That is the setting's whole
 * meaning: an expired login on such a platform is re-captured by script and the
 * work carries on, rather than stopping for somebody to do it by hand. A
 * platform with auto-login off is never covered: there a person signs in.
 */
export const signInAllowed = (platform?: string): boolean =>
  allowed ||
  (platform !== undefined &&
    (allowedPlatforms.has(platformKey(platform)) ||
      (autoCaptureOnRunningProcess() && autoLoginKnownOn(platform))))

/** Run `work` with scripted sign-in permitted. */
export const withSignIn = async <T>(work: () => Promise<T>): Promise<T> => {
  const previous = allowed

  allowed = true

  try {
    return await work()
  } finally {
    allowed = previous
  }
}

/**
 * Run `work` with scripted sign-in permitted for `platforms` only — the claim
 * run's platforms whose auto-login is on. Restored afterwards, so nesting
 * cannot leave a platform permitted.
 */
export const withSignInFor = async <T>(platforms: Iterable<string>, work: () => Promise<T>): Promise<T> => {
  const previous = allowedPlatforms

  allowedPlatforms = new Set([...previous, ...[...platforms].map(platformKey)])

  try {
    return await work()
  } finally {
    allowedPlatforms = previous
  }
}

/**
 * Run `work` with scripted sign-in refused — for every platform, including any
 * an enclosing claim run permitted. Refill Data runs inside a claim batch and
 * must still never sign in.
 */
export const withoutSignIn = async <T>(work: () => Promise<T>): Promise<T> => {
  const previous = allowed
  const previousPlatforms = allowedPlatforms

  allowed = false
  allowedPlatforms = new Set()

  try {
    return await work()
  } finally {
    allowed = previous
    allowedPlatforms = previousPlatforms
  }
}

/**
 * The message a refused sign-in reports.
 *
 * NAMED, because two things key on the exact words: the operator reading a
 * failed row, and `marketplaceDidNotAnswer`, which must not charge the row a
 * refill attempt for a question the marketplace was never asked.
 */
export const SIGN_IN_REFUSED = 'the saved login is expired and this run does not sign in'

/**
 * The gate in front of a direct marketplace login: logs and throws when the
 * current work may not sign in. `detail` says why there was no session to reuse.
 */
export const refuseSignInUnlessAllowed = (platform: string, username: string, detail: string): void => {
  if (signInAllowed(platform)) return

  logSignInRefused(platform, username)

  throw new Error(`${SIGN_IN_REFUSED} — ${detail}. Re-capture it on the Login page, or let the Login update run`)
}

/** Say so once, where it happens, so a silent skip is never a silent skip. */
export const logSignInRefused = (platform: string, username: string): void => {
  logger.warn(
    `[sign-in-policy] ${platform}/${username}: ${SIGN_IN_REFUSED} — ` +
      'the Login update owns re-capturing it'
  )
}
