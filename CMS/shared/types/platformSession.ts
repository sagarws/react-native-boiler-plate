/**
 * Capturing a marketplace login session from inside the app.
 *
 * Every platform's "api-based" automation is API-only for the claim work but
 * needs a real browser once, to sign in and mint a session. Rather than ship a
 * second Chromium, the app opens an Electron window at the platform's login
 * page, lets a human clear whatever it throws up (OTP, captcha, consent), then
 * harvests the cookies and hands them to the backend.
 */

/** A platform the app can capture a session for, as the backend knows it. */
export interface PlatformDescriptor {
  key: string
  label: string
  loginUrl: string
  /** Automation types this platform actually has: 'claim' | 'masterImport' | 'ticketDownload'. */
  automations: string[]
}

/** One cookie, in the shape /<platform>/ingest-session expects. */
export interface HarvestedCookie {
  name: string
  value: string
  domain: string
  // `| undefined` is required, not noise: the app compiles with
  // exactOptionalPropertyTypes, so an optional field will not accept undefined
  // unless it says so — and Electron's Cookie type has all of these optional.
  path?: string | undefined
  secure?: boolean | undefined
  httpOnly?: boolean | undefined
  /** Seconds since epoch, absent for a session cookie. */
  expirationDate?: number | undefined
}

export interface CaptureSessionInput {
  platform: string
  /** The marketplace username this session belongs to — the backend keys on it. */
  username: string
  /**
   * The credential's own id.
   *
   * Required by the server renew path: the same marketplace address can sit
   * under more than one company, so the id is the only unambiguous key.
   */
  credentialId?: string
  /**
   * How long to wait for a MANUAL sign-in before giving up, in ms.
   *
   * Omitted from the Sessions page on purpose: an operator pressed a button and
   * is sitting in front of the window, so there is nothing to time out. A CLAIM
   * that opens this window is different — it holds the automation lock while it
   * waits, so an unattended machine would block every other claim and the bulk
   * run behind a login page nobody is ever going to complete.
   */
  waitMs?: number
  /**
   * Nobody is watching — try the scripted sign-in, and never open a window.
   *
   * Set by the scheduled Session update, and it changes two things:
   *
   *   The company's per-platform auto-login switch IS consulted, and OFF means
   *   the account is skipped — a platform the company set to manual is never
   *   signed in by a schedule. The MACHINE's own
   *   MAIN_VITE_SESSION_UPDATE_AUTOMATICALLY applies as well — this computer's
   *   consent to drive a browser unattended.
   *
   *   A manual window is never opened. With nobody there it cannot be
   *   completed, so it would hold the run for its whole timeout and fail
   *   anyway; the account is reported by name instead, immediately.
   */
  unattended?: boolean
}

export interface CaptureSessionResult {
  platform: string
  username: string
  cookieCount: number
  /** What the backend said it stored the session as. */
  message: string
}

/** Why a capture ended without a session. */
export type CaptureFailureReason =
  | 'cancelled'
  | 'no-cookies'
  | 'ingest-rejected'
  | 'unknown-platform'
  | 'not-signed-in'

/**
 * Session health, as GET /api/cms/my-company-credentials reports it.
 *
 * The endpoint already existed for the browser extension and projects a summary
 * — never the cookie values themselves, only their names — for all eight
 * platforms. The desktop app reads the same DTO.
 */
export interface SessionSummary {
  savedAt: string | null
  expiresAt: string | null
  ip: string | null
  source: string | null
  hasProxySession: boolean
  cookieNames: string[]
  /**
   * When the marketplace itself refused this session, ISO — null when it never
   * has, or when a newer session has been captured since.
   *
   * The only fact here that is not a guess. Everything else on this record is
   * what was true at capture time; this is what the marketplace answered when
   * something actually tried to use it. See sessionRejection.store.
   */
  rejectedAt: string | null
  /** What the probe said, for the card that has to explain the red badge. */
  rejectedDetail: string | null
}

