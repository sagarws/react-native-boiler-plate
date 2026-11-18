import type { Result } from '@shared/types/result'
import { fail, ok } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { readCompany, saveCompany, patchCompany, type CompanyDocument } from './company.store'
import { forgetSessionRejected } from './sessionRejection.store'
import { logger } from './logger'
import { platformKey } from '@shared/utils/platformKey'

/**
 * The company document: fetched once, held locally, read from there.
 *
 * `GET /cms/company` returns the whole record. This app keeps an encrypted copy
 * and answers every question from it — which platforms run here, when the
 * import fires, a credential's password, a credential's session jar — instead
 * of a separate backend call per field.
 *
 * The copy is refreshed at sign-in and on Sync, and PATCHED whenever this app
 * changes something on the server, so it never lags a write it made itself.
 */

/** Where each platform parks its jar on a credential. */
const SESSION_FIELD: Record<string, string> = {
  myntra: 'myntraSession',
  flipkart: 'flipkartSession',
  ajio: 'ajioSession',
  snapdeal: 'snapdealSession',
  delhivery: 'delhiverySession',
  xbees: 'xbeesSession',
  meesho: 'meeshoSession',
  nykaa: 'nykaaSession',
  // The core's platform registry carries the same `sessionField` and is the
  // source of truth; this map is its main-process copy. A platform missing
  // here is not an error anywhere — `rememberCompanySession` simply returns,
  // so the local company document never receives that platform's session and
  // nothing says why.
  tatacliq: 'tatacliqSession'
}

/** One AJIO place of business, as the company document stores it. */
/**
 * One Tata CliQ slave, as stored on the credential.
 *
 * Both labels are kept because a claim row names a slave in either form and
 * neither can be derived from the numeric id: `name` is what the portal shows
 * ("wms-prozo-blr (129602-1101225062)"), `code` the bracketed part on its own,
 * which is what a seller's own paperwork tends to carry.
 */
export interface SlaveRecord {
  id: string
  name: string
  code: string | null
  /** When this slave was first seen on the credential. Null on older rows. */
  addedAt: string | null
  /** When a claim was last resolved under it. Null until one has been. */
  lastUsed: string | null
}

/**
 * One Delhivery "Domestic" account (an HQ client), as stored on the credential.
 *
 * `name` is the `hq_client_name` the portal's "Domestic" switcher shows and the
 * claim form offers; `id` is the HQ client it means (`cms::client::<uuid>`).
 * Written by `syncDelhiveryDomestics` straight after a session update.
 */
export interface DomesticRecord {
  id: string
  name: string
  serviceType: string | null
  addedAt: string | null
}

export interface PobRecord {
  id: string
  /** When this POB was first seen on the credential. Null on rows that predate the field. */
  addedAt: string | null
  /**
   * When account mapping last resolved a claim under it. Null until one has
   * been. It is what orders the next search — see `orderedPobIds`.
   */
  lastUsed: string | null
}

