/**
 * The single source of truth for IPC channel names.
 *
 * The preload bridge only forwards channels present in IPC_CHANNELS, so adding a
 * handler in the main process is not enough to expose it to the renderer - the
 * channel has to be listed here too.
 */
export const CRUD_ACTIONS = ['list', 'get', 'create', 'update', 'delete'] as const
export type CrudAction = (typeof CRUD_ACTIONS)[number]

export const crudChannel = (namespace: string, action: CrudAction): string => `${namespace}:${action}`

export const SYSTEM_CHANNELS = {
  getPlatformInfo: 'system:platform-info',
  /**
   * Puts text on the clipboard, from the MAIN process.
   *
   * `navigator.clipboard` is refused in this renderer — it is not a secure
   * context in the browser's sense, so the write permission is denied and the
   * only sign of it is a failure at the moment somebody presses a button.
   * Electron's own clipboard has no such notion, and this is the only way to
   * reach it from here.
   */
  copyText: 'system:copy-text',
  /**
   * Is the operator's Google Chrome installed, and is a matching chromedriver
   * on this machine? Myntra's sign-in needs both; see shared/types/browserCheck.
   */
  checkBrowser: 'system:check-browser',
  /**
   * Opens a file picker for a ChromeDriver the operator downloaded themselves
   * (the zip or the exe), installs it, and answers with a fresh check.
   */
  importChromeDriver: 'system:import-chromedriver',
  /**
   * The renderer's home page has rendered. Background work queued at launch and
   * at sign-in starts a few seconds after this — see startupGate.service.
   */
  homeRendered: 'system:home-rendered'
} as const

export const AUTH_CHANNELS = {
  login: 'auth:login',
  logout: 'auth:logout',
  /** Returns the restored session on startup; never returns the access token. */
  session: 'auth:session',
  /** Signs in as another user by id, without their password. */
  impersonate: 'auth:impersonate'
} as const

export const PREFERENCES_CHANNELS = {
  get: 'preferences:get',
  setTheme: 'preferences:set-theme',
  /**
   * Unlocks developer mode, by asking the SERVER whether this is the password.
   *
   * The password itself never reaches this app — see devMode.service. Turning
   * the mode off needs no password, because that direction is never the risky
   * one.
   */
  verifyDevMode: 'preferences:verify-dev-mode',
  disableDevMode: 'preferences:disable-dev-mode',
  /** Myntra's sign-in: submit the request from the page, or click the button. */
  setMyntraHeadlessLogin: 'preferences:set-myntra-headless-login',
  /** Whether the Automations switch comes up on when the app opens. */
  setAutomationsOnAtLaunch: 'preferences:set-automations-on-at-launch',
  /** Whether the Login page shows each login's password, with a copy button. */
  setShowLoginInfo: 'preferences:set-show-login-info',
  /**
   * The operator's own palette, type scale and corners.
   *
   * The whole override set on every change rather than one seed at a time: it
   * is a dozen short strings, and a partial write would need a merge rule that
   * both sides had to agree on. Sanitised in the handler regardless of what the
   * renderer believes it sent.
   */
  setAppearance: 'preferences:set-appearance'
} as const

/** Request/response channels for the updater. */
export const UPDATE_CHANNELS = {
  /** Current updater state, for a renderer that mounted after events fired. */
  status: 'update:status',
  /** Ask the updater to look for a new build now. */
  check: 'update:check',
  /** Quit and install a build that has finished downloading. */
  install: 'update:install',
  /** What the updater actually did and saw — see UpdateLogEntry. */
  log: 'update:log',
  /**
   * Download the current release's installer again and reinstall it, even at
   * the version already installed — for a release re-uploaded under the same
   * number. Quits and relaunches the app.
   */
  reinstall: 'update:reinstall'
} as const

/**
 * Main -> renderer pushes. These are NOT invoke channels: nothing can be sent
 * *to* them from the renderer, it can only listen. They are allow-listed
 * separately so a push channel can never be mistaken for a callable handler.
 */
export const UPDATE_EVENTS = {
  /** Fired on every updater state transition, including download progress. */
  status: 'update:status-changed'
} as const

/**
 * Main -> renderer: a session was captured, renewed or published.
 *
 * The renderer had a pub/sub of its own for this — and only for its own
 * actions, because it is process-local by design. A session captured by the
 * NIGHTLY task happens in the main process, so nothing told the window, and
 * the red "these sessions are not updated" banner sat there over a run that
 * had just fixed every session it named. It cleared on a manual refresh, which
 * is the operator doing the notification by hand.
 */
export const PLATFORM_SESSION_EVENTS = {
  changed: 'platform-session:changed',
  /**
   * Which account the Session update is signing in RIGHT NOW — null between
   * accounts, and once the run is over.
   *
   * `changed` fires when a capture LANDS, which is the wrong end of a sign-in
   * that can take a minute: the chip sat red and motionless for that minute and
   * then turned green, so the one account actually being worked on looked
   * exactly like the four queued behind it.
   */
  capturing: 'platform-session:capturing'
} as const

/** Payload of `PLATFORM_SESSION_EVENTS.capturing`. Null means nothing in flight. */
export interface SessionCapturingEvent {
  platform: string
  username: string
}

