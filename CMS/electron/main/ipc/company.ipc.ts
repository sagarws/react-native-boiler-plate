import { COMPANY_CHANNELS } from '@shared/constants/channels'
import { fail, ok } from '@shared/types/result'
import type { CompanyDocumentView } from '@shared/types/company'
import { readCompany } from '../services/company.store'
import { refreshCompany } from '../services/company.service'
import { registerHandler } from './handler'

/**
 * The locally-held company document, for inspection in Settings.
 *
 * REDACTED ON THE WAY OUT. The stored document holds marketplace passwords and
 * live session cookies; whoever holds those holds the seller accounts. The rest
 * of this app is careful never to put them in the renderer — the password goes
 * from the main process straight into a login window, and the Sessions page
 * shows cookie NAMES because the backend strips the values before they ever
 * arrive.
 *
 * A viewer that undid all that to render a nicer tree would be the weakest link
 * in the chain, so session secrets are replaced with a marker here, in the main
 * process, before the document crosses the bridge. The shape stays exactly as
 * Mongo holds it — every key, every nesting level — so the tree still answers
 * "is my session actually stored?" and "which credentials does this company
 * have?".
 *
 * THE PASSWORD IS THE EXCEPTION, and see SECRET_KEYS for why: it is the
 * operator's own credential, and the one field whose value they may need to
 * compare against what they changed at the marketplace.
 */

/**
 * Keys whose value is a secret wherever they appear.
 *
 * THE MARKETPLACE PASSWORD IS NOT ONE OF THEM ANY MORE, and the distinction is
 * deliberate. It is the operator's OWN credential for their OWN seller account,
 * already stored on this machine and already typed into a login window by this
 * app — hiding it from the person who owns it answered no threat, and left them
 * unable to check the one field that explains a sign-in failing ("is the stored
 * password the one I changed last week?"). The viewer shows it behind a click,
 * so it is readable without being on screen in every screenshot of this page.
 *
 * TOKENS AND JARS STAY. A session cookie or a bearer token is not a credential
 * somebody can recognise and correct — it is a live key to the account, useful
 * only to whoever takes it, and no question an operator asks of this page needs
 * one.
 */
const SECRET_KEYS = new Set(['csrfToken', 'token', 'accessToken', 'refreshToken'])

/** Keys holding a cookie jar, whose VALUES are secret but whose names are not. */
const JAR_KEYS = new Set(['jar', 'cookies'])

const REDACTED = '••••••••'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Cookie values out, cookie names kept.
 *
 * Two jar shapes exist: a name→value map (most platforms) and an array of
 * `{ name, value, domain }` (AJIO). Both are reduced to their names so the tree
 * can still show that a session has, say, 17 cookies including JSESSIONID.
 */
const redactJar = (jar: unknown): unknown => {
  if (Array.isArray(jar)) {
    return jar.map((cookie) =>
      isPlainObject(cookie) ? { ...cookie, value: REDACTED } : REDACTED
    )
  }

  if (isPlainObject(jar)) {
    return Object.fromEntries(Object.keys(jar).map((name) => [name, REDACTED]))
  }

  return jar
}

/**
 * Exported for its test. This is a security boundary — what it lets through is
 * what a renderer, and anything that can read a renderer, can see — so the rule
 * is pinned rather than reread.
 */
export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)

  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (SECRET_KEYS.has(key)) return [key, child === null || child === undefined ? child : REDACTED]
      if (JAR_KEYS.has(key)) return [key, redactJar(child)]

      return [key, redact(child)]
    })
  )
}

const view = async (): Promise<ReturnType<typeof ok<CompanyDocumentView>> | ReturnType<typeof fail>> => {
  const local = await readCompany()

  if (!local) {
    // Not an error: a machine with no keychain, or one that has not synced yet,
    // simply has nothing stored. The card says so rather than showing a failure
    // the operator cannot act on.
    return fail('NOT_FOUND', 'No company document is stored on this machine yet. Press Sync.')
  }

  const raw = local.company as { __v?: unknown; updatedAt?: unknown }

  return ok({
    fetchedAt: local.fetchedAt,
    document: redact(local.company) as Record<string, unknown>,
    version: {
      v: typeof raw.__v === 'number' ? raw.__v : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    }
  } satisfies CompanyDocumentView)
}

export const registerCompanyIpc = (): void => {
  // What is stored right now — no network. Used for the first paint.
  registerHandler(COMPANY_CHANNELS.document, () => view())

  // Goes to the server FIRST, then returns what was stored.
  //
  // Without this, the card's Reload button re-read the same local file and
  // could never show a change made in Monitor or in the database: the copy only
  // moved on a full Sync, so "reload" truthfully redrew stale data. A control
  // labelled Reload that cannot fetch is worse than no control — it looks like
  // the server agrees with what is on screen.
  registerHandler(COMPANY_CHANNELS.refresh, async () => {
    const refreshed = await refreshCompany()

    // A failed fetch is reported, but the stored copy is still shown: it is the
    // copy the automations will actually use, and hiding it because the network
    // is down would answer a different question than the one being asked.
    if (!refreshed.success) return refreshed

    return view()
  })
}
