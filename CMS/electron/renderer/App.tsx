import { useCallback, useEffect, useMemo, useState } from 'react'
import Divider from '@mui/material/Divider'
import { SYSTEM_CHANNELS } from '@shared/constants/channels'
import type { PlatformInfo } from '@shared/types/ipc'

import { ToastProvider } from './components/feedback/ToastProvider'
import { NotificationProvider } from './components/feedback/NotificationStore'
import { NotificationBell } from './components/feedback/NotificationBell'
import { CloseGuardDialog } from './components/CloseGuardDialog'
import { MandatoryUpdateScreen, UpdateBanner } from './components/update/UpdateNotice'
import { UserMenu } from './components/user/UserMenu'
import { AuthProvider } from './context/AuthContext'
import { DevModeProvider, useDevMode } from './context/DevModeContext'
import { useAuth } from './hooks/useAuth'
import { useUpdater } from './hooks/useUpdater'
import { useClaimActivity } from './hooks/useClaimActivity'
import { AppShell as Shell } from './layout/AppShell'
import { Brand } from './layout/Brand'
import { PageBreadcrumb } from './layout/PageBreadcrumb'
import { PageHeading } from './layout/PageHeading'
import type { ShellNavItem } from './layout/VerticalMenuContent'
import { NavigationProvider } from './navigation/NavigationContext'
import { SettingsProvider, type Settings } from '@core/contexts/settingsContext'
import { VerticalNavProvider } from '@menu/contexts/verticalNavContext'
import { VuexyThemeProvider } from './theme/VuexyThemeProvider'
import { StaleSessionBanner } from './components/session/StaleSessionBanner'
import { useStaleLogins } from './hooks/useStaleLogins'
import { TermsGate } from './components/TermsGate'
import { BrowserCheckNotice } from './components/BrowserCheckNotice'
import { SyncButton } from './components/layout/SyncButton'
import { CronSwitch } from './components/layout/CronSwitch'
import { LoginPage } from './pages/auth/LoginPage'
import { ClaimsPage } from './pages/claims/ClaimsPage'
import { CreateClaimPage } from './pages/claims/create/CreateClaimPage'
import { ClaimCatalogueProvider } from './pages/claims/create/ClaimCatalogue'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { SessionsPage } from './pages/sessions/SessionsPage'
import { JobsPage } from './pages/jobs/JobsPage'
import { LocalDatabasePage } from './pages/database/LocalDatabasePage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { EmailReplyPage } from './pages/email/EmailReplyPage'
import { UserDetailPage } from './pages/profile/UserDetailPage'
import { invoke } from './services/ipcClient'
import { initialAppearance, preferencesClient } from './services/preferences.service'

/**
 * One icon set, one weight, one size.
 *
 * Tabler, bundled as CSS masks from TrackVid-Monitor's set — the same icons the
 * two products now share. They were lucide components until the port; before
 * that they were Unicode glyphs, which render differently on Windows and macOS
 * and cannot be sized reliably.
 */
const NAV_ITEMS: readonly ShellNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'tabler-layout-dashboard' },
  // Straight after the Dashboard, because filing a claim by hand is the first
  // thing an operator does in the morning — before looking at what the runner
  // did overnight.
  { id: 'create-claim', label: 'Create claim', icon: 'tabler-file-plus' },
  { id: 'claims', label: 'Manage Claims', icon: 'tabler-list-check' },
  // Beside the queue, because a run is started from it and read back here.
  { id: 'jobs', label: 'Background Process', icon: 'tabler-history' },
  // "Login" rather than "Sessions": what the page is FOR is the marketplace
  // sign-ins, and a session is the artefact of one.
  { id: 'sessions', label: 'Login', icon: 'tabler-key' },
  // What this machine has stored, table by table — and editable, behind a switch.
  { id: 'local-db', label: 'Local Database', icon: 'tabler-database' },
  // The AJIO email auto-reply, read from TrackVid: its mailboxes and the
  // footage requests it has (or has not) answered. View only.
  { id: 'email-reply', label: 'Email Reply', icon: 'tabler-mail' },
  // The user's own details are not a place to go — they are one line in the
  // account menu, which is where somebody looks for them. The page itself is
  // still reachable from there.
  { id: 'settings', label: 'Settings', icon: 'tabler-settings' }
]

/** Pages listed in the rail only while developer mode is on. */
// Email Reply too: it holds mailbox credentials' actions (Refetch, Reply) and
// is not yet for every operator.
const DEV_ONLY_PAGES: ReadonlySet<string> = new Set(['local-db', 'email-reply'])

