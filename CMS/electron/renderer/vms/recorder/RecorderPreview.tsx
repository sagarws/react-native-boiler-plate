import { useEffect, useMemo, useState } from 'react'
import { SettingsProvider } from '@core/contexts/settingsContext'
import { VerticalNavProvider } from '@menu/contexts/verticalNavContext'
import { NotificationProvider } from '@renderer/components/feedback/NotificationStore'
import { ToastProvider } from '@renderer/components/feedback/ToastProvider'
import { initialAppearance } from '@renderer/services/preferences.service'
import { VuexyThemeProvider } from '@renderer/theme/VuexyThemeProvider'
import { MediaPermissionsProvider } from '@renderer/vms/context/MediaPermissionsContext'
import { PermissionsDialog } from '@renderer/vms/permissions/PermissionsDialog'
import type { AuthUser, SessionState } from '@shared/vms/auth'
import { SIGNED_OUT } from '@shared/vms/auth'
import { RecorderView } from './RecorderView'
import '@renderer/styles/app.css'

/**
 * PREVIEW ONLY — the recorder inside the CMS theme, on a fake feed session,
 * for the stub-bridge screenshot harness. Never part of the app.
 *
 * Reached through `#vms-recorder-preview[=variant]` (the lead adds the hash
 * branch to main.tsx):
 *
 *   (none)        webcam feed
 *   rtsp          RTSP feed with a URL (the stub has no server: error state)
 *   rtsp-none     RTSP feed with no URL configured
 *   no-user       session without a user (the loading state)
 *
 * Renders RecorderView rather than RecorderPage because the shell's
 * VmsSessionContext does not export a context a preview could fill; the page is
 * RecorderView plus `useVmsSession()` and nothing else.
 */

const fakeUser = (variant: string): AuthUser => ({
  id: 'preview-user',
  email: 'station@example.com',
  name: { firstName: 'Packing', lastName: 'Station', fullName: 'Packing Station 1' },
  phone: { code: '+91', number: '9000000000', countryCode: 'IN' },
  feedId: 'feed-1',
  feed: {
    _id: 'feed-1',
    feedName: 'Station 1',
    isDisable: false,
    isDeleted: false,
    isSelectedFeed: true,
    cameraType: variant.startsWith('rtsp') ? 'rtsp' : 'webcam',
    rtspURL: variant === 'rtsp' ? 'rtsp://preview.invalid/stream' : '',
    companyId: 'company-1',
    createdBy: 'preview',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z'
  },
  companyId: 'company-1',
  company: {
    id: 'company-1',
    name: 'Example Retail',
    ecommercePlatform: [{ id: 'p1', name: 'Myntra', isActive: true }],
    compressPercentage: 'similar',
    returnConditionPopup: { isShow: true, isRedirectOnBad: false }
  },
  displayName: 'Packing Station 1'
})

const variantFromHash = (): string => decodeURIComponent(window.location.hash.replace(/^#vms-recorder-preview=?/, ''))

const sessionFor = (variant: string): SessionState =>
  variant === 'no-user'
    ? SIGNED_OUT
    : { authenticated: true, user: fakeUser(variant), loggedInAt: '2026-11-18T04:30:00.000Z' }

const storedAppearance = initialAppearance()

export const RecorderPreview = () => {
  const [variant, setVariant] = useState(variantFromHash)
  const session = useMemo(() => sessionFor(variant), [variant])

  useEffect(() => {
    const onHash = (): void => setVariant(variantFromHash())

    window.addEventListener('hashchange', onHash)

    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <SettingsProvider
      storedSettings={{
        mode: storedAppearance.theme.mode,
        skin: storedAppearance.theme.skin,
        primaryColor: storedAppearance.theme.primaryColor,
        contentWidth: storedAppearance.theme.contentWidth,
        font: storedAppearance.theme.font
      }}
    >
      <VerticalNavProvider>
        <VuexyThemeProvider systemMode='light'>
          <NotificationProvider>
            <ToastProvider>
              <MediaPermissionsProvider>
                <main className='min-h-screen p-6' style={{ background: 'var(--veylix-page-bg)' }}>
                  <RecorderView key={variant} session={session} sidecarPort={variant === 'no-port' ? null : 8002} />
                </main>
                <PermissionsDialog />
              </MediaPermissionsProvider>
            </ToastProvider>
          </NotificationProvider>
        </VuexyThemeProvider>
      </VerticalNavProvider>
    </SettingsProvider>
  )
}