export const PLATFORM_SESSION_CHANNELS = {
  /** The platforms a session can be captured for. */
  list: 'platform-session:list',
  /** Opens a login window and, once signed in, ships the jar to the backend. */
  capture: 'platform-session:capture',
  /** Closes an in-flight capture window without harvesting. */
  cancel: 'platform-session:cancel',
  /**
   * Correct a marketplace login and verify it by signing in for real.
   *
   * The way back from `is_verified: false`. A marketplace that says the
   * password is wrong puts the account out of every automation, and until this
   * existed the only way back in was editing the database.
   */
  verifyCredential: 'platform-session:verify-credential',
  /**
   * Add a marketplace login (stored unverified, then signed in with and marked
   * verified if that works) or remove one — see credentialManage.service.
   */
  addCredential: 'platform-session:add-credential',
  removeCredential: 'platform-session:remove-credential',
  /** Session health per credential, for every platform this company has. */
  health: 'platform-session:health',
  /**
   * The same, after ASKING each marketplace about the sessions whose dates say
   * they are fine.
   *
   * Separate from `health` because it costs a request per account. `health` is
   * read whenever a screen opens; this is pressed.
   */
  verify: 'platform-session:verify',
  /**
   * Removes ONE credential's saved session — backend, this machine, and every
   * local copy of it.
   *
   * The counterpart to `capture`. Until this existed a jar the marketplace had
   * started refusing could only be REPLACED, and replacing it means a full
   * sign-in — exactly what is impossible when the account is locked or its
   * password has changed.
   */
  clear: 'platform-session:clear',
  /**
   * The same, for every credential on every platform.
   *
   * ITS OWN CHANNEL rather than `clear` with the arguments left off: the gap
   * between the two is one account signing in again and all of them, so it has
   * to be asked for by name rather than reached through a dropped field.
   */
  clearAll: 'platform-session:clear-all',
  /** Sessions captured here that the backend has not accepted yet. */
  pending: 'platform-session:pending',
  /** Ships one queued session to the backend. */
  flushPending: 'platform-session:flush-pending',
  /**
   * Records whether one credential's sign-in costs a one-time code.
   *
   * Snapdeal, Flipkart and AJIO only — the marketplaces where it is a setting on
   * the seller account rather than a property of the marketplace.
   */
  otpMode: 'platform-session:otp-mode',
  /**
   * The newest one-time code in this machine's mailbox for one account, and
   * when its mail arrived — the Login page's "Get OTP", for a person signing
   * in by hand. Reads only; nothing is typed anywhere.
   */
  peekOtp: 'platform-session:peek-otp',
  /**
   * One login's stored password, for the Login page to show under its
   * username. Refused unless Settings → Common settings → Visible Login info
   * is on.
   */
  revealPassword: 'platform-session:reveal-password',
  /**
   * Turn automatic sign-in on or off for one platform of this company
   * (`settings.isAutoLoginOnActiveSession.<platform>`) — the Sign-in switch.
   */
  autoLogin: 'platform-session:auto-login'
} as const