/** Full-window state shown while the main process reports back on a stored session. */
const SessionSplash = () => (
  <div className="flex h-full items-center justify-center bg-canvas">
    <span
      aria-hidden="true"
      className="size-6 animate-spin rounded-full border-2 border-strong border-t-accent"
    />
    <span className="sr-only" role="status">
      Loading
    </span>
  </div>
)

const AppShell = () => {
  const auth = useAuth()
  const [activeId, setActiveId] = useState('dashboard')
  /*
   * The stale-login count, for the rail.
   *
   * Read here rather than inside the rail because NAV_ITEMS is a module
   * constant — the rail renders what it is given, and what it is given is a
   * function of app state. The banner is handed the SAME result as props, so
   * the number on the Login entry and the number on the Login page cannot
   * disagree — and only one component issues the IPC reads behind them.
   */
  const {
    entries: staleEntries,
    accounts: staleLogins,
    claimEntries: claimStaleEntries,
    claimAccounts: claimStaleLogins
  } = useStaleLogins()

  /*
   * NAV_ITEMS with the Login count attached.
   *
   * Memoised on the count alone: the rail re-renders on every keystroke in a
   * page above it otherwise, and a new array each time would defeat the
   * menu's own memoisation.
   */
  // Local Database edits the app's own state files, so it is a developer tool:
  // listed only while developer mode is on.
  const { devMode } = useDevMode()
  const navItems = useMemo(
    () =>
      NAV_ITEMS.filter(item => devMode || !DEV_ONLY_PAGES.has(item.id)).map(item =>
        item.id === 'sessions' && staleLogins > 0 ? { ...item, badge: staleLogins } : item
      ),
    [staleLogins, devMode]
  )

  // Developer mode switched off while on a developer page: back to the start.
  const visibleId = !devMode && DEV_ONLY_PAGES.has(activeId) ? 'dashboard' : activeId
  /**
   * The claim Create Claim opens on, when it is opened to EDIT one.
   *
   * The same screen does both jobs — the web app splits them across two URLs,
   * and a desktop window has no address bar to put the difference in. Cleared
   * whenever the operator picks the nav item, so choosing "Create claim" always
   * means a new one.
   */
  const [editTarget, setEditTarget] = useState<{ awb: string; platform: string } | null>(null)

  const navigate = useCallback((id: string) => {
    if (id === 'create-claim') setEditTarget(null)
    setActiveId(id)
  }, [])
  const [platform, setPlatform] = useState<PlatformInfo | null>(null)
  /**
   * The heading over the content, which is not always a nav item.
   *
   * The user's own details are reached from the account menu rather than the
   * rail, so the rail cannot name that screen — and a blank heading reads as a
   * page that failed to load.
   */
  const OFF_RAIL_TITLES: Record<string, string> = { profile: 'User detail' }
  const activeLabel =
    NAV_ITEMS.find(item => item.id === visibleId)?.label ?? OFF_RAIL_TITLES[visibleId] ?? ''
  const updater = useUpdater()

  /**
   * Which staged version the operator has said "Later" to.
   *
   * KEYED BY VERSION, not a plain boolean: dismissing 0.1.17 must not also
   * hide 0.1.18 when that arrives later in the same session. Session-scoped on
   * purpose — the notice returns on the next launch, because postponing an
   * update is not the same as never being told about it again.
   *
   * A FORCED update never gets here: `state.mandatory` short-circuits to the
   * blocking screen below, which has no dismiss at all.
   */
  const [postponed, setPostponed] = useState<string | null>(null)
  const updateHidden = postponed !== null && postponed === updater.state.latest

  // Mounted at the shell, not on the claims page: claims arrive over a socket
  // and are filed automatically, and the operator is usually looking at
  // something else when one lands.
  useClaimActivity()

  useEffect(() => {
    let cancelled = false

    void invoke<PlatformInfo>(SYSTEM_CHANNELS.getPlatformInfo).then((response) => {
      if (cancelled || !response.success) return

      setPlatform(response.data)

      /*
       * The window's own platform, put where CSS can see it.
       *
       * macOS draws its three window buttons over the top-left corner of
       * whatever the app renders there, so the rail's header has to start below
       * them — and the renderer is not allowed to read `process.platform`
       * itself. This is the one place that answer arrives, so this is where it
       * is published. See styles/window.css.
       */
      document.documentElement.dataset['platform'] = response.data.platform
    })

    return () => {
      cancelled = true
    }
  }, [])

  // The launch check runs in the main process; this component only listens.
  // A mandatory update outranks everything, including the login screen: there is
  // no point signing in to a build the server has retired.
  if (updater.state.mandatory) {
    return (
      <div className='legacy-ui h-full'>
        <MandatoryUpdateScreen
          state={updater.state}
          onCheck={updater.check}
          checking={updater.checking}
        />
      </div>
    )
  }

  /*
   * The splash renders BEFORE the shell exists and still belongs to the old
   * system, so it carries its scope too — otherwise its `text-primary` is
   * Monitor's brand purple rather than the old system's ink. It is
   * full-window, so it is `legacy-ui` and not `legacy-tokens`. The sign-in
   * screen has moved to MUI and needs no wrapper.
   */
  if (auth.status === 'loading') {
    return (
      <div className='legacy-ui h-full'>
        <SessionSplash />
      </div>
    )
  }

  if (auth.status === 'unauthenticated') {
    return <LoginPage appVersion={platform?.appVersion} />
  }

  return (
    <NavigationProvider activeId={visibleId} navigate={navigate}>
      <Shell
        systemMode='light'
        navItems={navItems}
        brand={<Brand />}
        navFooter={
          /*
            The schedule's master switch sits above the build line, because it
            is the one control an operator needs from every screen: the nightly
            automations run with nobody watching, and "stop them" should not
            require finding the right settings tab first.
          */
          <div className='flex flex-col gap-2'>
            <CronSwitch onOpenLogin={() => navigate('sessions')} />
            {platform && (
              <span className='text-xs text-muted'>
                v{platform.appVersion} · {platform.platform} {platform.arch}
              </span>
            )}
          </div>
        }
        navAlert={<BrowserCheckNotice />}
        title={
          <PageBreadcrumb
            root='TrackVid Operations'
            current={activeLabel}
            onRoot={activeId === 'dashboard' ? undefined : () => navigate('dashboard')}
          />
        }
        actions={
          auth.user && (
            /* Old components on the new shell's navbar: they need the outgoing
               system's tokens, but not its background — see styles/legacy.css. */
            <div className='legacy-tokens flex items-center gap-1'>
              {!updateHidden && (
                <UpdateBanner
                  state={updater.state}
                  onInstall={updater.install}
                  onDismiss={() => setPostponed(updater.state.latest)}
                />
              )}
              {/* Everything the app has said this session. A toast is four
                  seconds and one line; this is where the rest of it lives. */}
              <NotificationBell />
              {/* App-wide, so it sits with the account rather than in a page
                  header. One click does both tiers: the shared data every
                  screen depends on, and whatever this screen is showing. */}
              <SyncButton />
              <Divider orientation='vertical' flexItem className='mli-2 mlb-2' />
              <UserMenu
                user={auth.user}
                companyName={auth.companyName}
                onViewProfile={() => setActiveId('profile')}
                onSignOut={() => void auth.signOut()}
                // The name is read at sign-in, usually before the company
                // document has downloaded. Ask again until it is there.
                onOpen={auth.companyName ? undefined : () => void auth.refresh()}
              />
            </div>
          )
        }
        // Every signed-in page. A dead session is not only a Sessions-page
        // concern: it is why a claim fails on the Claim queue and why the
        // Dashboard's numbers stopped moving. Rendered here, it reaches all of
        // them; it returns null when everything is healthy. The login screen
        // returns earlier, so public pages never mount it.
        /*
         * THE LOGIN PAGE ONLY, and the rail carries it everywhere else.
         *
         * This was on every signed-in page, for a sound reason: a dead session
         * is why a claim fails on the queue and why the Dashboard stops moving,
         * so the condition has to be visible from anywhere. What did not hold
         * is that the whole EXPLANATION had to be — a full-width tinted band on
         * all six screens, permanently, is how a warning stops being read.
         *
         * So the signal and the explanation were split. `navItems` above puts a
         * count on the Login entry from every screen; this strip, which names
         * each platform and carries the button that fixes them, sits on the
         * page where that work happens. Both read `useStaleLogins`, so they
         * cannot disagree.
         *
         * It still returns null when everything is healthy.
         *
         * AND ON CREATE CLAIM, with the CLAIM's rule (`claimEntries`): every
         * verified login with no working session, manual-sign-in platforms
         * included. A claim saved under one is skipped by Auto claim until
         * somebody re-captures it, so the operator is told — and handed the
         * button — where they are creating the claims.
         */
        notice={
          activeId === 'sessions' ? (
            <StaleSessionBanner entries={staleEntries} accounts={staleLogins} />
          ) : activeId === 'create-claim' ? (
            <StaleSessionBanner entries={claimStaleEntries} accounts={claimStaleLogins} />
          ) : null
        }
      >
        {/*
          ONE WRAPPER PER SCREEN, not one around all of them.
          `legacy-ui` is what gives a screen the outgoing design system's tokens
          inside a shell that carries Monitor's — see styles/legacy.css. A screen
          that has been migrated renders WITHOUT it, which is how you can tell at
          a glance which ones are left. When the list is empty, the wrapper, the
          stylesheet behind it and styles/theme.css all go together.
        */}
        {/* The page's own title, in the template's heading style. */}
        <PageHeading title={activeLabel} />

        {activeId === 'dashboard' && <DashboardPage onNavigate={navigate} />}

        {/* The bulk windows' History button leads here rather than opening a
            second modal over the first — see JobsPage. */}
        {activeId === 'claims' && (
          <ClaimsPage
            onOpenJobs={() => setActiveId('jobs')}
            onEditClaim={(target) => {
              setEditTarget(target)
              setActiveId('create-claim')
            }}
          />
        )}

        {/* Filing a claim by hand, and editing one already filed. */}
        {activeId === 'create-claim' && (
          <ClaimCatalogueProvider>
            <CreateClaimPage
              target={editTarget ?? undefined}
              onBack={editTarget ? () => setActiveId('claims') : undefined}
            />
          </ClaimCatalogueProvider>
        )}
        {activeId === 'jobs' && <JobsPage />}
        {activeId === 'sessions' && <SessionsPage />}
        {visibleId === 'local-db' && <LocalDatabasePage />}
        {visibleId === 'email-reply' && <EmailReplyPage />}
        {activeId === 'settings' && <SettingsPage />}
        {activeId === 'profile' && (
          <UserDetailPage
            update={updater.state}
            onCheckForUpdate={updater.check}
            checkingUpdate={updater.checking}
          />
        )}

        {/* Asked when the window is closed mid-run. Off the shell (the login
            screen), main falls back to the system dialog. */}
        <CloseGuardDialog onOpenJobs={() => navigate('jobs')} />
      </Shell>
    </NavigationProvider>
  )
}