export interface CredentialRecord {
  credentialId: string
  username: string
  password: string
  /**
   * Snapdeal, Flipkart and AJIO: does this account's sign-in raise a one-time code?
   * Null where nobody has said, which is read as "attempt it".
   */
  isOtpBased: boolean | null
  /**
   * Where this account's one-time codes are emailed, when that is not the login
   * id itself. The automation server has always read it; the desktop needs it
   * too now that it can read the mailbox itself — a code looked for under the
   * wrong address is a login that fails for no visible reason.
   */
  otpEmail: string
  /**
   * Tata CliQ only: the inbox Cloudflare Access mails its login code to. Empty
   * means the core's default (`cloudflareOTP.DEFAULT_TO`).
   */
  cloudflareEmail: string
  accountType: string
  vendorCode: string
  isVerified: boolean
  /** The stored jar, as the platform's own session shape. Null when never captured. */
  session: Record<string, unknown> | null
  /**
   * AJIO only: the places of business this login can see, written by Monitor's
   * "Sync POBs" and read from here rather than re-fetched.
   *
   * Empty for every other platform, and for an AJIO account nobody has synced.
   */
  pobIds: PobRecord[]
  /** When that list was last swept. Null means never. */
  pobSyncedAt: string | null
  /**
   * Tata CliQ only: the slaves (warehouses) this login can see, written by
   * "Sync slaves" and read from here rather than re-fetched.
   *
   * A Tata CliQ return is visible only to the slave that owns it, and the
   * portal's pick is server-side session state — so this is a precondition for
   * filing, in the same way a POB is for AJIO. Empty for every other platform,
   * and for a Tata CliQ account nobody has synced.
   */
  slaves: SlaveRecord[]
  /** When that list was last swept. Null means never. */
  slavesSyncedAt: string | null
  /**
   * Delhivery only: the "Domestic" accounts this login can act on. Empty for
   * every other platform, and for a Delhivery login not yet synced — the claim
   * form then falls back to EXPRESS / SURFACE.
   */
  domestics: DomesticRecord[]
  /** When that list was last written. Null means never. */
  domesticsSyncedAt: string | null
  /**
   * AJIO only: an enterprise-level seller account, which sits on a DIFFERENT
   * POB endpoint. Nothing in AJIO's login response reports which kind an
   * account is, so it is set by an operator in Monitor and read from here.
   *
   * The stored key is `IsEnterPriceLevel` — capital I, "Price" not "Prise" —
   * kept verbatim because renaming it needs a migration, not an edit.
   */
  isEnterpriseLevel: boolean
}

const asDate = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) return value
  if (value instanceof Date) return value.toISOString()

  return null
}

/**
 * The stored POB list, in either shape it has ever had.
 *
 * Entries were bare strings until 2026-09-09 and objects since. An unmigrated
 * credential is not a broken one — it simply has no dates — so both are read
 * and the missing dates come back null rather than invented.
 */
/**
 * The stored slaves, most recently useful first.
 *
 * Ordered by `lastUsed` for the same reason `orderedPobIds` is: a claim
 * searches one slave at a time until one owns the return, and claims arrive in
 * batches from the same warehouse — so trying the most recently successful one
 * first turns several requests into roughly one.
 */
export const slavesOf = (account: Record<string, unknown>): SlaveRecord[] => {
  const raw = Array.isArray(account.slaves) ? account.slaves : []

  return raw
    .map((entry): SlaveRecord | null => {
      if (!entry || typeof entry !== 'object') return null

      const record = entry as Record<string, unknown>
      const id = asText(record.id).trim()
      const name = asText(record.name).trim()

      // Both are required: the id is what `setSession` takes, the name is what
      // a claim row is matched against. A half-slave would fail mid-claim.
      if (!id || !name) return null

      return {
        id,
        name,
        code: asText(record.code).trim() || null,
        addedAt: asDate(record.addedAt),
        lastUsed: asDate(record.lastUsed)
      }
    })
    .filter((entry): entry is SlaveRecord => entry !== null)
    .sort((a, b) => {
      // Never used sorts last, which is what makes the first candidate the
      // best one rather than merely the first stored.
      if (!a.lastUsed && !b.lastUsed) return 0
      if (!a.lastUsed) return 1
      if (!b.lastUsed) return -1

      return Date.parse(b.lastUsed) - Date.parse(a.lastUsed)
    })
}

/** The stored Delhivery Domestic list, in stored order; an entry missing its id or name is dropped. */
export const domesticsOf = (account: Record<string, unknown>): DomesticRecord[] => {
  const raw = Array.isArray(account.domestics) ? account.domestics : []

  return raw
    .map((entry): DomesticRecord | null => {
      if (!entry || typeof entry !== 'object') return null

      const record = entry as Record<string, unknown>
      const id = asText(record.id).trim()
      const name = asText(record.name).trim()

      return id && name
        ? { id, name, serviceType: asText(record.serviceType).trim() || null, addedAt: asDate(record.addedAt) }
        : null
    })
    .filter((entry): entry is DomesticRecord => entry !== null)
}

