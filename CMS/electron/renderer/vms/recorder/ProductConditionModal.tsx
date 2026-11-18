import MuiButton from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'

/**
 * Return-order condition prompt (company.returnConditionPopup.isShow). Ported
 * from Argos Watch's ProductConditionModal onto the CMS Modal.
 *
 *   1 = Good      - upload proceeds normally
 *   2 = Damaged   - upload proceeds with orderCondition=2 and needRefund=true
 */
export type ProductCondition = 1 | 2

interface Props {
  open: boolean
  onSelect: (condition: ProductCondition) => void
  onCancel: () => void
}

export const ProductConditionModal = ({ open, onSelect, onCancel }: Props) => (
  <Modal
    open={open}
    onClose={onCancel}
    title='Product condition'
    footer={
      <Button variant='ghost' size='sm' onClick={onCancel}>
        Discard recording
      </Button>
    }
  >
    <Typography variant='body2' color='text.secondary' className='mbe-4'>
      Mark the returned item&rsquo;s condition. Damaged items are flagged for refund review.
    </Typography>
    <div className='grid grid-cols-2 gap-3'>
      <MuiButton
        fullWidth
        variant='tonal'
        color='success'
        size='large'
        startIcon={<i className='tabler-circle-check' />}
        onClick={() => onSelect(1)}
      >
        Good
      </MuiButton>
      <MuiButton
        fullWidth
        variant='tonal'
        color='error'
        size='large'
        startIcon={<i className='tabler-alert-triangle' />}
        onClick={() => onSelect(2)}
      >
        Damaged
      </MuiButton>
    </div>
  </Modal>
)
