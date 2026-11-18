import Typography from '@mui/material/Typography'

/**
 * The page's title, as the Veylix template sets it (`.commerce-heading h1`):
 * 28px, weight 750, pulled tight, ending in a gold full stop
 * (`.commerce-heading h1 > span`).
 *
 * Rendered by the shell from the active screen's name, so no page had to
 * change to get it; the breadcrumb above it lives in the top bar.
 */
export const PageHeading = ({ title }: { title: string }) =>
  title ? (
    <div className='mbs-1 mbe-5 pli-1'>
      <Typography variant='h3' component='h1'>
        {title}
        <span aria-hidden='true' style={{ color: 'var(--veylix-title-dot)' }}>
          .
        </span>
      </Typography>
    </div>
  ) : null
