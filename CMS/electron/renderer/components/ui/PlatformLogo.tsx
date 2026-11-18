import { Box, type BoxProps } from '@mui/material'

import ajio from '@renderer/assets/marketplaces/ajio.png'
import amazon from '@renderer/assets/marketplaces/amazon.png'
import delhivery from '@renderer/assets/marketplaces/delhivery.png'
import flipkart from '@renderer/assets/marketplaces/flipkart.png'
import increff from '@renderer/assets/marketplaces/increff.png'
import meesho from '@renderer/assets/marketplaces/meesho.png'
import myntra from '@renderer/assets/marketplaces/myntra.png'
import nykaa from '@renderer/assets/marketplaces/nykaa-fashion.png'
import other from '@renderer/assets/marketplaces/other.png'
import snapdeal from '@renderer/assets/marketplaces/snapdeal.png'
import tatacliq from '@renderer/assets/marketplaces/tata-cliq.png'
import xbees from '@renderer/assets/marketplaces/xbees.png'

/**
 * A marketplace, by its own logo.
 *
 * THE SAME ARTWORK TrackVid-FE USES, copied from its
 * `assets/images/marketplaces/small` so an operator moving between the two
 * products sees the same mark for the same marketplace. A brand is recognised
 * long before a word is read, and on a screen listing a dozen platforms that is
 * the difference between scanning and reading.
 *
 * BUNDLED, NOT FETCHED. The app has to look right on a machine with no network
 * — the same rule the fonts and the icon subset already follow — so these are
 * imported and land in the build rather than being pulled from a CDN or from
 * the marketplace itself.
 *
 * IMPORTED ONE BY ONE rather than through a glob. Vite can glob them, but an
 * explicit list is what makes a missing file a build error instead of a badge
 * that silently falls back to initials on one platform and nobody notices.
 */

/** Keyed the way `platformKey` canonicalises a name — see shared/utils. */
const LOGOS: Record<string, string> = {
  ajio,
  amazon,
  delhivery,
  flipkart,
  increff,
  meesho,
  myntra,
  nykaa,
  other,
  snapdeal,
  tatacliq,
  xbees
}

/**
 * "Tata CliQ", "tata cliq" and "tataCliq" are one marketplace.
 *
 * Deliberately NOT `platformKey` from shared/utils: that answers a different
 * question — which registry entry runs this platform — and returns an
 * unrecognised name unchanged so a lookup cannot collide. Here an unrecognised
 * name simply has no logo, and the only work needed is to flatten case and the
 * punctuation between words.
 */
const slug = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]/g, '')

/** Names whose logo file is not simply their slug. */
const ALIASES: Record<string, string> = {
  nykaafashion: 'nykaa',
  ajiodropship: 'ajio',
  amazonfba: 'amazon',
  amazonin: 'amazon',
  myntrappmp: 'myntra'
}

export const platformLogo = (name: string | null | undefined): string | null => {
  const key = slug(name ?? '')

  if (!key) return null

  return LOGOS[ALIASES[key] ?? key] ?? null
}

const initialsOf = (value: string): string => {
  const cleaned = value.trim().replace(/\s+/g, ' ')

  if (!cleaned) return '?'

  const parts = cleaned.split(' ')

  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase()

  return `${(parts[0] as string)[0] ?? ''}${(parts[1] as string)[0] ?? ''}`.toUpperCase()
}

/** A stable colour per name, so two custom platforms never collide by accident. */
const hashOf = (value: string): number => {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash)
}

export interface PlatformLogoProps extends Omit<BoxProps, 'component'> {
  /** As the company stores it — "Tata CliQ", "Nykaa Fashion", "Our Own Store". */
  name: string
  /** Side, in pixels. */
  size?: number
}

/**
 * The logo where there is one, and the platform's initials where there is not.
 *
 * A company can add its own marketplace on Integrations, and no artwork ships
 * for it — so the fallback is not an error state, it is the normal way a
 * custom platform is drawn.
 */
export const PlatformLogo = ({ name, size = 20, sx, ...rest }: PlatformLogoProps) => {
  const logo = platformLogo(name)

  if (logo) {
    return (
      <Box
        component='img'
        src={logo}
        alt=''
        aria-hidden='true'
        sx={{
          inlineSize: size,
          blockSize: size,
          borderRadius: '4px',
          objectFit: 'contain',
          flexShrink: 0,
          ...sx
        }}
        {...rest}
      />
    )
  }

  return (
    <Box
      aria-hidden='true'
      sx={{
        inlineSize: size,
        blockSize: size,
        borderRadius: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: `hsl(${hashOf(name.toLowerCase()) % 360}, 62%, 46%)`,
        color: 'common.white',
        fontSize: Math.max(7, Math.round(size * 0.42)),
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        ...sx
      }}
      {...rest}
    >
      {initialsOf(name)}
    </Box>
  )
}

export default PlatformLogo
