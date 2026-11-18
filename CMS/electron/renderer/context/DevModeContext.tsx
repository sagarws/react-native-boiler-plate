import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { preferencesClient } from '@renderer/services/preferences.service'

/**
 * Developer mode — the extra screens, behind a password.
 *
 * A context rather than a prop, because the two halves are far apart: it is
 * unlocked from the logo in the app shell and read by whatever it reveals, and
 * threading a boolean between them would mean touching every page in between
 * each time something new is put behind it.
 *
 * THE PASSWORD IS NEVER HERE. `unlock` sends what was typed to the main process,
 * which asks the server; a yes or a no comes back. Nothing in the renderer ever
 * holds the value, which is the point of doing it that way.
 *
 * It is not a security boundary. Everything it reveals is data the signed-in
 * operator can already read — it exists so those screens are not on by
 * accident, and a shared password is enough for that.
 */

interface DevMode {
  devMode: boolean
  /** Resolves to an error message, or null when it worked. */
  unlock: (password: string) => Promise<string | null>
  disable: () => Promise<void>
}

const DevModeContext = createContext<DevMode>({
  devMode: false,
  unlock: () => Promise.resolve('Developer mode is unavailable'),
  disable: () => Promise.resolve()
})

export const DevModeProvider = ({ children }: { children: ReactNode }) => {
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    let cancelled = false

    void preferencesClient.get().then(response => {
      if (!cancelled && response.success) setDevMode(response.data.devMode)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const unlock = useCallback(async (password: string): Promise<string | null> => {
    const response = await preferencesClient.verifyDevMode(password)

    if (!response.success) return response.error.message

    setDevMode(response.data.devMode)

    return null
  }, [])

  const disable = useCallback(async (): Promise<void> => {
    // No password to leave. Turning things off is never the risky direction.
    const response = await preferencesClient.disableDevMode()

    if (response.success) setDevMode(response.data.devMode)
  }, [])

  const value = useMemo(() => ({ devMode, unlock, disable }), [devMode, unlock, disable])

  return <DevModeContext.Provider value={value}>{children}</DevModeContext.Provider>
}

export const useDevMode = (): DevMode => useContext(DevModeContext)
