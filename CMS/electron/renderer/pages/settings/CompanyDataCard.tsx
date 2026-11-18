import { useCallback, useEffect, useMemo, useState } from 'react'
import { COMPANY_CHANNELS } from '@shared/constants/channels'
import type { CompanyDocumentView } from '@shared/types/company'
import { Button } from '@renderer/components/ui/Button'
import { invoke } from '@renderer/services/ipcClient'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'
import { onSessionsChanged } from '@renderer/services/sessionEvents'

/**
 * The company document this machine holds, as a tree.
 *
 * Answers the questions a settings page is actually asked when something looks
 * wrong: is my session stored, which credentials does this company have, what
 * is `desktopExecution` set to right now. Those live in one nested document, so
 * the honest way to show it is the document — not a flattened summary that
 * quietly omits the field someone came to check.
 *
 * SESSION SECRETS ARE ALREADY GONE. The main process replaces tokens and cookie
 * values before this ever receives them; cookie NAMES survive, so a session
 * still reads as "17 cookies including JSESSIONID".
 *
 * THE MARKETPLACE PASSWORD IS NOT ONE OF THEM, by request: it is the operator's
 * own credential for their own seller account, and the field whose value
 * answers "is the stored password the one I changed last week?". It prints like
 * any other string. Worth knowing when this page is screenshotted or
 * screen-shared, which is what people do with it when something looks wrong —
 * see SECRET_KEYS in main/ipc/company.ipc.ts for what still does not cross.
 */

type Json = unknown

const isObject = (value: Json): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBranch = (value: Json): boolean =>
  (isObject(value) && Object.keys(value).length > 0) || (Array.isArray(value) && value.length > 0)

