import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { Button } from '@renderer/components/ui/Button'
import { clearScreenshots, MAX_SCREENSHOTS, removeScreenshot } from '@renderer/vms/store/screenshots/screenshots.slice'
import { useAppDispatch, useAppSelector } from '@renderer/vms/store/store'

/**
 * The screenshots captured for the current order: the "N / 15" counter, Clear,
 * and each frame with a remove button. Ported from Argos Watch's
 * ScreenshotsPanel into a Veylix glass card.
 */
export const ScreenshotsPanel = () => {
  const dispatch = useAppDispatch()
  const items = useAppSelector(state => state.screenshots.items)
  const remaining = MAX_SCREENSHOTS - items.length

  return (
    <section className='veylix-glass flex min-bs-0 flex-col gap-3 p-5' aria-label='Screenshots'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='veylix-card-title'>{items.length === 0 ? 'No Screenshots' : `Screenshots (${items.length})`}</h2>
        <Typography variant='caption' color='text.secondary'>
          {remaining > 0 ? `${remaining} more allowed` : 'Cap reached'}
        </Typography>
      </div>

      <div className='flex items-center justify-between gap-2'>
        <Typography variant='caption' color='text.secondary' className='font-mono'>
          {items.length} / {MAX_SCREENSHOTS}
        </Typography>
        <Button variant='ghost' size='sm' onClick={() => dispatch(clearScreenshots())} disabled={items.length === 0}>
          Clear
        </Button>
      </div>

      {items.length === 0 ? (
        <div className='veylix-note flex flex-col items-center justify-center gap-2 p-4 text-center'>
          <i className='tabler-photo text-3xl' aria-hidden='true' style={{ color: 'var(--veylix-empty-icon)' }} />
          <Typography variant='caption' sx={{ color: 'inherit' }}>
            Press <strong>SPACE</strong> or the Screenshot button below the video preview to capture a frame.
          </Typography>
        </div>
      ) : (
        <div className='grid max-h-80 grid-cols-2 gap-2 overflow-auto'>
          {items.map(item => (
            <Box
              key={item.id}
              sx={{ position: 'relative', borderRadius: '9px', overflow: 'hidden', border: '1px solid var(--veylix-glass-border)' }}
            >
              <img src={item.dataUrl} alt='Captured frame' loading='lazy' className='block w-full' />
              <IconButton
                size='small'
                onClick={() => dispatch(removeScreenshot(item.id))}
                aria-label='Remove screenshot'
                sx={{
                  position: 'absolute',
                  insetBlockStart: 4,
                  insetInlineEnd: 4,
                  p: 0.25,
                  backgroundColor: 'color-mix(in srgb, var(--mui-palette-common-black) 55%, transparent)',
                  color: 'var(--mui-palette-common-white)',
                  '&:hover': {
                    backgroundColor: 'color-mix(in srgb, var(--mui-palette-common-black) 80%, transparent)'
                  }
                }}
              >
                <i className='tabler-x text-sm' />
              </IconButton>
            </Box>
          ))}
        </div>
      )}
    </section>
  )
}
