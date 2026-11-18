import { useContext } from 'react'
import { NotificationContext, type NotificationApi } from '@renderer/components/feedback/NotificationStore'

export const useNotifications = (): NotificationApi => {
  const context = useContext(NotificationContext)

  if (!context) throw new Error('useNotifications must be used inside <NotificationProvider>')

  return context
}
