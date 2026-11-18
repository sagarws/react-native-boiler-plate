import { AUTH_CHANNELS } from '@shared/constants/channels'
import type { ImpersonateInput, LoginInput, SessionState } from '@shared/types/auth'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/**
 * Auth calls go over the same allow-listed bridge as everything else. The
 * access token is never part of these payloads - the main process holds it and
 * the renderer only ever learns *who* is signed in.
 */
export const authClient = {
  session: (): Promise<Result<SessionState>> => invoke<SessionState>(AUTH_CHANNELS.session),
  login: (input: LoginInput): Promise<Result<SessionState>> => invoke<SessionState>(AUTH_CHANNELS.login, input),
  logout: (): Promise<Result<SessionState>> => invoke<SessionState>(AUTH_CHANNELS.logout),
  impersonate: (input: ImpersonateInput): Promise<Result<SessionState>> =>
    invoke<SessionState>(AUTH_CHANNELS.impersonate, input)
}