export const pobsOf = (account: Record<string, unknown>): PobRecord[] => {
  const raw = Array.isArray(account.pobIds) ? account.pobIds : []

  return raw
    .map((entry): PobRecord | null => {
      if (typeof entry === 'string') {
        const id = entry.trim()

        return id ? { id, addedAt: null, lastUsed: null } : null
      }

      if (!entry || typeof entry !== 'object') return null

      const record = entry as Record<string, unknown>
      const id = asText(record.id).trim()

      return id ? { id, addedAt: asDate(record.addedAt), lastUsed: asDate(record.lastUsed) } : null
    })
    .filter((entry): entry is PobRecord => entry !== null)
}

/**
 * The order to search a credential's places of business in.
 *
 * Most recently successful first. A seller can hold sixty POBs and only one of
 * them owns any given AWB, so searching in storage order is sixty requests per
 * claim — while claims arrive in batches from the same warehouse, which makes
 * the POB that answered last time overwhelmingly the one that answers next.
 *
 * Ties fall back to most-recently-added, then to stored order: a POB that has
 * never been used but appeared on the account yesterday is a better guess than
 * one that has sat there unused for a year.
 */
export const orderedPobIds = (pobs: PobRecord[]): string[] => {
  const stamp = (value: string | null): number => (value ? Date.parse(value) || 0 : 0)

  return [...pobs]
    .sort((a, b) => stamp(b.lastUsed) - stamp(a.lastUsed) || stamp(b.addedAt) - stamp(a.addedAt))
    .map(pob => pob.id)
}

/** When a stored session record was made. 0 when it cannot be read. */
const capturedAtOf = (session: unknown): number => {
  if (!session || typeof session !== 'object') return 0

  const record = session as Record<string, unknown>
  // `capturedAt` is what this app writes; `savedAt` is what the marketplace
  // stores write. Either answers "how old is this session".
  const stamp = asText(record.capturedAt) || asText(record.savedAt)

  return stamp ? Date.parse(stamp) || 0 : 0
}

/**
 * Keeps a session this machine captured more recently than the one the
 * document being installed carries.
 *
 * WHY A REFRESH CAN LOSE A SESSION. `refreshCompany` replaces the local copy
 * wholesale, and the local copy is the record every automation reads. A capture
 * writes the new session to the server AND patches it in locally, because the
 * next claim must not run on the jar that was just replaced. If a refresh lands
 * between the capture and that claim, and the server's document has not yet
 * caught up, the fresh session is simply gone — overwritten by the older one it
 * had just replaced.
 *
 * That is not hypothetical. A Myntra login was captured at 06:02:10 and stored;
 * a routine refresh at 06:02:57 returned a document last written at 03:23:52,
 * nearly three hours earlier; and Auto claim at 06:03:04 probed the restored
 * jar, was told by Myntra it was anonymous, and skipped the account's claims —
 * forty seconds after an operator watched the sign-in succeed. Re-capturing
 * repeated the whole cycle.
 *
 * STRICTLY NEWER WINS, and the server wins ties. This is not an attempt to
 * out-guess the server about anything else in the document: it applies only to
 * session records, only where the local one is provably more recent, and every
 * other field the response carries is installed as-is.
 */
