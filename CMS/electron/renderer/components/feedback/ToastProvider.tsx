import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { classNames } from '@renderer/utils/format'
import { NotificationContext } from '@renderer/components/feedback/NotificationStore'
import { hasMoreThanLine, toastLine } from '@shared/utils/notificationList'

/**
 * `info` is for things that are neither — a claim arriving, a run starting.
 * Reporting those as a success would make the word meaningless on the one that
 * matters, and as an error would be a lie.
 */
export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}


export interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

const DISMISS_AFTER_MS = 4000

/** After the pointer leaves a toast it was hovering: time to finish reading. */
const RESUME_AFTER_MS = 2000

/** The icon each tone wears, and its colour — the meaning is never colour alone. */
const TONE_ICON: Record<ToastTone, { icon: string; className: string; label: string }> = {
  success: { icon: 'tabler-circle-check', className: 'text-success-fg', label: 'Success' },
  error: { icon: 'tabler-alert-circle', className: 'text-error', label: 'Error' },
  info: { icon: 'tabler-info-circle', className: 'text-info-fg', label: 'Info' }
}

/** At most this many on screen at once, whatever the app is doing. */
const MAX_VISIBLE = 3

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  // Timers are tracked so they can all be cleared on unmount - a dangling
  // setTimeout is the classic Electron memory leak.
  // Keyed by toast, so hovering one pauses that one and nothing else.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  // ToastProvider renders INSIDE NotificationProvider, so the store is simply
  // available here. `add` is a stable useCallback, so naming it as a dependency
  // below costs nothing.
  const record = useContext(NotificationContext)?.add

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
    },
    []
  )

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)

    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  const schedule = useCallback(
    (id: number, after: number) => {
      const existing = timers.current.get(id)

      if (existing) clearTimeout(existing)
      timers.current.set(id, setTimeout(() => dismiss(id), after))
    },
    [dismiss]
  )

  /** Stops the clock while the pointer is on a toast — it is being read. */
  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id)

    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++

    // The FULL text goes to the notification centre before it is trimmed for
    // the screen. Losing it was the actual problem: a stack trace flashed for
    // four seconds, covered the app, and left nothing to go back to.
    const line = toastLine(message)

    record?.(tone, line, hasMoreThanLine(message) ? message : undefined)

    // Newest at the BOTTOM of a capped stack. Four at once already reaches a
    // third of the window; without the cap a failing batch buried the app.
    setToasts((current) => [...current, { id, tone, message: line }].slice(-MAX_VISIBLE))

    schedule(id, DISMISS_AFTER_MS)
  }, [record, schedule])

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message)
    }),
    [push]
  )

  const layer = useRef<HTMLDivElement>(null)

  /**
   * Held open for the life of the app.
   *
   * `showPopover` throws if it is already open, and on a browser without the
   * API it does not exist at all — both are caught, and the container then
   * behaves as the plain fixed div it used to be.
   */
  useEffect(() => {
    const node = layer.current

    if (!node) return

    try {
      node.showPopover?.()
    } catch {
      // Already open, or unsupported. Nothing to do either way.
    }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* A POPOVER, not a plain fixed div.
          
          A native <dialog> opened with showModal() is painted in the browser's
          TOP LAYER, which sits above every z-index on the page — so a toast at
          z-50 was drawn UNDERNEATH any open modal. The one time that matters
          most is the one it was failing at: a toast reporting why something in
          a modal did not work, half-hidden behind the modal that caused it.
          
          The popover API is the only other way into that layer, and a manual
          popover behaves exactly like the div otherwise: it is positioned by
          the same classes and never takes focus. */}
      <div
        ref={layer}
        popover="manual"
        aria-live="polite"
        aria-atomic="false"
        /* TOP right, and the Background work panel keeps the BOTTOM.

           Both used to sit bottom-right, and this one is in the top layer — so
           a claim batch buried its own progress panel under its own toasts.
           The panel is the thing you watch for minutes; the toasts are the
           thing that interrupts. They cannot share a corner.

           BELOW THE NAVBAR, not on it: at top-4 a toast sat over the bell and
           the account menu — the controls you reach for when a toast says
           something went wrong. `top-14` is the 56px bar, and the `p-2` below
           puts the first card 8px under it and 16px from the right edge.

           `overflow-visible` and `p-2` are load-bearing. A popover's
           user-agent style is `overflow: auto`, which clipped each card's
           shadow into a hard-edged grey band around the stack. The padding is
           the room the shadow needs to be drawn. */
        className="pointer-events-none fixed inset-auto bottom-4 right-4 z-50 m-0 flex w-[var(--dialog-xs)] flex-col gap-2 overflow-visible border-0 bg-transparent p-2"
      >
        {/*
            A CARD WITH AN ICON, not a slab of colour and not a bare dot.

            The tone is carried by a status icon — a tick, an alert, an info
            mark — in its colour, beside ordinary 13px text. A 6px dot was the
            only signal before, which is colour alone; the icon says the same
            thing to someone who cannot tell green from red.

            THE SHADOW IS KEPT, unlike almost everywhere else in this theme: a
            toast genuinely floats over the page, and without it a white card
            on a near-white page has nothing to separate it from the table it
            is covering.
        */}
        {toasts.map((toast) => {
          const tone = TONE_ICON[toast.tone]

          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              onMouseEnter={() => pause(toast.id)}
              onMouseLeave={() => schedule(toast.id, RESUME_AFTER_MS)}
              className="toast-enter pointer-events-auto flex items-start gap-2.5 rounded-lg border border-[var(--veylix-toast-border)] bg-[var(--veylix-toast)] py-3 pl-4 pr-2 shadow-[var(--veylix-shadow-toast)]"
            >
              <i aria-label={tone.label} className={classNames(tone.icon, tone.className, 'mt-px shrink-0 text-lg')} />
              <Typography variant="body2" color="text.primary" className="line-clamp-2 min-w-0 flex-1 break-words pt-px">
                {toast.message}
              </Typography>
              {/* Close now rather than waiting out the timer. The full text is
                  already in the notification centre, so nothing is lost. */}
              <IconButton size="small" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="-my-1 shrink-0">
                <i className="tabler-x text-base" />
              </IconButton>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
