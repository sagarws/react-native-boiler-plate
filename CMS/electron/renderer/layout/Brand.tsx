// React Imports
import { useRef, useState } from 'react'

// Component Imports
import { DevModeModal } from '@renderer/components/DevModeModal'

// Asset Imports
import logo from '@renderer/assets/logo.svg'
import logoName from '@renderer/assets/logo-name.svg'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

/**
 * The product mark in the rail's header.
 *
 * THE NAME DISAPPEARS WHEN THE RAIL DOES. At 71px there is room for the mark or
 * for the words, and a name clipped to "Trac / CMS" is worse than no name —
 * Monitor's own Logo makes the same call. It comes back while the rail is
 * hovered open, which is when there is room for it again.
 *
 * THE MARK IS THE REAL ONE. It stood as a Tabler parcel glyph through the port,
 * which was a placeholder that read as a deliberate choice for long enough to
 * ship. Monitor's Logo is a `currentColor` SVG it tints with the primary; this
 * one cannot be, because TrackVid's mark is full-colour artwork — a teal box
 * and camera outlined in navy — and tinting it would throw the brand away. It
 * is drawn as artwork instead, and carries enough of its own contrast to sit on
 * the rail in either scheme: checked on both, and the white camera body is what
 * holds it up on the dark one.
 *
 * FIVE CLICKS STILL OPEN DEVELOPER MODE. The gesture lived in layouts/AppLayout
 * and did not come across with the port — the box it opens is the only way to
 * turn developer mode ON, so losing it quietly took Bulk SKU, Check master data
 * and the rest of the gated screens out of reach with no error to explain it.
 * It belongs on the mark rather than in the shell around it: the thing you tap
 * should be the thing that counts the taps.
 */

/**
 * How many clicks on the mark open the developer-mode box.
 *
 * The convention for exactly this, and hard to hit by accident — the logo is
 * not a control, so nobody clicks it once, let alone five times running.
 */
const DEV_CLICKS = 5

/** Clicks further apart than this are two separate fidgets, not a sequence. */
const DEV_WINDOW_MS = 1500
export const Brand = () => {
  const { isCollapsed, isHovered } = useVerticalNav()
  const showName = !isCollapsed || isHovered
  const [devOpen, setDevOpen] = useState(false)
  const clicks = useRef({ count: 0, last: 0 })

  const tapLogo = (): void => {
    const now = Date.now()
    // Restarted rather than incremented when the gap is too long, so a stray
    // click today and four tomorrow is not a sequence.
    const count = now - clicks.current.last > DEV_WINDOW_MS ? 1 : clicks.current.count + 1

    clicks.current = { count, last: now }

    if (count >= DEV_CLICKS) {
      clicks.current = { count: 0, last: 0 }
      setDevOpen(true)
    }
  }

  return (
    <div className='flex items-center gap-2 min-is-0'>
      {/* NOT A BUTTON, and that is the point. Developer mode is meant to be
          undiscoverable: a control with a role, a name and a focus ring is an
          invitation to press it, which is the opposite of what this is for.
          It carries no keyboard path for the same reason. */}
      {/* Height, not width: the mark is wider than it is tall, and a future
          one with different proportions must not change the header's height.

          THE WORDMARK IS ARTWORK, NOT TYPE. The name used to be a <Typography>
          reading "TrackVid CMS" beside the mark, which was the brand set in
          whatever the UI typeface happened to be — and once that became Geist
          it stopped resembling TrackVid's own lettering at all. logo-name.svg
          is the real wordmark, the same file the login screen already uses, so
          the two entrances to the app finally show the same thing.

          "CMS" IS GONE DELIBERATELY. It named the product to somebody who was
          already inside it; the window title and the installer both still say
          TrackVid CMS, which is where that distinction is worth making. */}
      {/* 28px, sized to the rail rather than picked.
          The wordmark is 466x132, so height decides width: at 28px it comes
          out ~99px across, a little over half the 183px the header has once
          its padding is taken off. That reads as placed. 24px (where the mark
          alone used to sit) left the teal lettering looking like a favicon,
          and 32px pushed it to ~113px, heavy enough to become the loudest
          thing in a rail whose job is the six labels underneath it.
          The collapsed rail keeps the same height, so the header does not
          change size when the rail does. */}
      {/* THE HEIGHT IS AN INLINE STYLE, NOT `bs-7`, and that is deliberate.
          The numeric block-size utilities are generated on demand from what
          Tailwind finds in the source, and `bs-8` went missing on a running
          dev server — with block-size unset the SVG falls back to its natural
          132px and bursts out of a 215px rail, which is exactly how this was
          found. A logo's height is a one-off dimension rather than a theme
          value, so pinning it here costs nothing and cannot silently vanish. */}
      <img
        src={showName ? logoName : logo}
        alt='TrackVid'
        style={{ height: '1.75rem', width: 'auto' }}
        className='block shrink-0 cursor-default'
        onClick={tapLogo}
      />

      <DevModeModal open={devOpen} onClose={() => setDevOpen(false)} />
    </div>
  )
}
