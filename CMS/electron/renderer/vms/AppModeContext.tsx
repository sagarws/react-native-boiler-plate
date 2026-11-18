import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { preferencesClient } from '@renderer/services/preferences.service'

/**
 * Which half of the app is on screen: the CMS, or the VMS recorder.
 *
 * Renderer state, persisted in preferences (`appMode`) so the app reopens in
 * the half the operator last used — a packing desk opens on the recorder, an
 * office machine on the CMS. Read once at boot; `ready` stays false until that
 * read answers, so the window does not paint the CMS and then snap to the VMS.
 *
 * Switching is optimistic: the screen changes at once, and a write that fails
 * puts the previous mode back rather than claiming a choice that will not
 * survive a restart.
 */
export type AppMode = 'cms' | 'vms'

export interface AppModeApi {
  mode: AppMode
  ready: boolean
  setMode: (mode: AppMode) => void
}

const AppModeContext = createContext<AppModeApi>({ mode: 'cms', ready: true, setMode: () => undefined })

export const AppModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<AppMode>('cms')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    void preferencesClient.get().then((response) => {
      if (cancelled) return
      // Anything unreadable opens the CMS: it is the half every install has.
      if (response.success && response.data.appMode === 'vms') setModeState('vms')
      setReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // The mode as of the last render, for the rollback — read in a callback, so
  // it cannot be a dependency without re-creating `setMode` on every switch.
  const modeRef = useRef<AppMode>(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const setMode = useCallback((next: AppMode): void => {
    const previous = modeRef.current
    if (previous === next) return

    modeRef.current = next
    setModeState(next)
    void preferencesClient.setAppMode(next).then((response) => {
      if (response.success) return
      modeRef.current = previous
      setModeState(previous)
    })
  }, [])

  const value = useMemo<AppModeApi>(() => ({ mode, ready, setMode }), [mode, ready, setMode])

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>
}

export const useAppMode = (): AppModeApi => useContext(AppModeContext)
