import { useCallback, useMemo } from 'react'

import type { ShellNavItem } from '@renderer/layout/VerticalMenuContent'
import { useToast } from '@renderer/hooks/useToast'

import { FLIPKART_VMS_LABEL, FLIPKART_VMS_NAV_ID, setVmsPage, useVmsPage } from '../partnerVms/pageStore'
import { usePartnerVmsEnabled } from '../partnerVms/usePartnerVms'
import { useAppDispatch, useAppSelector } from '../store/store'
import { setOrderType } from '../store/order/order.slice'
import type { OrderType } from '../store/order/order.types'

/**
 * The VMS rail's menu: Argos Watch's Forward VMS / Return VMS buttons as menu
 * rows. Both open the recorder; what they choose is the ORDER TYPE the next
 * recording is filed under, so the active row is the current order type.
 *
 * Changing it mid-recording is refused with Argos' own message — the recording
 * in progress was started as the other type.
 */
const VMS_NAV: readonly (ShellNavItem & { orderType: OrderType })[] = [
  { id: 'vms-forward', label: 'Forward recording', icon: 'tabler-package-export', orderType: 'Forward' },
  { id: 'vms-return', label: 'Return recording', icon: 'tabler-package-import', orderType: 'Return' }
]

export const VMS_ROOT_LABEL = 'TrackVid VMS'
export const VMS_PAGE_LABEL = 'Recorder'

/**
 * The Flipkart VMS page (TrackVid-App's sidebar button), listed only while the
 * held feed has the mirror switched on. The page gates itself as well.
 */
const FLIPKART_NAV: ShellNavItem = { id: FLIPKART_VMS_NAV_ID, label: FLIPKART_VMS_LABEL, icon: 'tabler-camera-share' }

export const useVmsNavigation = (): {
  navItems: readonly ShellNavItem[]
  activeId: string
  navigate: (id: string) => void
  heading: string
} => {
  const dispatch = useAppDispatch()
  const toast = useToast()
  const orderType = useAppSelector((state) => state.video.orderType)
  const recording = useAppSelector((state) => state.video.videoRecording)

  const mirrorEnabled = usePartnerVmsEnabled()
  const page = useVmsPage()
  const onFlipkart = mirrorEnabled && page === 'flipkart'

  const active = VMS_NAV.find((item) => item.orderType === orderType) ?? VMS_NAV[0]!

  const navigate = useCallback(
    (id: string): void => {
      if (id === FLIPKART_VMS_NAV_ID) {
        // Opening it unmounts the recorder, which would cut a recording off.
        if (recording) {
          toast.error('Cannot open Flipkart VMS while recording')
          return
        }
        setVmsPage('flipkart')
        return
      }
      const target = VMS_NAV.find((item) => item.id === id)
      if (!target) return
      if (target.orderType === orderType) {
        setVmsPage('recorder')
        return
      }
      if (recording) {
        toast.error('Cannot change order type while recording')
        return
      }
      dispatch(setOrderType(target.orderType))
      setVmsPage('recorder')
    },
    [dispatch, orderType, recording, toast]
  )

  const navItems = useMemo<readonly ShellNavItem[]>(
    () => [...VMS_NAV.map(({ id, label, icon }) => ({ id, label, icon })), ...(mirrorEnabled ? [FLIPKART_NAV] : [])],
    [mirrorEnabled]
  )

  return onFlipkart
    ? { navItems, activeId: FLIPKART_VMS_NAV_ID, navigate, heading: FLIPKART_VMS_LABEL }
    : { navItems, activeId: active.id, navigate, heading: active.label }
}
