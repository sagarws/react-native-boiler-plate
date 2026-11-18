import Divider from '@mui/material/Divider'

import { PageBreadcrumb } from '@renderer/layout/PageBreadcrumb'

import { FLIPKART_VMS_LABEL, useVmsPage } from '../partnerVms/pageStore'
import { usePartnerVmsEnabled } from '../partnerVms/usePartnerVms'
import { FeedPicker } from './FeedPicker'
import { VMS_PAGE_LABEL, VMS_ROOT_LABEL } from './useVmsNavigation'

/** The bar's left pill in VMS mode: where you are, then which feed you are. */
export const VmsTitle = () => {
  const page = useVmsPage()
  const mirrorEnabled = usePartnerVmsEnabled()
  const onFlipkart = page === 'flipkart' && mirrorEnabled

  return (
    <div className='flex items-center gap-3 min-is-0'>
      <PageBreadcrumb root={VMS_ROOT_LABEL} current={onFlipkart ? FLIPKART_VMS_LABEL : VMS_PAGE_LABEL} />
      <Divider orientation='vertical' flexItem className='mlb-3' />
      <FeedPicker />
    </div>
  )
}