/**
 * The customizer's answers, read at first paint and written back when changed.
 *
 * READ SYNCHRONOUSLY. The stored appearance rides in through the preload with
 * the first render, so the window opens in the operator's mode and colour
 * rather than painting the default and snapping a frame later.
 *
 * WRITTEN AS PART OF THE WHOLE RECORD. The theme settings live inside the
 * appearance, so persisting them means merging — writing only the theme would
 * drop the rail width stored beside it.
 */
const storedAppearance = initialAppearance()

const persistThemeSettings = (settings: Settings): void => {
  void preferencesClient.setAppearance({
    ...storedAppearance,
    theme: {
      ...storedAppearance.theme,
      mode: settings.mode ?? storedAppearance.theme.mode,
      skin: settings.skin ?? storedAppearance.theme.skin,
      primaryColor: settings.primaryColor ?? storedAppearance.theme.primaryColor,
      contentWidth: settings.contentWidth ?? storedAppearance.theme.contentWidth,
      font: settings.font ?? storedAppearance.theme.font
    }
  })
}

const App = () => (
  /*
   * TWO THEME SYSTEMS, for as long as the migration lasts.
   *
   * `SettingsProvider` + `VuexyThemeProvider` are the ported one: they own the
   * shell, the mode, the skin, the typeface and every migrated screen. The
   * screens that have not moved yet render from the outgoing token names, which
   * styles/legacy.css resolves to MUI's palette — so there is one set of
   * colours on screen even though there are still two sets of components.
   *
   * The old ThemeProvider and AppearanceProvider are gone with the panel that
   * drove them; styles/theme.css goes at P5 with the last old screen.
   */
  <SettingsProvider
    storedSettings={{
      mode: storedAppearance.theme.mode,
      skin: storedAppearance.theme.skin,
      primaryColor: storedAppearance.theme.primaryColor,
      contentWidth: storedAppearance.theme.contentWidth,
      font: storedAppearance.theme.font
    }}
    onPersist={persistThemeSettings}
  >
    <VerticalNavProvider>
      {/* Outermost of the ported stack: the login screen and the mandatory
          update screen render before auth resolves and must be themed too. */}
      <VuexyThemeProvider systemMode='light'>
        {/* Outside ToastProvider: a toast writes its full text into this
            store, so the store has to exist first. */}
        <NotificationProvider>
          <ToastProvider>
            <AuthProvider>
              {/* Inside auth: unlocking asks the server, which needs the
                  operator's token — and there is nothing to reveal before they
                  sign in. */}
              <DevModeProvider>
                {/* Before anything else the operator can touch: the notice is
                    the first thing a company sees, and once accepted it is
                    never shown again. */}
                <TermsGate>
                  <AppShell />
                </TermsGate>
              </DevModeProvider>
            </AuthProvider>
          </ToastProvider>
        </NotificationProvider>
      </VuexyThemeProvider>
    </VerticalNavProvider>
  </SettingsProvider>
)

export default App
