// React Imports
import type { ReactElement } from 'react'

// Type Imports
import type { SystemMode } from '@core/types'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import useLayoutInit from '@core/hooks/useLayoutInit'

/**
 * PORTED FROM TrackVid-Monitor (src/@layouts/LayoutWrapper.tsx).
 *
 * Monitor takes both a vertical and a horizontal layout and picks between them
 * from the settings. This app ships the vertical one only — a desktop window
 * has a single shell, and carrying the horizontal menu would have meant porting
 * a second menu package for a layout nobody would choose — so the prop and the
 * branch are gone. `data-skin` stays: it is what the bordered skin selects on.
 */

type LayoutWrapperProps = {
  systemMode: SystemMode
  verticalLayout: ReactElement
}

const LayoutWrapper = (props: LayoutWrapperProps) => {
  // Props
  const { systemMode, verticalLayout } = props

  // Hooks
  const { settings } = useSettings()

  useLayoutInit(systemMode)

  return (
    <div className='flex flex-col flex-auto' data-skin={settings.skin}>
      {verticalLayout}
    </div>
  )
}

export default LayoutWrapper