const preserveNewerSessions = async (incoming: CompanyDocument): Promise<CompanyDocument> => {
  const held = await readCompany()

  if (!held) return incoming

  let kept = 0

  for (const bucket of bucketsOf(incoming)) {
    const field = SESSION_FIELD[platformKey(asText(bucket.eComPlatform))]

    if (!field) continue

    const localBucket = bucketsOf(held.company).find((entry) =>
      matchesPlatform(entry.eComPlatform, asText(bucket.eComPlatform))
    )
    const localInfo = Array.isArray(localBucket?.info)
      ? (localBucket.info as Record<string, unknown>[])
      : []
    const info = Array.isArray(bucket.info) ? (bucket.info as Record<string, unknown>[]) : []

    for (const account of info) {
      const username = asText(account.username).trim().toLowerCase()
      const local = localInfo.find(
        (entry) => asText(entry.username).trim().toLowerCase() === username
      )

      if (!local?.[field]) continue
      if (capturedAtOf(local[field]) <= capturedAtOf(account[field])) continue

      account[field] = local[field]
      kept += 1
    }
  }

  if (kept > 0) {
    logger.info(
      `Kept ${kept} session(s) captured on this machine — the refreshed document carried older ones`
    )
  }

  return incoming
}

/**
 * Fetches the document and replaces the local copy, EXCEPT for sessions this
 * machine captured more recently than the ones it brings back.
 */
export const refreshCompany = async (): Promise<Result<CompanyDocument>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to load the company')

  const response = await apiRequest<CompanyDocument>('/cms/company', { token })

  if (!response.success) {
    // Keep whatever copy is already held: a transient read failure must not
    // leave the app with less than it had a minute ago.
    logger.warn('Could not refresh the company document', response.error)

    return response
  }

  await saveCompany(await preserveNewerSessions(response.data))

  // The fingerprint, not just "ok". Mongo bumps `__v` and `updatedAt` on every
  // write, so these two answer "did this Sync actually move the copy forward?"
  // — a question that otherwise needs two screenshots side by side.
  const doc = response.data as { __v?: unknown; updatedAt?: unknown }
  const version = typeof doc.__v === 'number' ? doc.__v : '?'
  const updatedAt = typeof doc.updatedAt === 'string' ? doc.updatedAt : '?'

  logger.info(`Company document refreshed (__v=${version}, updatedAt=${updatedAt})`)

  return response
}

/**
 * The company document — local copy first, fetched only when there is none.
 *
 * Local-first is deliberate here, and the opposite of `withOfflineCache`. That
 * cache serves lists the UI renders, where a stale answer while the network was
 * available would be a bug. This is the record automations run from, is patched
 * on every write this app makes, and is refreshed on Sync — so reading it is
 * reading what this machine last agreed with the server, not a guess.
 */
export const company = async (): Promise<Result<CompanyDocument>> => {
  const local = await readCompany()

  if (local) return ok(local.company)

  return refreshCompany()
}

/**
 * Text out of a document read as `unknown`.
 *
 * `String(value)` would turn a plain object into the literal "[object Object]"
 * and store it as a username. Mongo values that ARE meaningful as text —
 * ObjectId above all — carry their own toString; anything still relying on
 * Object.prototype's is not text and becomes "".
 */
const asText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (value && typeof value === 'object') {
    const own = (value as { toString?: unknown }).toString

    if (typeof own === 'function' && own !== Object.prototype.toString) {
      return (value as { toString: () => string }).toString()
    }
  }

  return ''
}

const settingsOf = (doc: CompanyDocument): Record<string, unknown> =>
  (doc.settings as Record<string, unknown>) ?? {}

const bucketsOf = (doc: CompanyDocument): Record<string, unknown>[] => {
  const raw = settingsOf(doc).eCommercePlatformLoginInfo

  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
}

const matchesPlatform = (stored: unknown, platform: string): boolean =>
  // Canonicalised on BOTH sides, which is what the alias table used to do for
  // the stored side only. It also covers a spelling the table could not: the
  // caller's own, when it arrives as a label ("Tata CliQ") or as a stored
  // two-word name ("tata cliq") rather than a registry key.
  platformKey(asText(stored)) === platformKey(platform)

