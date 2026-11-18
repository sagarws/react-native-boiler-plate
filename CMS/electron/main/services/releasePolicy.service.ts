import { env } from '../config/env'
import { logger } from './logger'

/**
 * Optional policy layer on top of electron-updater.
 *
 * electron-updater answers "is there a newer build?" from latest.yml. This feed
 * answers a different question: "is the build the user is on still allowed?" -
 * which is what lets a broken release be forced off every machine rather than
 * politely offered.
 *
 * Wire format (the /cms/version endpoint):
 *   { "success": true, "versionName": "1.0.0", "mandatory": false, ... }
 *
 * Everything here is best-effort. A dead feed must never stop an update or the
 * app from starting, so failure returns null and is logged, not surfaced.
 */
export interface ReleasePolicy {
  /** Builds older than this are considered out of date. */
  minimumVersion: string
  /** When true, a build below minimumVersion must not be used. */
  mandatory: boolean
  /**
   * Where to download the build by hand, when the app cannot fetch it itself.
   *
   * THE ESCAPE HATCH FROM A BLOCKING SCREEN. A mandatory policy on a machine
   * whose automatic update cannot run — an unpackaged build, a missing
   * latest.yml, a feed it cannot reach — leaves the operator with a screen they
   * cannot dismiss and no way to satisfy it. This is what they are given
   * instead of nothing.
   */
  downloadUrl: string | null
  /**
   * The release MANIFEST this build should update from — the `latest.yml`
   * written beside the installer.
   *
   * THE ONE THING A SHIPPED COPY CANNOT OTHERWISE BE TOLD. The feed is baked
   * into app-update.yml at package time and is permanent for every installed
   * copy: if the release ends up somewhere that host does not serve, the
   * automatic update cannot be pointed anywhere else. This is that pointer,
   * arriving over the policy feed which every machine still reads.
   *
   * Null leaves the baked-in feed alone, which is what every existing install
   * already does.
   */
  manifestUrl: string | null
}

const FEED_TIMEOUT_MS = 10_000

export const checkReleasePolicy = async (current: string): Promise<ReleasePolicy | null> => {
  let response: Response
  try {
    response = await fetch(env.releaseFeedUrl, {
      headers: {
        Accept: 'application/json',
        // ngrok's free tier answers anything with a browser user agent with an
        // HTML interstitial - status 200, content-type text/html - and Electron's
        // fetch sends a Chrome user agent. Without this header the JSON parse
        // below fails on every check. Harmless on any other host.
        'ngrok-skip-browser-warning': 'true'
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
    })
  } catch (error) {
    logger.warn('Release policy feed unreachable', {
      reason: error instanceof Error ? error.message : String(error)
    })
    return null
  }

  if (!response.ok) {
    logger.warn('Release policy feed returned an error', { status: response.status })
    return null
  }

  // A tunnel that has gone down, or an interstitial that slipped past the
  // header above, answers 200 with HTML. Catch it here rather than letting a
  // parse error look like a network failure.
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    logger.warn('Release policy feed returned a non-JSON response')
    return null
  }

  let payload: {
    versionName?: string
    mandatory?: boolean
    success?: boolean
    link?: string
    ymlLink?: string
  }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    logger.warn('Release policy feed returned malformed JSON')
    return null
  }

  const minimumVersion = typeof payload.versionName === 'string' ? payload.versionName.trim() : ''
  if (payload.success === false || minimumVersion === '') return null

  // Only http(s). The value reaches a shell that opens it, and the feed is a
  // plain HTTP response — `file:` or a custom scheme arriving from there must
  // never be handed to the operating system.
  const link = typeof payload.link === 'string' ? payload.link.trim() : ''
  const downloadUrl = /^https?:\/\//i.test(link) ? link : null

  /*
   * The manifest, and it must BE a manifest.
   *
   * electron-updater is pointed at the directory this sits in and asks for
   * `<channel>.yml`, so a folder or a share page cannot work however valid the
   * URL is. A bad value here would replace a feed that at least might work
   * with one that certainly cannot, so anything else is ignored and the build
   * keeps what it shipped with.
   */
  const yml = typeof payload.ymlLink === 'string' ? payload.ymlLink.trim() : ''
  const manifestUrl = /^https?:\/\/\S+\.ya?ml$/i.test(yml) ? yml : null

  if (yml !== '' && manifestUrl === null) {
    logger.warn('Release policy carried a manifest link that is not a .yml URL — ignoring it', { yml })
  }

  logger.debug('Release policy fetched', { current, minimumVersion, mandatory: payload.mandatory === true })

  return { minimumVersion, mandatory: payload.mandatory === true, downloadUrl, manifestUrl }
}
