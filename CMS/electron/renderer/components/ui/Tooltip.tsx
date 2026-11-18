import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '@renderer/utils/format'

export interface TooltipProps {
  /** Nothing is shown when this is empty, so a caller can pass a reason or null. */
  label?: string | null
  children: ReactNode
  /** Preferred side. Flipped automatically when there is no room. */
  side?: 'top' | 'bottom'
  className?: string
}

/**
 * A hover explanation, rendered on a WRAPPER and drawn in a PORTAL.
 *
 * Two indirections, each for its own reason.
 *
 * THE WRAPPER exists because the case this was built for is a disabled
 * control: a disabled element receives no pointer events, so neither a `title`
 * attribute nor a hover style on it reliably fires — the browser shows nothing
 * at the one moment an operator most needs to know why they cannot click. The
 * wrapper is not disabled, so it hovers normally.
 *
 * THE PORTAL exists because an absolutely positioned bubble is clipped by any
 * scrolling ancestor, and the controls that need explaining live inside tables
 * that scroll both ways. A disabled checkbox in the first column produced a
 * bubble sliced down the middle and running off the window — the explanation
 * was there and unreadable, which is worse than absent because it looks like a
 * rendering fault rather than something to hover properly. Drawn on `body` at
 * fixed coordinates, it is clipped by nothing.
 *
 * AND IT IS A POPOVER, for the same reason the toasts are one. A native
 * <dialog> opened with showModal() paints in the browser's TOP LAYER, which
 * sits above every z-index on the page — so a bubble portalled to `body` at
 * z-100 was drawn UNDERNEATH any open modal, and hovering a clipped error
 * message inside one showed nothing at all. The popover API is the only other
 * way into that layer; a manual popover is positioned by the same fixed
 * coordinates and never takes focus.
 *
 * Positioned on hover rather than continuously: the coordinates are read once
 * when the pointer arrives, which is also the only moment they are correct — a
 * bubble kept alive across a scroll would drift away from what it describes.
 */

/** Matches `max-w-xs`. Used to keep the bubble inside the window. */
const MAX_WIDTH = 320
const EDGE = 8
/** Enough room for a two-line bubble; below this the preferred side flips. */
const ROOM = 96

interface Anchor {
  /** Viewport coordinates of the trigger. */
  left: number
  top: number
  bottom: number
  /** Resolved after the flip — not necessarily the requested side. */
  side: 'top' | 'bottom'
}

export const Tooltip = ({ label, children, side = 'bottom', className }: TooltipProps) => {
  const trigger = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  const show = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect()

    if (!box) return

    // Centred on the trigger, then pulled back inside the window. Without the
    // clamp a control in the first column pushes half the bubble off-screen,
    // which is exactly what a row checkbox does.
    const centre = box.left + box.width / 2
    const half = MAX_WIDTH / 2

    setAnchor({
      left: Math.min(Math.max(centre, half + EDGE), window.innerWidth - half - EDGE),
      top: box.top,
      bottom: box.bottom,
      // Flipped when the preferred side has no room — a bubble under a row near
      // the bottom of the table would otherwise be drawn off the window.
      side:
        side === 'bottom' && box.bottom > window.innerHeight - ROOM
          ? 'top'
          : side === 'top' && box.top < ROOM
            ? 'bottom'
            : side
    })
  }, [side])

  const hide = useCallback(() => setAnchor(null), [])

  /**
   * Into the top layer the moment it mounts.
   *
   * A popover is inert until something opens it, and the bubble has no trigger
   * of its own — it exists only while the pointer is on the wrapper, so mounting
   * IS the request to show it.
   */
  const open = useCallback((node: HTMLSpanElement | null) => {
    try {
      node?.showPopover?.()
    } catch {
      // Already open, or the runtime has no popover support — in which case the
      // bubble is still drawn, just back under any open dialog.
    }
  }, [])

  if (!label) return <>{children}</>

  return (
    <>
      <span
        ref={trigger}
        // `group/tip` and `relative` are gone with the CSS-only version: the
        // bubble is no longer a descendant to position against.
        className={classNames('inline-flex', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        // Keyboard reaches it too: the control it explains is often the only
        // thing on the row a keyboard user can land on.
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>

      {anchor &&
        createPortal(
          <span
            role="tooltip"
            popover="manual"
            ref={open}
            style={{
              position: 'fixed',
              // The popover's own UA style is `inset: 0`, which would fight the
              // coordinates below and stretch the bubble across the window.
              inset: 'auto',
              left: anchor.left,
              top: anchor.side === 'bottom' ? anchor.bottom + EDGE : anchor.top - EDGE,
              transform: `translate(-50%, ${anchor.side === 'bottom' ? '0' : '-100%'})`,
              maxWidth: MAX_WIDTH
            }}
            className={classNames(
              // Never between the cursor and the thing it describes.
              'pointer-events-none z-[var(--z-tooltip)] block w-max rounded-md',
              // m-0 and border-0 undo the rest of the popover UA style.
              'm-0 border-0 bg-surface-inverted px-2.5 py-1.5 text-xs leading-relaxed text-on-inverted shadow-lg',
              'ring-1 ring-surface-inverted-border'
            )}
          >
            {label}
          </span>,
          document.body
        )}
    </>
  )
}