/** What a collapsed branch says about itself, so it need not be opened to be understood. */
const summarise = (value: Json): string => {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`

  const keys = Object.keys(value as Record<string, Json>)

  return `${keys.length} ${keys.length === 1 ? 'field' : 'fields'}`
}

/**
 * A leaf, coloured by type.
 *
 * Type is the fastest thing to check by eye — a `"true"` that should be `true`,
 * or a date stored as a string, is invisible in uniform text and obvious when
 * booleans are one colour and strings another.
 */
const Leaf = ({ value }: { value: Json }): React.JSX.Element => {
  if (value === null) return <span className="text-faint italic">null</span>
  if (value === undefined) return <span className="text-faint italic">undefined</span>

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-success-fg' : 'text-code-boolean'}>{String(value)}</span>
    )
  }

  if (typeof value === 'number') return <span className="text-code-number">{value}</span>

  // `isBranch` is false for an EMPTY object or array, so both land here. Left
  // to String() they would read as "[object Object]" — shown as what they are.
  if (Array.isArray(value)) return <span className="text-faint">[ ]</span>
  if (typeof value === 'object') return <span className="text-faint">{'{ }'}</span>

  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''

  // The redaction marker earns its own treatment: it is not data, and reading
  // it as a value ("the password is bullets") would be worse than saying so.
  if (text === '••••••••') {
    return (
      <span className="rounded bg-canvas px-1.5 py-0.5 text-2xs font-medium tracking-wide text-muted">
        hidden
      </span>
    )
  }

  if (text === '') return <span className="text-faint italic">empty</span>

  return <span className="break-all text-code-string">&quot;{text}&quot;</span>
}

interface NodeProps {
  label: string
  value: Json
  depth: number
  /** Path from the root, so open/closed survives a refresh of the same document. */
  path: string
  open: Set<string>
  toggle: (path: string) => void
}

const Node = ({ label, value, depth, path, open, toggle }: NodeProps): React.JSX.Element => {
  const branch = isBranch(value)
  const expanded = open.has(path)
  const entries: (readonly [string, Json])[] = branch
    ? Array.isArray(value)
      ? value.map((child, index): readonly [string, Json] => [String(index), child])
      : Object.entries(value as Record<string, Json>)
    : []

  return (
    <li>
      <div
        // Indent with padding rather than nested margins so the hover band and
        // the focus ring still span the full row at every depth.
        style={{ paddingLeft: `${depth * 14}px` }}
        className="group flex items-start gap-2 rounded py-1 pr-2 hover:bg-surface-hover"
      >
        {branch ? (
          <button
            type="button"
            onClick={() => toggle(path)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-subtle hover:text-body"
          >
            <svg
              viewBox="0 0 12 12"
              className={`h-2.5 w-2.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            >
              <path d="M4 2.5 8 6l-4 3.5z" fill="currentColor" />
            </svg>
          </button>
        ) : (
          // Keeps leaves aligned with their siblings' labels rather than with
          // the chevron column.
          <span className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        <span className="shrink-0 font-medium text-body">{label}</span>

        {branch ? (
          <button
            type="button"
            onClick={() => toggle(path)}
            className="text-faint transition-colors hover:text-textSecondary"
          >
            {Array.isArray(value) ? '[ ]' : '{ }'}{' '}
            <span className="text-2xs">{summarise(value)}</span>
          </button>
        ) : (
          <>
            <span className="text-disabled">:</span>
            <Leaf value={value} />
          </>
        )}
      </div>

      {branch && expanded ? (
        <ul className="m-0 list-none">
          {entries.map(([key, child]) => (
            <Node
              key={`${path}.${key}`}
              label={key}
              value={child}
              depth={depth + 1}
              path={`${path}.${key}`}
              open={open}
              toggle={toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** Every branch path in the document, for Expand all. */
const allPaths = (value: Json, path = '$'): string[] => {
  if (!isBranch(value)) return []

  const entries: (readonly [string, Json])[] = Array.isArray(value)
    ? value.map((child, index): readonly [string, Json] => [String(index), child])
    : Object.entries(value as Record<string, Json>)

  return [path, ...entries.flatMap(([key, child]) => allPaths(child, `${path}.${key}`))]
}

const relativeTime = (iso: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`

  return `${Math.round(seconds / 86_400)} d ago`
}

export const CompanyDataCard = (): React.JSX.Element => {
  const [view, setView] = useState<CompanyDocumentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  // `settings` open by default: it is the reason to open this card at all, and
  // a tree that starts fully collapsed makes the operator hunt for it.
  const [open, setOpen] = useState<Set<string>>(new Set(['$', '$.settings']))

  const load = useCallback(async (fromServer = false): Promise<void> => {
    setLoading(true)

    const result = await invoke<CompanyDocumentView>(
      fromServer ? COMPANY_CHANNELS.refresh : COMPANY_CHANNELS.document
    )

    if (result.success) {
      setView(result.data)
      setError(null)
    } else {
      setView(null)
      setError(result.error.message)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    // Deferred rather than called straight from the effect body: `load` sets
    // its loading flag before its first await, and a synchronous setState in an
    // effect triggers a cascading render.
    void (async () => {
      if (!cancelled) await load()
    })()

    const unregister = registerPageRefresh(() => void load())
    // A switch on the Login page (Sign-in, OTP) writes the local copy too —
    // re-read it so an open card does not go on showing the old value.
    const unsubscribe = onSessionsChanged(() => void load())

    return () => {
      cancelled = true
      unregister()
      unsubscribe()
    }
  }, [load])

  const toggle = useCallback((path: string): void => {
    setOpen((current) => {
      const next = new Set(current)

      if (next.has(path)) next.delete(path)
      else next.add(path)

      return next
    })
  }, [])

  /**
   * Filtering keeps a branch whose KEY matches, or which contains a match.
   *
   * Matching only leaves would hide the parents and leave results floating with
   * no idea where they came from — the path is most of the answer when someone
   * searches "session".
   */
  const filtered = useMemo((): Json => {
    const needle = filter.trim().toLowerCase()

    if (!view || !needle) return view?.document ?? null

    // A match is WRAPPED rather than signalled by a sentinel value. `Json` is
    // `unknown`, so any in-band marker — undefined, a symbol — is also a value
    // the document could legitimately hold, and "no match" would be
    // indistinguishable from "matched a field whose value is that marker".
    type Match = { readonly kept: Json } | null

    const prune = (value: Json, key: string): Match => {
      if (key.toLowerCase().includes(needle)) return { kept: value }

      if (isObject(value)) {
        const kept = Object.entries(value)
          .map(([k, child]): readonly [string, Match] => [k, prune(child, k)])
          .filter((entry): entry is readonly [string, { readonly kept: Json }] => entry[1] !== null)
          .map(([k, match]): readonly [string, Json] => [k, match.kept])

        return kept.length > 0 ? { kept: Object.fromEntries(kept) } : null
      }

      if (Array.isArray(value)) {
        const kept = value
          .map((child, index): Match => prune(child, String(index)))
          .filter((match): match is { readonly kept: Json } => match !== null)
          .map((match): Json => match.kept)

        return kept.length > 0 ? { kept } : null
      }

      const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''

      return text.toLowerCase().includes(needle) ? { kept: value } : null
    }

    return prune(view.document, 'company')?.kept ?? {}
  }, [view, filter])

  const entries = isObject(filtered) ? Object.entries(filtered) : []

  return (
    <section className="overflow-hidden rounded-lg bg-surface ring-1 ring-subtle">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-textPrimary">Company data</h2>
          <p className="mt-0.5 text-sm text-muted">
            The copy this machine holds, exactly as the database stores it. Passwords and cookie
            values are hidden — everything else is shown as-is.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {view ? (
            // The version, not just the age. "Synced 2 min ago" says when this
            // copy was taken, not whether it matches the database — and those
            // are different questions the moment a Sync silently fails or a
            // write lands elsewhere. `__v` is directly comparable with Compass.
            <div className="text-right leading-tight">
              <div className="text-xs text-faint">Synced {relativeTime(view.fetchedAt)}</div>
              {view.version.v !== null || view.version.updatedAt ? (
                <div className="font-mono text-2xs text-faint">
                  {view.version.v !== null ? `__v ${view.version.v}` : null}
                  {view.version.v !== null && view.version.updatedAt ? ' · ' : null}
                  {view.version.updatedAt
                    ? new Date(view.version.updatedAt).toLocaleString()
                    : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {/* Goes to the server — the local copy is what it is meant to check. */}
          <Button variant="secondary" onClick={() => void load(true)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh from server'}
          </Button>
        </div>
      </header>

      {error ? (
        <p className="px-6 py-8 text-center text-sm text-muted">{error}</p>
      ) : (
        <>
          {/*
            Sticky rather than a fixed-height scroll box.

            A tree this tall inside its own overflow-auto put a second scrollbar
            on a page that already had one, which is the thing that made this
            page awkward to use. The page scrolls; the filter and the
            expand/collapse controls simply follow you down it.
          */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-hairline bg-surface/95 px-6 py-3 backdrop-blur">
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by key or value — try “session”"
              aria-label="Filter company data"
              className="min-w-0 flex-1 rounded-md border border-strong bg-surface px-3 py-1.5 text-sm text-textPrimary placeholder:text-faint focus:border-emphasis focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setOpen(new Set(allPaths(view?.document ?? {})))}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-active hover:text-body"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setOpen(new Set())}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-active hover:text-body"
            >
              Collapse all
            </button>
          </div>

          <div className="px-4 py-3">
            {entries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                {filter ? `Nothing matches “${filter}”.` : 'The stored document is empty.'}
              </p>
            ) : (
              <ul className="m-0 list-none p-0 font-mono text-sm leading-relaxed">
                {entries.map(([key, value]) => (
                  <Node
                    key={key}
                    label={key}
                    value={value}
                    depth={0}
                    // Paths are prefixed so a filtered tree reuses the same
                    // open/closed state as the unfiltered one.
                    path={`$.${key}`}
                    open={open}
                    toggle={toggle}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}
