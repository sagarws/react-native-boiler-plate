/**
 * Build-time configuration injected by electron-vite.
 *
 * electron-vite exposes `.env` keys prefixed with MAIN_VITE_ (and VITE_) to the
 * main process through import.meta.env, replacing them statically at build time
 * - the .env file itself is never shipped inside the installer.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_API_BASE_URL?: string
  /**
   * The file service holding order images (`/order/view/{key}`), which is a
   * different host from the API. The FE calls the same value
   * VITE_APP_ORDER_BASE_URL; that prefix is renderer-only and invisible to the
   * main process, so it must be set again under MAIN_VITE_.
   */
  readonly MAIN_VITE_ORDER_BASE_URL?: string
  readonly MAIN_VITE_API_TIMEOUT_MS?: string
  /** Dev only: suffix for a separate userData folder. See database/index.ts. */
  readonly MAIN_VITE_DEV_PROFILE?: string
  /**
   * Release host ROOT, no path. Serves /latest.yml at the root and /cms/version
   * under /cms, so it is the only feed URL that needs configuring. Read here at
   * build time AND by scripts/package.cjs for publish.url.
   */
  /** "true" renews sessions through the backend instead of in this app. */
  readonly MAIN_VITE_USE_BACKEND_FOR_SESSION_UPDATE?: string
  /** "true" signs in without the operator; otherwise they sign in by hand. */
  readonly MAIN_VITE_SESSION_UPDATE_AUTOMATICALLY?: string
  /** "false" shows the browser while it signs in; anything else is headless. */
  readonly MAIN_VITE_HEADLESS?: string
  readonly MAIN_VITE_AJIO_HEADLESS?: string
  readonly MAIN_VITE_DELHIVERY_HEADLESS?: string
  readonly MAIN_VITE_FLIPKART_HEADLESS?: string
  readonly MAIN_VITE_MEESHO_HEADLESS?: string
  readonly MAIN_VITE_MYNTRA_HEADLESS?: string
  readonly MAIN_VITE_NYKAA_HEADLESS?: string
  readonly MAIN_VITE_SNAPDEAL_HEADLESS?: string
  readonly MAIN_VITE_XBEES_HEADLESS?: string
  readonly MAIN_VITE_DISABLE_SUBMIT?: string
  readonly MAIN_VITE_CAPTURE_PAGE_PATCHES?: string
  readonly MAIN_VITE_AWS_BUCKET_REGION?: string
  readonly MAIN_VITE_AWS_BUCKET_NAME?: string
  /**
   * The shared mailbox one-time codes arrive in — the same inbox the
   * automation server reads. Set them and this app reads Gmail itself, so a
   * Flipkart or Tata CliQ sign-in needs no server running. Never ship them in
   * a build that is handed out: one inbox serves every seller.
   */
  readonly MAIN_VITE_GMAIL_IMAP_USER?: string
  readonly MAIN_VITE_GMAIL_IMAP_PASSWORD?: string
  /** Where a launch reports the old installers it deleted. Unset: not reported. */
  readonly MAIN_VITE_INSTALLER_REPORT_URL?: string
  /** Where a master import POSTs its downloaded report. */
  readonly MAIN_VITE_MASTER_SERVER_BASE_URL?: string
  readonly MAIN_VITE_ORDER_FILE_BASE_URL?: string
  /** Where a downloaded master-data report is POSTed. Defaults off the master server. */
  readonly MAIN_VITE_TRACKVID_IMPORTDATA_API_URL?: string
  /** Base for the /user-profile lookup a master import makes. */
  readonly MAIN_VITE_USER_PROFILE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * `IMPERSON_LOGIN=true` in .env — this build offers "sign in as a user id".
 * Inlined at build time by electron.vite.config.ts; false when unset.
 */
declare const __IMPERSON_LOGIN__: boolean

/**
 * `AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true` in .env — a running process
 * re-captures an expired login on an auto-login platform and carries on.
 * Inlined at build time by electron.vite.config.ts; false when unset.
 */
declare const __AUTO_SESSION_CAPTURE__: boolean

/**
 * `DEV_MODE_PERSIST=true` in .env — developer mode survives a restart.
 * Inlined at build time by electron.vite.config.ts; false when unset.
 */
declare const __DEV_MODE_PERSIST__: boolean

/**
 * The core's MAX_CLAIM_ATTEMPTS, inlined at build time (electron.vite.config.ts):
 * "unlimited", a number, or whatever was written there. Read only through
 * `claimAttemptLimit` in shared/constants/claims.ts.
 */
declare const __MAX_CLAIM_ATTEMPTS__: unknown
