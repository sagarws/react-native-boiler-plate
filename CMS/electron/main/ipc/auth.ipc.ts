import { AUTH_CHANNELS } from '@shared/constants/channels'
import { currentSession, impersonate, login, logout } from '../services/auth.service'
import { registerHandler } from './handler'

export const registerAuthIpc = (): void => {
  registerHandler(AUTH_CHANNELS.login, (payload) => login(payload))
  registerHandler(AUTH_CHANNELS.logout, () => logout())
  registerHandler(AUTH_CHANNELS.session, () => Promise.resolve(currentSession()))
  registerHandler(AUTH_CHANNELS.impersonate, (payload) => impersonate(payload))
}
