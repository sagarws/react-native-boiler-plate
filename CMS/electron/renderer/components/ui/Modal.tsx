// React Imports
import type { ReactNode } from 'react'

// MUI Imports
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

// Third-party Imports
import classnames from 'classnames'

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /**
   * Controls that stay put while the body scrolls — filters, a date range, a
   * pager.
   *
   * A separate slot because the body SCROLLS, and a scroll container clips
   * anything absolutely positioned inside it: a date picker opened from a
   * toolbar in the body gets cut off at the container's edge and drifts away as
   * the content moves under it. Out here it can overflow the dialog normally.
   */
  toolbar?: ReactNode
  /**
   * Controls in the header, beside the title — a minimise button, typically.
   *
   * Header rather than footer because they act on the DIALOG, not on the work
   * inside it: a footer button reads as "finish this", and minimise is the
   * opposite of finishing.
   */
  headerActions?: ReactNode
  /** Prevents closing while a submit is in flight. */
  busy?: boolean
  /**
   * How much room the content needs.
   *
   * `md` is a form. `lg` is a list somebody reads — a review, a set of
   * failures. `xl` is a data table with its own horizontal scroll, which at any
   * smaller width scrolls in two directions at once and becomes unreadable.
   *
   * `full` is the whole window, for a dialog the operator has asked to expand.
   * Not a default anywhere: a dialog that fills the screen by itself is a page
   * that forgot to be one, and the point of expanding is that it was a choice.
   */
  size?: 'md' | 'lg' | 'xl' | 'full'
  /**
   * The body fills the dialog and manages its own scrolling.
   *
   * For content that scrolls in BOTH directions — a wide data table. With the
   * default, the body scrolls vertically and the table scrolls horizontally
   * inside it, which puts the horizontal scrollbar at the bottom of the table's
   * own box: below the fold, reachable only after scrolling down, and taking
   * the sticky header with it. One element has to own both axes, and this hands
   * that job to the child.
   */
  fill?: boolean
}

/**
 * The app's dialog, rebuilt on Monitor's.
 *
 * REBUILT RATHER THAN MIGRATED SCREEN BY SCREEN. Fourteen dialogs on the claim
 * queue alone render this one component; rebuilding it hands every one of them
 * Monitor's paper, its backdrop, its transition and its spacing, with no caller
 * moving. The props are exactly what they were.
 *
 * WHAT IS LOST, and it is worth naming: this was a native `<dialog>`, which
 * gives focus trapping, Escape and the top layer for free. MUI's Dialog does
 * all three itself — it is the reason the component can be swapped at all — but
 * it does them in JavaScript rather than in the platform.
 *
 * THE SIZES ARE THE APP'S, not MUI's breakpoint ladder: `xl` is a data table
 * and needs to be wider than `lg` is tall. They stay as the tokens they were.
 */
const WIDTHS: Record<NonNullable<ModalProps['size']>, string> = {
  // The Veylix template's dialog widths (`.app-dialog` 620px, `.dialog-wide`
  // 850px); xl and full stay the app's own, for data tables.
  md: 'var(--veylix-dialog-md)',
  lg: 'var(--veylix-dialog-lg)',
  xl: 'var(--dialog-xl)',
  full: 'var(--dialog-full)'
}

export const Modal = ({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  toolbar,
  headerActions,
  busy = false,
  size = 'md',
  fill = false
}: ModalProps) => (
  <Dialog
    open={open}
    // Escape and a backdrop click both arrive here; neither may interrupt a
    // submit in flight.
    onClose={() => {
      if (!busy) onClose()
    }}
    scroll='paper'
    PaperProps={{
      sx: {
        inlineSize: WIDTHS[size],
        maxInlineSize: '100%',
        maxBlockSize: 'var(--dialog-height)'
      }
    }}
  >
    {/*
      `.dialog-heading` (Veylix): the title, then a ROUND CLOSE BUTTON at the
      end. It does exactly what Escape and a backdrop click already did — the
      same `onClose`, refused while `busy` — so no dialog gains a way out it did
      not have; it just becomes visible. The soft hairline under the header is
      the theme's (MuiDialogTitle).
    */}
    <DialogTitle className='flex items-center gap-3'>
      <div className='min-is-0 flex-1'>
        <Typography variant='h5' component='h2' sx={{ fontSize: '1.125rem', letterSpacing: '-0.5px' }}>
          {title}
        </Typography>
        {description && (
          <Typography variant='body2' color='text.secondary' className='mbs-1'>
            {description}
          </Typography>
        )}
      </div>
      {headerActions && <div className='flex shrink-0 items-center gap-1'>{headerActions}</div>}
      <IconButton
        aria-label='Close'
        size='small'
        disabled={busy}
        onClick={onClose}
        sx={{
          flexShrink: 0,
          inlineSize: 34,
          blockSize: 34,
          borderRadius: '50%',
          backgroundColor: 'var(--veylix-control)',
          border: '1px solid var(--mui-palette-Chip-defaultBorder)',
          color: 'text.secondary'
        }}
      >
        <i className='tabler-x text-lg' />
      </IconButton>
    </DialogTitle>

    {toolbar && (
      <>
        {/*
          `overflow: visible` so a popover opened here is not clipped, and a
          stacking context ABOVE anything the body positions — a data table's
          sticky header is itself positioned, and at equal z-index the later
          element in the document wins, which drew a calendar opened from this
          toolbar underneath the column headers.
        */}
        <Box
          className='pli-6 plb-3'
          sx={{ position: 'relative', zIndex: 3, overflow: 'visible', borderBlockStart: 0 }}
        >
          {toolbar}
        </Box>
      </>
    )}

    {toolbar && <Divider sx={{ borderColor: 'var(--veylix-hairline-soft)' }} />}

    <DialogContent
      className={classnames(fill && 'flex min-bs-0 flex-1 flex-col')}
      sx={fill ? { overflow: 'hidden' } : undefined}
    >
      {children}
    </DialogContent>

    {footer && (
      <>
        <Divider sx={{ borderColor: 'var(--veylix-hairline-soft)' }} />
        <DialogActions className='justify-end gap-2'>{footer}</DialogActions>
      </>
    )}
  </Dialog>
)
