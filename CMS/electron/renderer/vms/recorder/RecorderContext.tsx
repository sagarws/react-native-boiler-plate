import { createContext, useContext } from 'react'
import type { AuthUser } from '@shared/vms/auth'

/**
 * What the recorder's components need from the VMS session: the feed user
 * (Argos Watch's `useAuth().user`) and the local server's port.
 *
 * Filled once by RecorderView from `useVmsSession()`, so every component below
 * reads it the way Argos Watch read `useAuth()` — and a preview can fill it with
 * a fake without the shell around it.
 */
export interface RecorderSession {
  user: AuthUser | null
  sidecarPort: number | null
}

export const RecorderSessionContext = createContext<RecorderSession>({ user: null, sidecarPort: null })

export const useRecorderSession = (): RecorderSession => useContext(RecorderSessionContext)
