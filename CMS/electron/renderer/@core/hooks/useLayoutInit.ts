// React Imports
import { useEffect } from 'react'

// MUI Imports
import { useColorScheme } from '@mui/material'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import { useMedia } from '@core/hooks/useMedia'

/**
 * Keeps `mode: 'system'` following the operating system.
 *
 * REWRITTEN FROM Monitor's copy, which does one more thing: it writes a
 * `colorPref` cookie so the server can render the first HTML in the right
 * palette. There is no server here, and the window already opens in the right
 * palette because the stored mode rides in through the preload — so the cookie
 * half is not adapted, it is deleted.
 *
 * The signature is Monitor's, because the ported layouts call it.
 */
const useLayoutInit = (colorSchemeFallback: 'light' | 'dark') => {
  const { settings } = useSettings()
  const { setMode } = useColorScheme()
  const isDark = useMedia('(prefers-color-scheme: dark)', colorSchemeFallback === 'dark')

  useEffect(() => {
    // Only when the operator has asked to follow the system. Anything else is
    // their explicit choice and must not be overwritten by the OS changing.
    if (settings.mode === 'system') setMode(isDark ? 'dark' : 'light')
  }, [isDark, setMode, settings.mode])
}

export default useLayoutInit
