import { DASHBOARD_CHANNELS } from '@shared/constants/channels'
import { dashboardSnapshot } from '../services/dashboard.service'
import { registerHandler } from './handler'

export const registerDashboardIpc = (): void => {
  registerHandler(DASHBOARD_CHANNELS.snapshot, () => dashboardSnapshot())
}