/**
 * Apply a verification verdict to the LOCAL company copy.
 *
 * WHY THIS IS NOT OPTIONAL. The local copy is "the record automations run
 * from… patched on every write this app makes" — see `company()`. A verdict
 * written only to the backend leaves every automation on this machine reading
 * the old flag until the next Sync, which is hours away. The whole feature is
 * "stop using a password the marketplace refused", and without this the app
 * goes on using it while the server and the screen both say otherwise.
 *
 * Matched the way the rest of this file matches: the platform canonicalised on
 * both sides, the username trimmed and compared without case. The backend
 * matches the username EXACTLY, so the two can disagree — and when they do it
 * is this one that should be the forgiving one: a local copy that patched the
 * wrong row would be corrected by the next Sync, while refusing to patch leaves
 * the automations wrong until then.
 */
export const applyVerdictLocally = async (
  platform: string,
  username: string,
  isVerified: boolean
): Promise<boolean> =>
  patchCompany((doc) => {
    const wanted = username.trim().toLowerCase()
    const bucket = bucketsOf(doc).find((entry) =>
      matchesPlatform(entry.eComPlatform, platform)
    )
    const info = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []
    const account = info.find((entry) => asText(entry.username).trim().toLowerCase() === wanted)

    if (!account) return null

    account.is_verified = isVerified

    return doc
  })

/**
 * A credential the marketplace has refused, which nothing should try again.
 *
 * `is_verified` is set to false when a marketplace says the password is wrong
 * — Snapdeal's "Invalid Username or Password", AJIO's and Myntra's equivalents.
 * Until somebody updates the password, every sign-in with it fails, and each
 * attempt costs a browser session, a refill budget, or a claim's retry count.
 *
 * COMPARED AGAINST `false`, NEVER `!== true`, and this is the whole subtlety.
 * The field was added later, so most credentials do not carry it at all, and
 * absent means "nobody has said" — not "refused". Reading absent as unverified
 * would stop every automation on every legacy account at once. The core's
 * `filterUnverifiedCredentials` has made the same distinction for months; this
 * is that rule, applied where the desktop app reads its credentials.
 *
 * READ FROM THE COMPANY DOCUMENT, which still has the raw field. The
 * credentials ENDPOINT collapses absent into false on the way out, so the same
 * rule cannot be applied to its output — a reason to keep this here and not
 * move it.
 */
const refusedByMarketplace = (account: Record<string, unknown>): boolean =>
  account.is_verified === false

/**
 * The usernames (lower-case) of a platform's logins the marketplace has
 * refused — `is_verified === false` on the RAW document, where absent still
 * means "nobody has said". Empty when there are none or the copy is unreadable.
 *
 * For the session-health rows, whose endpoint collapses absent into false and
 * so cannot answer this itself.
 */
export const refusedLogins = async (platform: string): Promise<Set<string>> => {
  const doc = await company()

  if (!doc.success) return new Set()

  const key = platformKey(platform)
  const bucket = bucketsOf(doc.data).find((b) => matchesPlatform(b.eComPlatform, key))
  const all = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []

  return new Set(
    all.filter(refusedByMarketplace).map((account) => asText(account.username).trim().toLowerCase())
  )
}

/**
 * Every credential this company holds for a platform, jars included.
 *
 * WITHOUT THE ONES THE MARKETPLACE HAS REFUSED, unless a caller asks for them.
 * Every automation path runs through here — claims, refills, account mapping,
 * the session update — so excluding them once is what makes "ignore unverified
 * logins" true everywhere rather than in the handful of places that remembered.
 *
 * `includeRefused` is for the screens that must show them: the Login page
 * lists a refused account precisely so somebody can fix it.
 */
