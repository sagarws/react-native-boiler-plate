import { CLOSE_GUARD_CHANNELS } from '@shared/constants/channels'
import { ok } from '@shared/types/result'
import { acknowledgeClosePrompt, quitAnyway } from '../windows/closeGuard'
import { registerHandler } from './handler'

const holderOf = (payload: unknown): string => {
  const holder = (payload as { holder?: unknown } | null)?.holder

  return typeof holder === 'string' && holder.trim() ? holder.trim().slice(0, 200) : 'An automation'
}

export const registerCloseGuardIpc = (): void => {
  registerHandler(CLOSE_GUARD_CHANNELS.ack, () => {
    acknowledgeClosePrompt()

    return Promise.resolve(ok(null))
  })
  registerHandler(CLOSE_GUARD_CHANNELS.quit, (payload) => {
    quitAnyway(holderOf(payload))

    return Promise.resolve(ok(null))
  })
}
