// MUI Imports
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'

// Component Imports
import { PlatformLogo } from './PlatformLogo'

/**
 * The height of every filter tab, and of any control that shares a row with
 * them (a Filter chip, Clear filter). One height, so no row of tabs has a
 * control that sits taller than its neighbours.
 */
export const TAB_BLOCK_SIZE = 28

/**
 * A filter that is also a state: a tab with a count, as Manage Claims and
 * Background Process both use for their rows of filters.
 *
 * SHARED ON PURPOSE. The two pages drew these separately — rounded rectangles
 * on one, round pills on the other — and a user moving between them saw two
 * designs for one control. There is one now, and a new page with a row of
 * filters uses it rather than drawing a third.
 */
export const FilterTab = ({
  label,
  count,
  active,
  dot,
  logo = false,
  onClick
}: {
  label: string
  count: number | undefined
  active: boolean
  /** Status dot, matched to the admin panel's colour. Platform tabs have none. */
  dot?: string
  /** Platform tabs carry the marketplace's logo; status tabs carry a dot. */
  logo?: boolean
  onClick: () => void
}) => {
  /** Nothing behind this tab today — see the note on `sx` below. */
  const isEmpty = (count ?? 0) === 0

  return (
  /*
   * A MUI chip wearing a button's clothes.
   *
   * `clickable` rather than a real <button> because that is what the reference
   * uses for a filter that is also a state — and the two rows of these are the
   * claim queue's primary navigation, so they have to read the same as the
   * filter chips on Jobs.
   */
  <Chip
    component='button'
    type='button'
    clickable
    size='small'
    variant={active ? 'filled' : 'tonal'}
    color={active ? 'primary' : 'secondary'}
    onClick={onClick}
    /*
     * AN EMPTY TAB STEPS BACK.
     *
     * There are twenty-one of these on this screen and on most days the large
     * majority hold nothing — eleven marketplaces, ten statuses, and an
     * operator looking for work had to read every count to find the two that
     * were not zero. Fading the empty ones lets the eye land on the ones that
     * have something in them, which is the actual question being asked of this
     * row.
     *
     * NOT `disabled`, and the distinction matters: an empty tab is still worth
     * opening — it is how you confirm there is nothing there, and it is where
     * a claim will appear next. It stays fully clickable and keeps its
     * contrast on hover.
     *
     * The active tab never fades, even at zero: having chosen it, the operator
     * needs to see where they are.
     */
    sx={{
      blockSize: TAB_BLOCK_SIZE,
      ...(isEmpty && !active ? { opacity: 0.55, '&:hover': { opacity: 1 } } : {})
    }}
    label={
      <span className='flex items-center gap-1.5'>
        {/* The marketplace's own mark, which is recognised before the word is
            read — the same artwork the web CMS puts on these tabs. */}
        {logo && <PlatformLogo name={label} size={16} />}
        {dot && (
          <Box
            aria-hidden='true'
            component='span'
            className='shrink-0 rounded-full'
            // The palette is per status and comes from the registry, so it
            // cannot be a Tailwind class — those are compiled from literals.
            sx={{ inlineSize: 6, blockSize: 6, backgroundColor: dot }}
          />
        )}
        {label}
        {/* The count is the secondary fact: the label is what is being chosen.
            Tabular figures so the row does not shuffle as counts change. */}
        <Box
          component='span'
          className='tabular-nums'
          sx={{ color: active ? 'text.primary' : 'text.disabled', fontWeight: 400 }}
        >
          {count ?? 0}
        </Box>
      </span>
    }
  />
  )
}
