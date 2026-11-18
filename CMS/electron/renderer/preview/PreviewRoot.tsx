// React Imports
import { useEffect, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

// Context Imports
import { SettingsProvider } from '@core/contexts/settingsContext'
import { VerticalNavProvider } from '@menu/contexts/verticalNavContext'
import { NavigationProvider } from '@renderer/navigation/NavigationContext'

// Theme Imports
import { VuexyThemeProvider } from '@renderer/theme/VuexyThemeProvider'

// Component Imports
import { AppShell } from '@renderer/layout/AppShell'
import { Brand } from '@renderer/layout/Brand'
import type { ShellNavItem } from '@renderer/layout/VerticalMenuContent'
import { UiPreview } from './UiPreview'

/**
 * P1-P2 ONLY. The provider stack and the shell the real app gets at P3.
 *
 * Everything here is what App.tsx will do: settings, theme, the vertical nav's
 * own context, and the navigation shim that lets a menu written for a router
 * work against an active id. What it does NOT do is talk to the app - no auth,
 * no IPC, no data. That is the point: the shell can be dragged, collapsed and
 * screenshotted while the app it replaces carries on working untouched.
 */

/*
 * The same six screens, in the same order, with the same ids the app has always
 * used. Only the icons are new, because lucide is being retired for Monitor's
 * Tabler set.
 */
const NAV_ITEMS: readonly ShellNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'tabler-layout-dashboard' },
  { id: 'claims', label: 'Claim queue', icon: 'tabler-list-check' },
  { id: 'jobs', label: 'Jobs', icon: 'tabler-history' },
  { id: 'sessions', label: 'Login', icon: 'tabler-key' },
  { id: 'profile', label: 'User detail', icon: 'tabler-user-circle' },
  { id: 'settings', label: 'Settings', icon: 'tabler-settings' }
]

export const PreviewRoot = () => {
  const [activeId, setActiveId] = useState('dashboard')
  const active = NAV_ITEMS.find(item => item.id === activeId)

  /*
   * index.html paints the body with the OLD system's utilities
   * (`bg-slate-100 text-slate-900`), which would sit under this page and make
   * the preview a mix of the two. The app still needs them, so they are shed
   * here rather than removed there. At P3, when MUI's CssBaseline owns the
   * body, they come out of index.html for good.
   *
   * `data-platform` is what the macOS traffic-light clearance keys off. The app
   * sets it from the platform the main process reports - the renderer may not
   * read `process.platform` itself - and the preview says darwin so the inset
   * can be seen at all.
   */
  useEffect(() => {
    const previousBody = document.body.className
    const previousPlatform = document.documentElement.dataset['platform']

    document.body.className = ''
    document.documentElement.dataset['platform'] = 'darwin'

    return () => {
      document.body.className = previousBody

      if (previousPlatform === undefined) delete document.documentElement.dataset['platform']
      else document.documentElement.dataset['platform'] = previousPlatform
    }
  }, [])

  return (
    <SettingsProvider>
      <VerticalNavProvider>
        <VuexyThemeProvider systemMode='light'>
          <NavigationProvider activeId={activeId} navigate={setActiveId}>
            <AppShell
              systemMode='light'
              navItems={NAV_ITEMS}
              brand={<Brand />}
              title={
                <div className='min-is-0'>
                  <Typography variant='body2' color='text.disabled'>
                    TRACKVID OPERATIONS
                  </Typography>
                  <Typography variant='h6' className='truncate leading-tight'>
                    {active?.label ?? ''}
                  </Typography>
                </div>
              }
              actions={
                <>
                  <Button variant='tonal' size='small' startIcon={<i className='tabler-bell' />}>
                    Alerts
                  </Button>
                  <Button variant='contained' size='small' startIcon={<i className='tabler-user' />}>
                    HARISH JHA
                  </Button>
                </>
              }
              notice={
                <Alert
                  severity='error'
                  className='mbe-6'
                  icon={<i className='tabler-alert-circle' />}
                >
                  4 logins need updating - automations that sign in will fail until they are.
                </Alert>
              }
            >
              <UiPreview />
            </AppShell>
          </NavigationProvider>
        </VuexyThemeProvider>
      </VerticalNavProvider>
    </SettingsProvider>
  )
}
