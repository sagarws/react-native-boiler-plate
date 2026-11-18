/**
 * The single place that reads build-time configuration.
 *
 * Every value has a working default so a missing .env degrades to "points at
 * production" rather than crashing at startup, and the resolved values are
 * logged once so support can tell which backend a user's build talks to.
 */
const DEFAULT_API_BASE_URL = 'https://api.trackvid.in'
const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Path the release policy document is served on.
 *
 * UNDER /api, because TrackVid-BE serves it: `app.use("/api", routes)` and then
 * `router.use("/cms", cmsRoutes)`. The policy is `appsettings.cmsApp`, written
 * by Trackvid-Monitor and read here.
 *
 * IT USED TO SAY '/cms/version', on the belief that Automated-Scripts served
 * this and put latest.yml beside it at the host root. Automated-Scripts has no
 * such route — it never did — so every request 404'd, and because a dead feed
 * is deliberately non-fatal (see releasePolicy.service) the whole policy layer
 * was silently inert: nothing set in Monitor reached any machine, and no error
 * was raised anywhere.
 *
 * One host still serves both halves of releasing — electron-updater appends
 * /latest.yml to the host root — so a host that answers this path must also
 * carry the manifest.
 */
const RELEASE_FEED_PATH = '/api/cms/version'

const readString = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/**
 * Only the exact string "true" turns a flag on.
 *
 * Anything else — unset, "TRUE ", "1", a typo — is off. A flag that decides
 * where a marketplace login runs should never be enabled by a value someone
 * did not clearly intend.
 */
const readFlag = (value: string | undefined): boolean => value?.trim() === 'true'

/** Base URL with any trailing slash removed, so `${base}/api/...` is always well-formed. */
const baseUrl = readString(import.meta.env.MAIN_VITE_API_BASE_URL, DEFAULT_API_BASE_URL).replace(/\/+$/, '')
const masterServerBaseUrl = readString(
  import.meta.env.MAIN_VITE_MASTER_SERVER_BASE_URL,
  'https://master-api-automation.trackvid.in'
).replace(/\/+$/, '')

/**
 * Release host root, no trailing slash: `${updateFeedUrl}/latest.yml` must
 * resolve.
 *
 * THE API HOST, not a key of its own. One host serves both halves — the API
 * under /api, the release feed at the root — and a second key holding the same
 * string was only ever two chances to get it wrong.
 *
 * What has not changed is the asymmetry behind it: this value is also written
 * into app-update.yml at package time and is PERMANENT for every copy shipped
 * from that build. A wrong API base is fixed by the next build; a wrong feed
 * URL cannot be fixed at all, because the mechanism for telling those installs
 * the new address is the thing that is broken. So `scripts/package.cjs` refuses
 * to package a base that is http or points at localhost — the development
 * value on this very line is exactly what it is guarding against.
 */
const updateFeedUrl = baseUrl

/**
 * The file service that stores order images — a DIFFERENT HOST from the API.
 *
 * `/order/screenshot` (which lists an AWB's images) is served by the TrackVid
 * API; `/order/view/{key}` (which returns the bytes) is served by this one,
 * `https://file.trackvid.in` in production. Assuming one host served both is
 * what made the six-side PDF fail with every image unreadable.
 *
 * MAIN_VITE_, not VITE_APP_: electron-vite exposes only the MAIN_VITE_ prefix
 * to the main process, and this is read here. The FE's own copy of this value
 * is VITE_APP_ORDER_BASE_URL, which is the renderer convention and invisible
 * from here — an easy and silent mistake, since the variable looks present in
 * .env either way.
 *
 * Two names reach the same host: MAIN_VITE_ORDER_FILE_BASE_URL (what .env
 * sets) and MAIN_VITE_ORDER_BASE_URL. Either one wins over the production
 * default, so both keys below always agree.
 */
const orderFileBaseUrl = readString(
  import.meta.env.MAIN_VITE_ORDER_FILE_BASE_URL,
  readString(import.meta.env.MAIN_VITE_ORDER_BASE_URL, 'https://file.trackvid.in')
).replace(/\/+$/, '')