export const CLAIM_QUEUE_CHANNELS = {
  /** Claims this machine has been given, newest first. */
  list: 'claim-queue:list',
  /** Live socket state, for the connection indicator. */
  socketState: 'claim-queue:socket-state',
  /** Files one queued claim from this machine. */
  process: 'claim-queue:process',
  /** Platforms this build can actually process. */
  supported: 'claim-queue:supported',
  /**
   * The status tabs each platform uses, from the core's registry.
   *
   * Fetched rather than hard-coded in the renderer: the list differs per
   * platform (Myntra has three states AJIO does not, Snapdeal has four fewer)
   * and it has to match the admin panel exactly. One source, in the core.
   */
  statusTabs: 'claim-queue:status-tabs',
  /**
   * Whether these accounts' sessions can file a claim, asked of the
   * marketplace rather than of the stored expiry date.
   *
   * The Claims page checks the stored record itself — that is instant and it
   * is the rule the banner uses — but a session the marketplace has stopped
   * accepting still looks fine there until the day it runs out. This is the
   * question only a probe can answer, asked before a batch starts rather than
   * discovered per claim once it has.
   */
  sessionCheck: 'claim-queue:session-check'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const CLAIM_QUEUE_EVENTS = {
  claimReceived: 'claim-queue:received',
  /**
   * A queued claim moved — received → running → succeeded/failed.
   *
   * The auto-runner works claims without anyone pressing anything, so without
   * this the queue only changed on screen when a page happened to refetch, and
   * a claim could run and finish while the operator watched a stale row.
   */
  claimStatusChanged: 'claim-queue:status-changed',
  socketState: 'claim-queue:socket-state-changed',
  /**
   * How far a Create Ticket batch has got.
   *
   * The batch runs in the main process — it has to, so it can hold the
   * automation lock and one browser for the whole run — so the page that
   * started it cannot count its own progress any more, and an operator who
   * navigates away would otherwise see nothing at all.
   */
  batchProgress: 'claim-queue:batch-progress'
} as const

export const BULK_SPF_CHANNELS = {
  /**
   * Fill the POB ID on a sheet that only carries return AWBs.
   *
   * The POB is an AJIO-internal id an operator has no way to know, and a
   * bulk-claim row without one is never attempted.
   */
  fillPob: 'bulk-spf:fill-pob',
  /** Native file dialog; returns the chosen path and how many rows it holds. */
  chooseFile: 'bulk-spf:choose-file',
  /** Writes the blank template wherever the operator asks for it. */
  downloadTemplate: 'bulk-spf:download-template',
  /**
   * Reads and sorts the uploads WITHOUT filing — every row, claimable or not,
   * for the Selected Proceed review.
   */
  plan: 'bulk-spf:plan',
  /** Reads the uploads and starts filing — every claimable row, or only the keys picked in the review. */
  start: 'bulk-spf:start',
  /**
   * Re-files the last run's failed (and never-attempted) rows into the SAME run,
   * so its result stays one combined report across every attempt.
   */
  retryFailed: 'bulk-spf:retry-failed',
  /** This company's bulk-claim jobs from TrackVid, newest first. */
  history: 'bulk-spf:history',
  /** One job's report: counts and its Failed / Help Center Failed lines. */
  historyJob: 'bulk-spf:history-job',
  /** One job's ticket report as .xlsx — Success and Failed sheets — saved where the operator chooses. */
  downloadJobReport: 'bulk-spf:download-job-report',
  /** The current (or last) run, for a modal that mounted after it began. */
  status: 'bulk-spf:status',
  /** Reveals the results workbook in the operator's file manager. */
  openReport: 'bulk-spf:open-report'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const BULK_SPF_EVENTS = {
  /**
   * The run moved — a claim finished, or the preview was resolved.
   *
   * A bulk run takes hours and nobody is going to sit on a page polling it, so
   * the modal is fed rather than asked.
   */
  progress: 'bulk-spf:progress'
} as const

/** The Nykaa DDR bulk claim — one sheet, every row a "Delivered but Not Received" ticket. */
export const NYKAA_BULK_DDR_CHANNELS = {
  /** Native file dialog; returns the chosen path and how many rows it holds. */
  chooseFile: 'nykaa-ddr:choose-file',
  /** Writes the blank template wherever the operator asks for it. */
  downloadTemplate: 'nykaa-ddr:download-template',
  /** Reads the chosen sheet and starts filing in the background. */
  start: 'nykaa-ddr:start',
  /** Files every row of the last run that has no ticket yet, into that same run. */
  retry: 'nykaa-ddr:retry',
  /** The current (or last) run, for a modal that mounted after it began. */
  status: 'nykaa-ddr:status',
  /** Reveals the results workbook in the operator's file manager. */
  openReport: 'nykaa-ddr:open-report'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const NYKAA_BULK_DDR_EVENTS = {
  /** The run moved — a row finished. */
  progress: 'nykaa-ddr:progress'
} as const

export const DASHBOARD_CHANNELS = {
  /** One assembled snapshot: claim counts, session health, local queue. */
  snapshot: 'dashboard:snapshot'
} as const

export const IMPORT_SCHEDULE_CHANNELS = {
  /** Current schedule, platforms and last/next run. */
  state: 'import-schedule:state',
  /** Re-reads the schedule from the server. */
  refresh: 'import-schedule:refresh',
  /** Changes the company's scheduled time. */
  setTime: 'import-schedule:set-time',
  /** Changes ONE platform's scheduled time. */
  setPlatformTime: 'import-schedule:set-platform-time',
  /** One row per credential that can be master-imported. */
  rows: 'master-import:rows',
  /** Starts a master import for the named credentials. */
  resync: 'master-import:resync',
  /** Re-reads everything this app caches from the backend. */
  syncAll: 'offline-cache:sync-all',
  /** When each cached resource was last fetched. */
  cacheStatus: 'offline-cache:status'
} as const

/** Pushed whenever the scheduler's state changes. */
export const IMPORT_SCHEDULE_EVENTS = {
  state: 'import-schedule:state-changed'
} as const

export const COMPANY_CHANNELS = {
  /** The locally-held company document, with secrets redacted for display. */
  document: 'company:document',
  /** Re-reads it from the server first, then returns it. */
  refresh: 'company:refresh'
} as const

export const CMS_LIST_CHANNELS = {
  /** A page of the company's claims, live from the server. */
  list: 'cms-list:list',
  /** Platform and status tab counts. */
  counts: 'cms-list:counts',
  /** Which fields may be set across many claims at once, and their vocabularies. */
  bulkFields: 'cms-list:bulk-fields',
  /**
   * Sets ONE field to ONE value across the selected claims.
   *
   * The field is an allowlist KEY, never a document path — the server decides
   * what that key writes. A bulk writer that took a path from the caller would
   * be one typo away from rewriting a column nobody meant to touch.
   */
  bulkUpdate: 'cms-list:bulk-update',
  /**
   * Adds or corrects ONE claim's ticket number, typed by hand. The server moves
   * the claim to In Review with it — see `canEditTicket` for where that is
   * allowed.
   */
  updateTicket: 'cms-list:update-ticket',
  /**
   * Re-queues ONE AJIO claim's Drive conversion after it failed — the admin
   * panel's retry icon. The server refuses unless Drive Status is "failed".
   */
  retryDrive: 'cms-list:retry-drive',
  /**
   * Writes the claims on screen to an .xlsx the operator saves — one sheet per
   * platform, columns from its Create Claim form, no images.
   */
  exportXlsx: 'cms-list:export-xlsx'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const CMS_LIST_EVENTS = {
  /**
   * An AJIO claim's Drive conversion settled (the backend's `cms:drive:status`).
   *
   * Without it a row stayed "Preparing…" — and unselectable for Create Ticket —
   * until somebody reloaded, although the server had finished minutes earlier.
   */
  driveStatus: 'cms-list:drive-status'
} as const

export const CLAIM_RESOURCE_CHANNELS = {
  /**
   * Zips every piece of evidence one claim needs — images, video, description
   * and the form's text fields — named after that platform's claim form, and
   * saves it where the operator chooses. For filing the claim by hand.
   */
  download: 'claim-resources:download',
  /**
   * Read one remote image as bytes, for the renderer to decode.
   *
   * WHY IT CANNOT BE DONE IN THE RENDERER. An `<img>` renders a signed S3 URL
   * without CORS; `fetch` of the same URL is a cross-origin request and S3
   * answers it without the headers that would let the page read the body. So
   * the six-side images display perfectly and cannot be turned into a PDF —
   * which is exactly how it failed.
   *
   * The main process has no such rule, and already downloads these very files
   * for "Download resources".
   */
  readImage: 'claim-resources:read-image'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const SKU_LOOKUP_CHANNELS = {
  /**
   * Reads the articles AJIO holds against one claim's return AWB.
   *
   * A read, not an automation: it raises nothing and changes nothing, and
   * exists so a person can pick the right article rather than an automation
   * guess at it.
   */
  articles: 'sku-lookup:articles',
  /** Stores the SKU the operator chose. */
  apply: 'sku-lookup:apply',
  /** How many claims a bulk sweep would ask about. Drives the button. */
  pending: 'sku-lookup:pending',
  /** Asks AJIO about every eligible claim. Writes nothing — the operator saves. */
  sweep: 'sku-lookup:sweep',
  /** The sweep in flight, or the last one, for a modal that mounted after it began. */
  sweepStatus: 'sku-lookup:sweep-status',
  /** Saves the SKUs an operator confirmed, in one call. */
  applyMany: 'sku-lookup:apply-many'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const SKU_LOOKUP_EVENTS = {
  /** How far a bulk sweep has got — a browser per account, so minutes not seconds. */
  progress: 'sku-lookup:progress'
} as const

export const MASTER_REPORT_CHANNELS = {
  /** The AJIO accounts a report can be read from, with their POB counts. */
  accounts: 'master-report:accounts',
  /** One page of a dropship report. A read — nothing is written anywhere. */
  page: 'master-report:page',
  /**
   * Sweeps one AJIO account's places of business and stores them.
   *
   * A POB list is a precondition for almost everything this app asks AJIO — the
   * claim search, account mapping, the SKU picker, this report — so it is
   * offered where the sessions those tools depend on are managed.
   */
  syncPobs: 'master-report:sync-pobs',
  /**
   * Sweeps one Tata CliQ account's slaves and stores them.
   *
   * The same precondition POBs are for AJIO: a Tata CliQ return is visible only
   * to the slave that owns it, and the portal's pick is server-side session
   * state — so a claim without the list has nothing to search under. Offered
   * beside the sessions it depends on, and beside Sync POBs for the same reason.
   */
  syncSlaves: 'master-report:sync-slaves',
  /**
   * Re-reads one Delhivery login's "Domestic" accounts and stores them. Runs on
   * its own after every Delhivery session update; this is the manual re-sync.
   */
  syncDomestics: 'master-report:sync-domestics',
  /**
   * Every line of one AJIO return order, looked up by its number across the
   * last five 31-day windows. A read — Create Claim fills its AWBs, SKU and
   * POB from the answer.
   */
  /**
   * The operator moved the API/Report toggle.
   *
   * Fire-and-forget, and it exists for ONE reason: the terminal shows the main
   * process, so a choice made in the renderer is invisible there — and this
   * choice decides whether a lookup touches AJIO at all. When the two
   * disagreed, nothing in the log said which had been picked.
   *
   * Narrow on purpose. A general renderer-to-main logging channel would be a
   * back door for anything to write to the operator's log.
   */
  lookupSourceChanged: 'master-report:lookup-source-changed',
  returnOrder: 'master-report:return-order'
} as const

export const RE_CLAIM_CHANNELS = {
  /** Native file dialog; returns the chosen path and the rows it holds. */
  chooseFile: 're-claim:choose-file',
  /** Writes the blank rejection-export template wherever the operator asks. */
  downloadTemplate: 're-claim:download-template',
  /** Rows typed into the app instead of uploaded; same sheet shape back. */
  manualRows: 're-claim:manual-rows',
  /** What Myntra currently holds for one ticket. A read. */
  ticket: 're-claim:ticket',
  /** Reopens one ticket, then reads it back. */
  submit: 're-claim:submit',
  /** The Myntra logins a dispute can be sent from. */
  accounts: 're-claim:accounts',
  /**
   * Disputes every ticket in the sheet, paced like a person.
   *
   * Separate from `submit` because it is a different decision: one is an
   * operator arguing a ticket, the other is committing the whole export.
   */
  bulk: 're-claim:bulk',
  /** The run in flight, or the last one, for a window that mounted after it began. */
  bulkStatus: 're-claim:bulk-status',
  /** Stops the run after the ticket in flight. */
  stop: 're-claim:stop'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const RE_CLAIM_EVENTS = {
  /** How far the bulk run has got, including the gap it is waiting out. */
  progress: 're-claim:progress'
} as const

/** The batch runs this machine has done — see shared/types/jobs.ts. */
export const JOB_CHANNELS = {
  /** Every job, newest first, across job types. */
  list: 'jobs:list',
  /** One job opened: what succeeded, and what did not and why. */
  detail: 'jobs:detail',
  /** The same two lists as an .xlsx, saved wherever the operator asks. */
  downloadReport: 'jobs:download-report',
  /**
   * Throw away the history for ONE kind of run, or for all of them.
   *
   * Per kind because the page is filtered per kind: an operator clearing the
   * list in front of them means that list, and a single "clear everything"
   * makes them destroy the record of runs they still need to be rid of the
   * noise from one.
   */
  clear: 'jobs:clear'
} as const

/** Backing AJIO's master data up locally — see shared/types/masterBackup.ts. */
export const MASTER_BACKUP_CHANNELS = {
  /** Whole months, chosen on the Settings card. */
  months: 'master-backup:months',
  /** An arbitrary date range, from the calendar. */
  sync: 'master-backup:sync',
  /** From the last date any sync covered, up to today. */
  sinceLast: 'master-backup:since-last',
  /** Which months and days are held — the calendar's green. */
  coverage: 'master-backup:coverage',
  /** One month's stored rows, for the viewer. */
  month: 'master-backup:month',
  /** Rows carrying an AWB or EAN — across both reports and every month. */
  search: 'master-backup:search',
  /** A pasted list of AWBs: the rows held, and the numbers that are not. */
  lookup: 'master-backup:lookup',
  /** Removes what is held for a date range. */
  remove: 'master-backup:delete',
  /** Everything held, as one zip of spreadsheets in Downloads. */
  export: 'master-backup:export',
  /** The same zip back — a merge, never a replace. */
  import: 'master-backup:import',
  /** Everything held for one report, deleted. Asks first, in the main process. */
  erase: 'master-backup:erase',
  /** The card's own settings: account, daily time, last run. */
  state: 'master-backup:state',
  saveState: 'master-backup:save-state'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const MASTER_BACKUP_EVENTS = {
  /** How far a backup has got — page by page, month by month. */
  progress: 'master-backup:progress',
  /**
   * A run that has ended, with what it found.
   *
   * Separate from the last progress tick because a backup runs in the
   * background: whoever started it may be on another page by the time it
   * finishes, and "it's done, here is what changed" has to arrive as its own
   * thing rather than as a bar reaching the end nobody was watching.
   */
  finished: 'master-backup:finished'
} as const

/**
 * The Snapdeal report backup — see shared/types/snapdealBackup.ts.
 *
 * TWO VERBS WHERE AJIO HAS ONE, because Snapdeal's reports are built
 * asynchronously: `request` asks for a window and comes back with nothing but
 * a receipt, `collect` goes and fetches whatever has finished building since.
 * Keeping them apart is what lets the card show "asked for, not yet arrived"
 * as a state of its own rather than as an absence of rows.
 */
export const SNAPDEAL_BACKUP_CHANNELS = {
  /** Ask Snapdeal for whole months, chosen on the card. */
  request: 'snapdeal-backup:request',
  /** Ask for one arbitrary date range, from the request calendar. */
  requestRange: 'snapdeal-backup:request-range',
  /** Download and store everything Snapdeal has finished building. */
  collect: 'snapdeal-backup:collect',
  /** Collect only the requests covering one date range — the manual fetch. */
  collectRange: 'snapdeal-backup:collect-range',
  /** Download and store ONE request's report, whatever its state — the row action. */
  collectRequest: 'snapdeal-backup:collect-request',
  /** Which months and days hold rows — the data calendar's green. */
  coverage: 'snapdeal-backup:coverage',
  /** Which days were ASKED FOR, and how far each request got. */
  requests: 'snapdeal-backup:requests',
  /** One month's stored rows, for the viewer. Fetches first if nothing is held. */
  month: 'snapdeal-backup:month',
  /** Rows carrying a sub-order, an AWB or a SKU. */
  search: 'snapdeal-backup:search',
  /** The one stored return for an AWB typed into Create Claim — exact match. */
  lookupAwb: 'snapdeal-backup:lookup-awb',
  /** Removes what is held for a date range. */
  remove: 'snapdeal-backup:delete',
  /** Everything held, deleted. Asks first, in the main process. */
  erase: 'snapdeal-backup:erase',
  /** Forgets request rows for a range, so the window can be asked for again. */
  forgetRequests: 'snapdeal-backup:forget-requests',
  /** The card's own settings: account, last run. */
  state: 'snapdeal-backup:state',
  saveState: 'snapdeal-backup:save-state',
  /** Every row held, as one zip of monthly spreadsheets in Downloads. */
  export: 'snapdeal-backup:export',
  /** A zip read back in — a merge; rows already held are skipped. */
  import: 'snapdeal-backup:import'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const SNAPDEAL_BACKUP_EVENTS = {
  /** How far a request or collect pass has got. */
  progress: 'snapdeal-backup:progress',
  /** A pass that has ended, with what it found. */
  finished: 'snapdeal-backup:finished'
} as const

/**
 * The Flipkart report backup — see shared/types/flipkartBackup.ts. Requesting
 * and collecting happen in the scheduled task (and its Run now), so the
 * renderer only reads.
 */
export const FLIPKART_BACKUP_CHANNELS = {
  /** What each report holds, and how many requests are still building. */
  state: 'flipkart-backup:state',
  /** The stored rows for an AWB typed into Create Claim, joined across both reports. */
  lookupAwb: 'flipkart-backup:lookup-awb',
  /** What one report holds, month by month and day by day — the chips and the coverage calendar. */
  coverage: 'flipkart-backup:coverage',
  /** One month of one report's stored rows, for the viewer. Fetches first if nothing is held. */
  month: 'flipkart-backup:month',
  /** Rows of one report carrying an order item, an AWB or a SKU. */
  search: 'flipkart-backup:search',
  /** One report's request calendar: the days asked for, painted by how far each got. */
  requestCoverage: 'flipkart-backup:request-coverage',
  /** Ask Flipkart for whole months of one report, chosen on the card. */
  request: 'flipkart-backup:request',
  /** Ask for one arbitrary date range of one report, from the request calendar. */
  requestRange: 'flipkart-backup:request-range',
  /** Download and store everything this account has finished building. */
  collect: 'flipkart-backup:collect',
  /** Collect only the outstanding requests covering one date range — the manual fetch. */
  collectRange: 'flipkart-backup:collect-range',
  /** Download and store one request's file, whatever state its row is in. */
  collectRequest: 'flipkart-backup:collect-request',
  /** Removes one report's rows for a date range. */
  remove: 'flipkart-backup:remove',
  /** Forgets one report's request rows for a range, so those windows can be asked again. */
  forgetRequests: 'flipkart-backup:forget-requests',
  /** One report's rows, deleted. The main process asks first. */
  erase: 'flipkart-backup:erase',
  /** The card's chosen account. */
  cardState: 'flipkart-backup:card-state',
  saveCardState: 'flipkart-backup:save-card-state',
  /** One report's rows, as one zip of monthly spreadsheets in Downloads. */
  export: 'flipkart-backup:export',
  /** A zip read back into one report — a merge; rows already held are skipped. */
  import: 'flipkart-backup:import'
} as const

/** "Refill Data" on the Claims page — see shared/types/refill.ts. */
export const CLAIM_REFILL_CHANNELS = {
  /**
   * Asks the marketplace for the blanks on the ticked claims — the account, the
   * sub-order number, the forward AWB, the ticket's current status — and writes
   * what it learns. Fills blanks; only the status overrides what is there.
   */
  run: 'claim-refill:run'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const CLAIM_REFILL_EVENTS = {
  /** How far a Refill run has got, claim by claim. */
  progress: 'claim-refill:progress',
  /**
   * How far a whole PASS has got — which marketplaces it will reach, which one
   * it is on, and what each has done. The claim-by-claim event above carries
   * the live detail for the one that is running.
   */
  pass: 'claim-refill:pass'
} as const

/** "Check TAT" on the Claims page — see shared/types/tatCheck.ts. */
export const CLAIM_TAT_CHANNELS = {
  /**
   * Asks the marketplace whether the ticked claims are still inside their claim
   * window, and files the ones that are not away as Failed to Proceed.
   *
   * A selection, not a sweep: it writes a terminal status, so it acts only on
   * rows an operator pointed at.
   */
  check: 'claim-tat:check'
} as const

/** A filed claim's ticket on the marketplace — see shared/types/ticketThread.ts. */
export const TICKET_THREAD_CHANNELS = {
  /** Reads the ticket: details, attachments, the comment thread. */
  open: 'ticket-thread:open',
  /** Uploads files and/or adds a comment, then reads the ticket again. */
  reply: 'ticket-thread:reply'
} as const

/**
 * The AJIO email auto-reply: the mailboxes, the two counts and one page of
 * emails (read), plus Refetch and Reply, which this app performs itself over
 * the mailbox's IMAP and SMTP. Mailboxes and templates stay in the web admin.
 */
export const EMAIL_REPLY_CHANNELS = {
  mailboxes: 'email-reply:mailboxes',
  counts: 'email-reply:counts',
  list: 'email-reply:list',
  /** One email's body and its latest reply, for the row an operator expands. Read-only. */
  details: 'email-reply:details',
  /** Reads one mailbox over IMAP here and hands the AJIO requests to TrackVid. */
  refetch: 'email-reply:refetch',
  /** Sends one reply over the mailbox's SMTP here; TrackVid builds and records it. */
  reply: 'email-reply:reply',
  /** Moves a mailbox's last-sync date, so the next fetch starts from there. */
  lastSync: 'email-reply:last-sync'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const CLAIM_TAT_EVENTS = {
  /** How far a Check TAT run has got, claim by claim. */
  progress: 'claim-tat:progress'
} as const

/** The nightly schedule — see shared/types/automationSchedule.ts. */
export const AUTOMATION_SCHEDULE_CHANNELS = {
  /** Every task: what it is, when it next runs, how the last run went. */
  state: 'automation-schedule:state',
  /** Turns one task on or off, or moves its time. One task per call. */
  save: 'automation-schedule:save',
  /**
   * Runs one task now, exactly as the schedule would.
   *
   * The same code path on purpose: a schedule that can only be tested by
   * waiting until 02:00 is a schedule nobody tests.
   */
  runNow: 'automation-schedule:run-now',
  /**
   * Which marketplaces Auto claim would file for, and how many claims each has
   * ready. Counted through the same gate the run files on.
   */
  autoClaimTargets: 'automation-schedule:auto-claim-targets',
  /** Puts every task back to the schedule the app ships with. */
  reset: 'automation-schedule:reset',
  /** Which marketplaces Refill Data would ask, and how many rows each has. */
  refillTargets: 'automation-schedule:refill-targets',
  /** Which marketplaces Status change would ask, and how many AWBs are due on each. */
  statusTargets: 'automation-schedule:status-targets',
  /**
   * Let a marketplace's retired rows back into the nightly refill.
   *
   * Three fruitless asks stops a row being asked about again. That was also
   * charged when the marketplace refused to LOOK — a rate limit, a 502 — so
   * rows were retired over the state of a gateway. The runner no longer does
   * that; this is how the ones it already retired get back in.
   */
  resetRefillAttempts: 'automation-schedule:reset-refill-attempts',
  /**
   * The master switch: stop the whole schedule, or start it again.
   *
   * Distinct from `save`, which turns ONE task on or off. This is "not now" for
   * all of them at once, and it survives a restart.
   */
  setPaused: 'automation-schedule:set-paused',
  /**
   * One task's execution history, newest first.
   *
   * Read from the local database rather than from whatever the scheduler holds
   * in memory: the rows outlive the process, and a crash is the case the
   * history exists to explain.
   */
  history: 'automation-schedule:history',
  /** The activity log: what the scheduler did, and what it decided not to do. */
  log: 'automation-schedule:log',
  /** Empties the log, both copies. */
  clearLog: 'automation-schedule:clear-log',
  /**
   * Passes over one failed run, on the operator's say-so, so the tasks behind
   * it can continue. Never automatic — see skipBlockedRun.
   */
  skip: 'automation-schedule:skip',
  /**
   * Cuts the RUNNING task short so the queue can move on to the next one.
   *
   * A different thing from `skip`, which passes over a run that already failed.
   * This one is about a run in progress and ends it at its next safe boundary —
   * see skipRunningTask.
   */
  skipRunning: 'automation-schedule:skip-running',
  /**
   * Pass over ONE marketplace on the task that is running, and carry on with
   * the rest. The narrow version of `skipRunning`, which abandons the lot.
   */
  skipPlatform: 'automation-schedule:skip-platform'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const AUTOMATION_SCHEDULE_EVENTS = {
  /** The whole schedule, whenever any of it changes. */
  state: 'automation-schedule:changed',
  /**
   * One activity-log line, as it is written.
   *
   * Pushed rather than polled: the log's whole purpose is to be watched while
   * something is running, and a scheduled run starts with nobody watching.
   */
  log: 'automation-schedule:log-entry'
} as const

/** The responsible-use notice, shown once per company — see terms.service. */
export const TERMS_CHANNELS = {
  /** Has this company accepted it? Read before the app is usable. */
  status: 'terms:status',
  /** Accepted — recorded, then the app opens. */
  accept: 'terms:accept',
  /** Declined — recorded, then the app closes. */
  decline: 'terms:decline'
} as const

export const CLAIM_CREATE_CHANNELS = {
  /**
   * The company's own catalogue — platforms, their claim types, the seller
   * accounts held for each. Read from the LOCAL company document, so the form
   * opens on a machine that has lost the network.
   */
  catalogue: 'claim-create:catalogue',
  /** Which platforms have a runner, so the toolbar can offer "Create Ticket". */
  automationPlatforms: 'claim-create:automation-platforms',
  /** The live claim already filed under an AWB on a platform, or null. */
  findByAwb: 'claim-create:find-by-awb',
  /** The seller account master data links to an AWB. */
  accountByAwb: 'claim-create:account-by-awb',
  /** The master-data rows behind an AWB — video links, sibling AWB, SKUs. */
  order: 'claim-create:order',
  /** The VMS screenshots captured against an AWB. */
  screenshots: 'claim-create:screenshots',
  /**
   * One stored order image's bytes, by key — for the six-side PDF, whose grid
   * holds VMS screenshots as keys rather than files. The renderer cannot fetch
   * them itself (`connect-src 'self'`), and is never handed a URL to fetch.
   */
  orderImage: 'claim-create:order-image',
  /** The SKU-code map for an AWB. */
  skuMap: 'claim-create:sku-map',
  /** One marketplace's master row for an order (Meesho / Snapdeal / Myntra). */
  masterOrderInfo: 'claim-create:master-order-info',
  /**
   * Forward AWB, SKU and owning account for a return AWB, asked of the
   * marketplace with saved sessions — the chosen account, or every account
   * when none is chosen. Never signs in.
   */
  returnAwbAutofill: 'claim-create:return-awb-autofill',
  /** The company's active capture feeds. */
  feeds: 'claim-create:feeds',
  /** Stores one image or the six-side PDF; answers with its S3 key. */
  uploadImage: 'claim-create:upload-image',
  /** Stores one recorded video. */
  storeVideo: 'claim-create:store-video',
  /**
   * Removes a stored file.
   *
   * Called when an operator clears an image slot they had already uploaded, so
   * the object does not outlive the claim that referenced it.
   */
  deleteFile: 'claim-create:delete-file',
  /**
   * Bulk Claim, the three steps of it.
   *
   * An operator uploads an Increff return report; `check` matches its rows
   * against what VMS recorded, `verify` asks each marketplace whether the claim
   * can be filed, and `create` files the ones that can. Three calls rather than
   * one because the operator decides between them — the middle step is what the
   * results table is showing.
   */
  bulkCheck: 'claim-create:bulk-check',
  bulkVerify: 'claim-create:bulk-verify',
  bulkCreate: 'claim-create:bulk-create',
  /**
   * Normal Bulk Claim: the per-platform template the operator fills, and the
   * filled workbook read back as rows of text. The claims themselves are filed
   * through `create`, one per row, exactly as the form files them.
   */
  bulkSheetTemplate: 'claim-create:bulk-sheet-template',
  /** Increff Bulk Claim: a blank QC report with the columns the backend reads. */
  bulkIncreffTemplate: 'claim-create:bulk-increff-template',
  /** Increff Bulk Claim: the Success / Failed results as an .xlsx the operator saves. */
  bulkIncreffResults: 'claim-create:bulk-increff-results',
  bulkSheetRead: 'claim-create:bulk-sheet-read',
  /**
   * Normal Bulk Claim's refill: the blanks on rows that are not claims yet —
   * local report backup first, then the marketplace. Writes nothing; the
   * answers come back to the renderer. See shared/types/bulkRefill.ts.
   */
  bulkRefill: 'claim-create:bulk-refill',
  /** Files the claim. */
  create: 'claim-create:create',
  /** Writes back to a claim that already exists. */
  update: 'claim-create:update'
} as const

/** Pushes from the main process. Disjoint from the invoke channels above. */
export const CLAIM_CREATE_EVENTS = {
  /** How far a bulk refill has got, row by row. */
  bulkRefillProgress: 'claim-create:bulk-refill-progress'
} as const

/** The Local Database page: this machine's JSON collections, read and edited row by row. */
export const LOCAL_DB_CHANNELS = {
  tables: 'local-db:tables',
  rows: 'local-db:rows',
  updateRow: 'local-db:update-row',
  deleteRow: 'local-db:delete-row',
  insertRow: 'local-db:insert-row'
} as const

/**
 * Closing the window while an automation runs: the app's own dialog, not the
 * operating system's. Main asks (`requested`), the page says it is showing
 * (`ack`) — without that, main falls back to the native box so the close is
 * never left unanswered — and the operator's choice comes back as `quit`.
 */
export const CLOSE_GUARD_CHANNELS = {
  ack: 'close-guard:ack',
  quit: 'close-guard:quit'
} as const

export const CLOSE_GUARD_EVENTS = {
  requested: 'close-guard:requested'
} as const

export const IPC_CHANNELS: readonly string[] = [
  ...Object.values(SYSTEM_CHANNELS),
  ...Object.values(CLOSE_GUARD_CHANNELS),
  ...Object.values(AUTH_CHANNELS),
  ...Object.values(UPDATE_CHANNELS),
  ...Object.values(PREFERENCES_CHANNELS),
  ...Object.values(PLATFORM_SESSION_CHANNELS),
  ...Object.values(CLAIM_QUEUE_CHANNELS),
  ...Object.values(DASHBOARD_CHANNELS),
  ...Object.values(IMPORT_SCHEDULE_CHANNELS),
  ...Object.values(COMPANY_CHANNELS),
  ...Object.values(BULK_SPF_CHANNELS),
  ...Object.values(NYKAA_BULK_DDR_CHANNELS),
  ...Object.values(CMS_LIST_CHANNELS),
  ...Object.values(CLAIM_RESOURCE_CHANNELS),
  ...Object.values(JOB_CHANNELS),
  ...Object.values(SKU_LOOKUP_CHANNELS),
  ...Object.values(MASTER_REPORT_CHANNELS),
  ...Object.values(RE_CLAIM_CHANNELS),
  ...Object.values(CLAIM_TAT_CHANNELS),
  ...Object.values(TICKET_THREAD_CHANNELS),
  ...Object.values(EMAIL_REPLY_CHANNELS),
  ...Object.values(CLAIM_REFILL_CHANNELS),
  ...Object.values(MASTER_BACKUP_CHANNELS),
  ...Object.values(SNAPDEAL_BACKUP_CHANNELS),
  ...Object.values(FLIPKART_BACKUP_CHANNELS),
  ...Object.values(AUTOMATION_SCHEDULE_CHANNELS),
  ...Object.values(TERMS_CHANNELS),
  ...Object.values(CLAIM_CREATE_CHANNELS),
  ...Object.values(LOCAL_DB_CHANNELS)
]

/** Channels the renderer may subscribe to. Deliberately disjoint from IPC_CHANNELS. */
export const EVENT_CHANNELS: readonly string[] = [
  ...Object.values(UPDATE_EVENTS),
  ...Object.values(CLOSE_GUARD_EVENTS),
  ...Object.values(BULK_SPF_EVENTS),
  ...Object.values(NYKAA_BULK_DDR_EVENTS),
  ...Object.values(CLAIM_QUEUE_EVENTS),
  ...Object.values(IMPORT_SCHEDULE_EVENTS),
  ...Object.values(SKU_LOOKUP_EVENTS),
  ...Object.values(CLAIM_TAT_EVENTS),
  ...Object.values(CLAIM_REFILL_EVENTS),
  ...Object.values(MASTER_BACKUP_EVENTS),
  ...Object.values(SNAPDEAL_BACKUP_EVENTS),
  ...Object.values(RE_CLAIM_EVENTS),
  ...Object.values(AUTOMATION_SCHEDULE_EVENTS),
  ...Object.values(PLATFORM_SESSION_EVENTS),
  ...Object.values(CLAIM_CREATE_EVENTS),
  ...Object.values(CMS_LIST_EVENTS)
]

export const isAllowedChannel = (channel: string): boolean => IPC_CHANNELS.includes(channel)

export const isAllowedEventChannel = (channel: string): boolean => EVENT_CHANNELS.includes(channel)
