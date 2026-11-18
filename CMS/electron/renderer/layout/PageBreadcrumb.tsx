// MUI Imports
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

export interface PageBreadcrumbProps {
  /** The workspace the screens belong to — the first crumb. */
  root: string
  /** The screen the operator is on. */
  current: string
  /** Takes the operator home. Omitted on the home screen itself. */
  onRoot?: (() => void) | undefined
}

/**
 * Where the operator is, on one line: `TrackVid Operations / Dashboard`.
 *
 * IT WAS TWO LINES — a small uppercase caption stacked over the page name —
 * which made the bar's height depend on two type sizes and a line-height, and
 * read as a heading squeezed into a toolbar. A breadcrumb is one baseline, so
 * the bar is the same height on every screen, and the root doubles as the way
 * back to the Dashboard.
 *
 * Vercel's separator is a slash in the tertiary grey; the current crumb is the
 * only thing at full ink.
 */
export const PageBreadcrumb = ({ root, current, onRoot }: PageBreadcrumbProps) => (
  /*
   * ONE TYPE SIZE, SET ON EVERY CRUMB, NEVER INHERITED.
   *
   * The root crumb is plain text on the Dashboard and a link everywhere else.
   * The link once inherited Breadcrumbs' own body1 while the text was body2,
   * so the bar's lettering changed size the moment you left the Dashboard.
   * body2 on the list itself (the separator's size), on the link and on both
   * text crumbs is what keeps them identical.
   */
  <Breadcrumbs
    aria-label='Breadcrumb'
    // `.commerce-breadcrumb`: a small chevron, 7px either side.
    separator={<i className='tabler-chevron-right text-[11px]' style={{ color: 'var(--veylix-empty-icon)' }} />}
    sx={{
      typography: 'body2',
      '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
      '& .MuiBreadcrumbs-li': { minInlineSize: 0 },
      '& .MuiBreadcrumbs-separator': { marginInline: '7px' }
    }}
  >
    {onRoot ? (
      <Link
        component='button'
        type='button'
        variant='body2'
        underline='none'
        color='text.secondary'
        onClick={onRoot}
        className='whitespace-nowrap align-baseline hover:text-textPrimary'
      >
        {root}
      </Link>
    ) : (
      <Typography variant='body2' color='text.secondary' className='whitespace-nowrap'>
        {root}
      </Typography>
    )}
    {current && (
      <Typography
        variant='body2'
        color='text.primary'
        aria-current='page'
        className='truncate font-medium'
      >
        {current}
      </Typography>
    )}
  </Breadcrumbs>
)