export const env = {
  apiBaseUrl: baseUrl,
  /** Root of the file service — `/order/view/<key>` lives here. */
  orderFileBaseUrl,
  /** The same root, under the name the six-side PDF reads. */
  ordersBaseUrl: orderFileBaseUrl,
  /** Every TrackVid endpoint lives under /api. */
  apiUrl: `${baseUrl}/api`,
  apiTimeoutMs: readPositiveInt(import.meta.env.MAIN_VITE_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  /**
   * Release host root. Baked into app-update.yml at package time as publish.url,
   * and permanent for every copy shipped from that build.
   */
  updateFeedUrl,
  /**
   * Absolute URL of the release feed, derived from the host above so the two
   * can never drift apart. Separate from apiBaseUrl on purpose: the feed is
   * served by the release host, not the TrackVid API, and it answers before
   * anyone has signed in.
   */
  releaseFeedUrl: `${updateFeedUrl}${RELEASE_FEED_PATH}`,
  /**
   * Renew sessions through the backend instead of in this app.
   *
   * OFF by default, which is the point of this build: the desktop app opens its
   * own browser and runs the platform's login from
   * @trackvid/automation-core — the same code the automation server runs — so
   * BE + Automated-Scripts are replaced by CMS + the core for signing in.
   *
   * Set MAIN_VITE_USE_BACKEND_FOR_SESSION_UPDATE=true to fall back to the
   * server path: POST /cms/renew-session, the browser opens on the automation
   * server, and this app only reports the result. Useful on a machine that
   * cannot run a browser, or to compare the two.
   *
   * Either way the captured session is STORED through the backend — that is not
   * what this flag controls.
   */
  useBackendForSessionUpdate: readFlag(import.meta.env.MAIN_VITE_USE_BACKEND_FOR_SESSION_UPDATE),
  /**
   * Sign in without the operator, once they have pressed Re-capture.
   *
   * Only read when the backend path is off. On:  the app runs the platform's
   * login from @trackvid/automation-core itself and the operator does nothing
   * else. Off: the app opens the marketplace's login page in a window and the
   * operator signs in by hand, exactly as they would in a browser.
   *
   * OFF by default, deliberately. A scripted sign-in drives a real browser with
   * a real password against a live marketplace; a machine should opt into that
   * rather than inherit it from a missing line in a .env file. The manual path
   * always works and never surprises anyone.
   *
   * This is the MACHINE's switch. Trackvid-Monitor's per-platform
   * `isAutoLoginOnActiveSession` is the company's. A sign-in is automatic only
   * when both agree — either one saying no falls back to the manual window.
   */
  sessionUpdateAutomatically: readFlag(import.meta.env.MAIN_VITE_SESSION_UPDATE_AUTOMATICALLY),
  /**
   * Show the browser while it signs in.
   *
   * Headless unless MAIN_VITE_HEADLESS is exactly "false", matching the
   * HEADLESS rule the automation server uses.
   *
   * It needs its own key because the core reads `process.env.HEADLESS`, and a
   * packaged Electron app has no .env to read — the file is a BUILD input, not
   * a runtime one. So the value is baked in here and pushed into process.env
   * before any login runs; see localLogin.service.
   */
  headless: import.meta.env.MAIN_VITE_HEADLESS?.trim() !== 'false',
  /**
   * Per-platform overrides of the above — `MAIN_VITE_MYNTRA_HEADLESS` and
   * friends. Listed explicitly because electron-vite substitutes
   * `import.meta.env.X` at BUILD time from literal keys; it cannot resolve a
   * name computed at runtime, so a loop over platform names would silently
   * read nothing in a packaged app.
   */
  platformHeadless: {
    ajio: import.meta.env.MAIN_VITE_AJIO_HEADLESS?.trim(),
    delhivery: import.meta.env.MAIN_VITE_DELHIVERY_HEADLESS?.trim(),
    flipkart: import.meta.env.MAIN_VITE_FLIPKART_HEADLESS?.trim(),
    meesho: import.meta.env.MAIN_VITE_MEESHO_HEADLESS?.trim(),
    myntra: import.meta.env.MAIN_VITE_MYNTRA_HEADLESS?.trim(),
    nykaa: import.meta.env.MAIN_VITE_NYKAA_HEADLESS?.trim(),
    snapdeal: import.meta.env.MAIN_VITE_SNAPDEAL_HEADLESS?.trim(),
    xbees: import.meta.env.MAIN_VITE_XBEES_HEADLESS?.trim()
  } as Record<string, string | undefined>,
  /**
   * Walk the whole claim, stop before the marketplace.
   *
   * Everything runs for real — session reuse, login, the config from the
   * backend, downloading each piece of evidence and uploading it — and only the
   * last, irreversible call is skipped. Opt-IN: only the exact string 'true'
   * turns it on, so a typo files claims exactly as today rather than silently
   * stopping a production machine from working.
   */
  disableSubmit: import.meta.env.MAIN_VITE_DISABLE_SUBMIT?.trim().toLowerCase() === 'true',
  /**
   * Patch the capture page to look more like Chrome (`window.chrome`, and the
   * rest of `browserIdentity`).
   *
   * Opt-IN. It needs Electron's debugger, which exposes the DevTools Protocol
   * to the page — and detecting CDP is a standard anti-bot check, so it can
   * read as MORE automated rather than less. Myntra's landing page stopped
   * enabling its Login button with these on and the user-agent fix alone.
   */
  capturePagePatches:
    import.meta.env.MAIN_VITE_CAPTURE_PAGE_PATCHES?.trim().toLowerCase() === 'true',
  /**
   * Where the evidence lives.
   *
   * The AJIO claim flow builds its attachment URL by hand —
   * `https://s3.${AWS_BUCKET_REGION}.amazonaws.com/${AWS_BUCKET_NAME}/<key>` —
   * so an unset value produces `https://s3.undefined.amazonaws.com/undefined/…`
   * and the side-images PDF fails to download. Same shape as the missing
   * TRACKVID_IMPORTDATA_API_URL that broke the AJIO master import.
   *
   * Defaulted rather than left blank: these are the public bucket coordinates,
   * not a secret, and every deployment so far uses them.
   */
  s3Region: import.meta.env.MAIN_VITE_AWS_BUCKET_REGION?.trim() || 'ap-south-1',
  s3Bucket: import.meta.env.MAIN_VITE_AWS_BUCKET_NAME?.trim() || 'trackvid',
  /**
   * The mailbox one-time codes are emailed to — the SAME one the automation
   * server reads, so a code fetched here and a code fetched there are the same
   * code from the same inbox.
   *
   * Set, this app reads Gmail itself over IMAP and nothing else has to be
   * running for a Flipkart or Tata CliQ sign-in. Unset, both ask TrackVid,
   * which asks that server — which is where they were, and why a Tata CliQ
   * login failed the moment it was down.
   *
   * A SHARED INBOX, and worth saying out loud: one mailbox serves every seller,
   * so these belong in an operator's own .env and never in a build that is
   * handed out. A packaged build carrying them gives every installation the
   * whole mailbox.
   */
  gmailImapUser: import.meta.env.MAIN_VITE_GMAIL_IMAP_USER?.trim() || '',
  gmailImapPassword: import.meta.env.MAIN_VITE_GMAIL_IMAP_PASSWORD?.trim() || '',
  /**
   * Where a launch reports how many old installers it deleted from Downloads —
   * see installerCleanup.service. Unset: nothing is sent.
   */
  installerReportUrl: import.meta.env.MAIN_VITE_INSTALLER_REPORT_URL?.trim() || '',
  /**
   * Where a master import uploads its report, and where it reads a user profile.
   *
   * The core reads these from `process.env` (MASTER_SERVER_BASE_URL,
   * TRACKVID_GET_USER_PROFILE_URL) because on the server they come from a .env
   * that is actually present at runtime. A packaged desktop app has none, so
   * they are baked in here and published to process.env before an import runs —
   * the same arrangement as HEADLESS.
   *
   * Both default to the main API base, which is where they point in every
   * deployment seen so far; override only if a host splits them.
   */
  masterServerBaseUrl,
  // The server sets this to <api>/auth — the core appends "/user-profile".
  userProfileUrl: readString(
    import.meta.env.MAIN_VITE_USER_PROFILE_URL,
    `${baseUrl}/api/auth`
  ).replace(/\/+$/, ''),
  /**
   * Where a downloaded master-data report is POSTed.
   *
   * The core reads this as TRACKVID_IMPORTDATA_API_URL and does not default it,
   * so an unset value reaches axios as `undefined` and fails with
   * `TypeError: Invalid URL` three retries deep — a long way from the cause.
   *
   * Derived from the master server rather than repeated, so the two cannot
   * disagree about which host the reports go to.
   */
  importDataUrl: readString(
    import.meta.env.MAIN_VITE_TRACKVID_IMPORTDATA_API_URL,
    `${masterServerBaseUrl}/api/v2/master/import`
  ).replace(/\/+$/, '')
} as const