export interface CredentialRow {
  credentialId: string
  username: string
  accountType: string
  vendorCode: string
  isVerified: boolean
  /**
   * The marketplace refused this login's password (`is_verified: false` on the
   * company document). Set by the main process, which can tell that apart from
   * a login nobody has verified yet — `isVerified` above cannot. A refused
   * login is never signed in to automatically; the Login page still lists it.
   */
  refused?: boolean
  visible: boolean
  /** Last master-data sync for this credential, epoch ms. Null = never. */
  masterDataSync: number | null
  /**
   * Snapdeal, Flipkart and AJIO only: does signing in to this account cost a
   * one-time code?
   *
   * Both raise one on some seller accounts and not others — it is a setting on
   * the account, not a property of the marketplace — and nothing can work it
   * out without trying: an account that is never challenged spends the whole
   * OTP wait finding that out, and one that is, with nowhere to read the code
   * from, fails after the same wait talking about email.
   *
   * NULL means nobody has said, which is read as "attempt it" — the behaviour
   * every sign-in had before this existed. Null on every other platform, where
   * the answer does not vary by account.
   */
  isOtpBased: boolean | null
  /** Absent when the credential has never had a session captured. */
  session: SessionSummary | null
  /**
   * Tata CliQ only: the inbox Cloudflare Access mails this login's code to,
   * with the default already resolved. Absent on every other platform.
   */
  cloudflareEmail?: string
  /**
   * AJIO only: how many places of business this login can see, and when that
   * list was last swept.
   *
   * Shown on the sessions screen because a POB list is a precondition for most
   * of what AJIO can be asked — the claim search, account mapping, the SKU
   * picker and the report all refuse without one — and "never synced" is
   * otherwise invisible until one of them fails.
   */
  pobCount: number
  /** ISO timestamp, or null when the list has never been swept. */
  pobSyncedAt: string | null
  /**
   * Tata CliQ only: how many slaves this login can see, and when that list was
   * last swept.
   *
   * The same precondition POBs are for AJIO, and shown for the same reason: a
   * Tata CliQ return is visible only to the slave that owns it, so a claim
   * without the list has nothing to search under — and "never synced" is
   * otherwise invisible until a claim fails.
   */
  slaveCount: number
  /** ISO timestamp, or null when the list has never been swept. */
  slavesSyncedAt: string | null
  /**
   * Delhivery only: how many "Domestic" accounts (HQ clients) this login can
   * act on, and when that list was last written. With none, the claim form
   * falls back to EXPRESS / SURFACE.
   */
  domesticCount: number
  /** ISO timestamp, or null when the list has never been swept. */
  domesticsSyncedAt: string | null
}

/**
 * What the UI shows per credential.
 *
 * `expiring` is deliberately distinct from `active`: a session that dies in an
 * hour is still working, but an operator who can see that can re-capture it
 * before a batch fails halfway through rather than after.
 */
/**
 * `rejected` is not `expired`, and the difference is the whole point of it.
 *
 * Expired means a date has passed. Rejected means the marketplace was asked and
 * said no — which it does to sessions whose expiry is days away, after a login
 * elsewhere, a revocation, or an IP change. An operator looking at "Saved,
 * expires in 3 days" has no reason to re-capture; one looking at "Rejected"
 * has.
 */
export type SessionHealth = 'active' | 'expiring' | 'expired' | 'rejected' | 'none'

export interface PlatformCredentials {
  platform: string
  credentials: CredentialRow[]
  /**
   * Whether re-capturing this platform's session signs in by script rather than
   * asking the operator to type the password
   * (`settings.isAutoLoginOnActiveSession[platform]`, set in Trackvid-Monitor).
   *
   * Reports the behaviour the operator will actually get, not the stored value:
   * when the setting cannot be read the app attempts a scripted sign-in anyway,
   * so this reads true there too. A badge that said "manual" while the app went
   * on to auto-fill would be worse than no badge.
   */
  autoLogin: boolean
  /**
   * WHY it is not automatic, when it is not. Absent when it is.
   *
   * "Manual" on its own is a dead end: the operator cannot tell whether to
   * flip a switch in Monitor, install something, or wait for a build that can
   * drive this portal. Each of these names the one thing that would change it.
   *
   *   company    the company's auto-login switch is off for this platform.
   *              Also where the backend stops handing out the password, so
   *              this app genuinely cannot script the sign-in.
   *   machine    this installation has scripted sign-in turned off.
   *   no-script  this build has no form to drive for the platform — Tata
   *              CliQ, whose login needs a code from a mailbox only the
   *              server can read.
   */
  autoLoginBlockedBy?: 'company' | 'machine' | 'no-script'
  /**
   * Whether the server said anything about this platform at all.
   *
   * An absent bucket and an empty one mean different things: "this company has
   * no Snapdeal credentials" versus "this API build does not report Snapdeal".
   * Collapsing them lets an older backend look like missing data, which is
   * exactly the confusion this field exists to prevent.
   */
  reported: boolean
}



/**
 * A session captured on this machine that the backend has not accepted yet.
 *
 * Carries no secrets — the jar itself stays encrypted in the local store. This
 * is only what the UI needs to offer an Update button and say how old the
 * queued session is.
 */
export interface PendingSummary {
  platform: string
  platformLabel: string
  username: string
  credentialId: string
  capturedAt: string
  expiresAt: string | null
  cookieCount: number
}

/**
 * The newest one-time code in the mailbox for one account — what "Get OTP" on
 * the Login page shows an operator signing in by hand.
 */
export interface PeekedOtp {
  /** Null when the mailbox holds no code for this address. */
  otp: string | null
  /** When that mail arrived, ISO. Null when no code, or the mail has no date. */
  receivedAt: string | null
  /** The address that was searched — the credential's OTP email, or the login. */
  address: string
}