export const credentialsFor = async (
  platform: string,
  { includeRefused = false }: { includeRefused?: boolean } = {}
): Promise<CredentialRecord[]> => {
  const doc = await company()

  if (!doc.success) return []

  const key = platformKey(platform)
  const field = SESSION_FIELD[key]
  const bucket = bucketsOf(doc.data).find((b) => matchesPlatform(b.eComPlatform, key))
  const all = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []
  const info = includeRefused ? all : all.filter((account) => !refusedByMarketplace(account))

  if (info.length !== all.length) {
    logger.info(
      `[credentials] ${key}: leaving out ${all.length - info.length} login(s) the marketplace ` +
        'has refused — update the password to bring them back'
    )
  }

  return info.map((account) => {
    const session = field ? account[field] : null

    return {
      credentialId: asText(account._id),
      username: asText(account.username),
      password: asText(account.password),
      otpEmail: asText(account.otpEmail),
      cloudflareEmail: asText(account.cloudflareEmail),
      isOtpBased: typeof account.isOtpBased === 'boolean' ? account.isOtpBased : null,
      accountType: asText(account.accountType),
      vendorCode: asText(account.vendorCode),
      isVerified: account.is_verified === true,
      session: session && typeof session === 'object' ? (session as Record<string, unknown>) : null,
      pobIds: pobsOf(account),
      pobSyncedAt: asDate(account.pobSyncedAt),
      slaves: slavesOf(account),
      slavesSyncedAt: asDate(account.slavesSyncedAt),
      domestics: domesticsOf(account),
      domesticsSyncedAt: asDate(account.domesticsSyncedAt),
      isEnterpriseLevel: account.IsEnterPriceLevel === true
    }
  })
}

/** One credential, by username. */
export const credentialFor = async (
  platform: string,
  username: string
): Promise<CredentialRecord | null> => {
  const wanted = username.trim().toLowerCase()

  return (
    (await credentialsFor(platform)).find((c) => c.username.trim().toLowerCase() === wanted) ?? null
  )
}

/**
 * Records that a claim was found under this POB, in the local copy.
 *
 * The backend stamps the same thing on the company document; this keeps the
 * local one in step so the NEXT claim in the very same run searches in the
 * improved order rather than waiting for a Sync. Without it the ordering would
 * only take effect the day after it was learned, which is most of the value
 * gone — the sweep it shortens is the one happening right now.
 *
 * Best effort, exactly as the server's stamp is: a missed stamp costs a longer
 * search, and nothing else.
 */
export const rememberPobUsed = async (
  platform: string,
  username: string,
  pobId: string,
  at: string
): Promise<void> => {
  const key = platformKey(platform)

  await patchCompany((doc) => {
    const bucket = bucketsOf(doc).find((b) => matchesPlatform(b.eComPlatform, key))
    const info = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []
    const account = info.find(
      (a) => asText(a.username).trim().toLowerCase() === username.trim().toLowerCase()
    )

    if (!account || !Array.isArray(account.pobIds)) return null

    const entry = (account.pobIds as unknown[]).find(
      (pob) => pob !== null && typeof pob === 'object' && asText((pob as Record<string, unknown>).id) === pobId
    ) as Record<string, unknown> | undefined

    // A legacy string entry has no field to stamp. Not an error — the next
    // Sync POBs rewrites the list as objects and it starts working.
    if (!entry) return null

    entry.lastUsed = at

    return doc
  })
}

/**
 * Records a session this app just wrote to the backend, in the local copy.
 *
 * Without this the local document would still show the OLD jar until the next
 * Sync, and an automation reading it straight after a re-capture would use the
 * session that was just replaced — the one most likely to be dead.
 */
export const rememberCompanySession = async (
  platform: string,
  username: string,
  session: Record<string, unknown>
): Promise<void> => {
  const key = platformKey(platform)
  const field = SESSION_FIELD[key]

  // BEFORE the patch, and whether or not there is a local credential to attach
  // the session to: a rejection that outlived the session it was about is a
  // permanently red account that re-capturing cannot clear.
  await forgetSessionRejected(key, username)

  if (!field) return

  const patched = await patchCompany((doc) => {
    const bucket = bucketsOf(doc).find((b) => matchesPlatform(b.eComPlatform, key))
    const info = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []
    const account = info.find(
      (a) => asText(a.username).trim().toLowerCase() === username.trim().toLowerCase()
    )

    // No local credential to attach it to — the next refresh will bring both.
    if (!account) return null

    account[field] = session

    return doc
  })

  if (patched) logger.info(`Updated the local ${platform} session for ${username}`)
}

