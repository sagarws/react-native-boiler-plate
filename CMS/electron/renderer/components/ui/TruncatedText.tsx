import { Tooltip } from '@renderer/components/ui/Tooltip'
import { classNames } from '@renderer/utils/format'

/**
 * A message clipped to its column, readable in full on hover.
 *
 * Every table that reports what went wrong holds text longer than the cell it
 * sits in — "…is not in this machine's AJIO backup — back u…" is the whole
 * answer cut off two words before the part that says what to do. The `title`
 * attribute was carrying that job and is not up to it: the OS tooltip waits a
 * second or more, renders in the system's own style rather than the theme's,
 * and never appears at all on an element that takes no pointer events.
 *
 * So the app's own Tooltip does it — instant, themed, drawn in a portal so a
 * scrolling table cannot clip it — and one component means a cell cannot be
 * added later that quietly goes back to a native tooltip.
 *
 * The bubble is offered only when there IS something to read: an empty message
 * renders the dash alone, with nothing to hover.
 */

interface Props {
  text: string | null | undefined
  /** Shown when there is no text. A dash, unless the column wants its own word. */
  empty?: string
  /** Type and colour for the text itself — the truncation is not the caller's to set. */
  className?: string
  side?: 'top' | 'bottom'
}

export const TruncatedText = ({ text, empty = '—', className, side = 'top' }: Props) => {
  const value = text?.trim()

  if (!value) return <span className={className}>{empty}</span>

  return (
    // `min-w-0` on both: a flex item refuses to shrink below its content by
    // default, which is exactly how an ellipsis ends up never being drawn.
    <Tooltip label={value} side={side} className="min-w-0 max-w-full align-bottom">
      <span className={classNames('block min-w-0 max-w-full truncate', className)}>{value}</span>
    </Tooltip>
  )
}