/**
 * Drops a session from the local copy of the company document.
 *
 * THE MIRROR OF `rememberCompanySession`, and it exists for the same reason:
 * the automations read the LOCAL document, so a session cleared only on the
 * server would go on being used here until the next Sync — and it is precisely
 * the jar we have just been told not to use.
 *
 * `is_verified` goes with it. That flag is what says a stored session may be
 * used; leaving it true over a jar that is gone describes a session that does
 * not exist.
 *
 * @param platform  a platform key, or undefined for EVERY platform
 * @param username  a username, or undefined for every credential
 */
export const forgetCompanySession = async (
  platform?: string,
  username?: string
): Promise<void> => {
  const key = platform ? platformKey(platform) : null
  const name = username?.trim().toLowerCase()

  const patched = await patchCompany((doc) => {
    let changed = false

    for (const bucket of bucketsOf(doc)) {
      if (key && !matchesPlatform(bucket.eComPlatform, key)) continue

      // The field belongs to the BUCKET's platform, not to the argument: a
      // clear-all passes no platform, and each bucket names its own.
      const field = SESSION_FIELD[platformKey(asText(bucket.eComPlatform))]

      if (!field) continue

      const info = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []

      for (const account of info) {
        if (name && asText(account.username).trim().toLowerCase() !== name) continue
        if (account[field] === undefined && account.is_verified !== true) continue

        delete account[field]
        account.is_verified = false
        changed = true
      }
    }

    return changed ? doc : null
  })

  if (patched) {
    logger.info(
      `Cleared the local ${platform ?? 'marketplace'} session(s) for ${username ?? 'every account'}`
    )
  }
}

/**
 * Records on the LOCAL copy whether a credential's sign-in costs a code.
 *
 * Written straight after the server accepts it, for the same reason the session
 * is: the next sign-in reads the local document, and a setting that only took
 * effect after the next Sync would be a setting nobody could trust.
 */
export const rememberOtpMode = async (
  platform: string,
  credentialId: string,
  isOtpBased: boolean
): Promise<void> => {
  const key = platformKey(platform)

  const patched = await patchCompany((doc) => {
    const bucket = bucketsOf(doc).find((b) => matchesPlatform(b.eComPlatform, key))
    const info = Array.isArray(bucket?.info) ? (bucket.info as Record<string, unknown>[]) : []
    const account = info.find((a) => asText(a._id) === credentialId)

    if (!account) return null

    account.isOtpBased = isOtpBased

    return doc
  })

  if (patched) logger.info(`Updated the local ${platform} OTP mode for ${credentialId}`)
}

/**
 * The local company copy's `settings.isAutoLoginOnActiveSession.<platform>`,
 * after the Sign-in switch on the Login page has changed it on the server.
 *
 * Written here as well so the record in Settings → Company data says what the
 * server now says without waiting for the next "Refresh from server" — the
 * same reason `rememberOtpMode` writes the OTP switch locally.
 */
export const rememberAutoLogin = async (platform: string, enabled: boolean): Promise<void> => {
  const key = platformKey(platform)

  const patched = await patchCompany((doc) => {
    const settings = (doc.settings ?? {}) as Record<string, unknown>
    const current = settings.isAutoLoginOnActiveSession
    const flags =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {}

    flags[key] = enabled
    settings.isAutoLoginOnActiveSession = flags
    doc.settings = settings

    return doc
  })

  if (patched) logger.info(`Updated the local ${key} automatic sign-in to ${enabled ? 'on' : 'off'}`)
}
