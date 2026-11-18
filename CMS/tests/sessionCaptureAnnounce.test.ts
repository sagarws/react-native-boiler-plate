import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A saved session has to announce itself, from EVERY path that saves one.
 *
 * There are two, and only one of them was announcing. The quiet one is the
 * scripted local capture — which is the path the nightly Session update and its
 * Run now button both take. So a run fixed account after account in silence:
 * the Settings card kept every chip red while the sign-ins it was reporting on
 * were landing, and the stale-session banner went on naming platforms whose
 * sessions had just been replaced, until somebody pressed Refresh.
 *
 * The announcement is PER ACCOUNT, not per run, and that is the point: it is
 * what turns a chip green the moment its own sign-in succeeds, and it is the
 * only honest progress this job can show.
 */

const state = vi.hoisted(() => ({
  broadcasts: [] as { channel: string; payload: unknown }[],
  ingestOk: true,
  loginOk: true,
  /** Whether the ingest has run — the credentials endpoint answers accordingly. */
  stored: false
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test', getVersion: () => '0.0.0' },
  BrowserWindow: Object.assign(
    function () {
      return {}
    },
    { getAllWindows: () => [] }
  ),
  session: { fromPartition: () => ({ cookies: { get: () => Promise.resolve([]) } }) },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => state.broadcasts.push({ channel, payload }),
  markAppWindow: vi.fn()
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string) => {
    // The capture refuses to write a session against an account the company
    // does not list, and it checks that against session health — so the
    // credentials endpoint has to answer with the account under test.
    if (path.includes('my-company-credentials')) {
      return Promise.resolve({
        success: true,
        data: {
          platforms: [
            {
              platform: 'snapdeal',
              credentials: [
                {
                  username: 'ops@example.com',
                  credentialId: 'cred-1',
                  visible: true,
                  // The capture reads health back AFTER storing and refuses to
                  // call it a success if TrackVid still reports no session —
                  // so this has to appear only once the ingest has run.
                  session: state.stored
                    ? {
                        capturedAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                        jar: { a: '1', b: '2', c: '3' }
                      }
                    : null
                }
              ]
            }
          ]
        }
      })
    }

    if (!state.ingestOk) {
      return Promise.resolve({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'the backend said no' }
      })
    }

    state.stored = true

    return Promise.resolve({ success: true, data: { message: 'saved' } })
  }
}))
vi.mock('@main/services/automationRouting.service', () => ({
  autoLoginEnabled: () => Promise.resolve(true),
  clearRoutingCache: vi.fn()
}))
vi.mock('@main/config/env', () => ({
  env: { useBackendForSessionUpdate: false, sessionUpdateAutomatically: true }
}))
vi.mock('@main/services/localLogin.service', () => ({
  loginLocally: () =>
    Promise.resolve(
      state.loginOk
        ? {
            success: true,
            data: {
              jar: { 'erp.at': 'x', session: 'y', other: 'z' },
              cookieNames: ['erp.at', 'session', 'other'],
              tokens: null,
              extra: null,
              durationMs: 10
            }
          }
        : { success: false, error: { code: 'INTERNAL_ERROR', message: 'sign-in refused' } }
    ),
  operatorLoginLocally: vi.fn(),
  needsRealBrowserForManualSignIn: () => false
}))
vi.mock('@main/services/localSession.store', () => ({ rememberSession: vi.fn() }))
vi.mock('@main/services/company.service', () => ({
  rememberCompanySession: vi.fn(),
  refusedLogins: () => Promise.resolve(new Set<string>()),
  // The capture refuses to write a session against an account the company does
  // not list, so the account under test has to exist.
  credentialsFor: () =>
    Promise.resolve([{ username: 'ops@example.com', credentialId: 'cred-1', visible: true }]),
  credentialFor: () =>
    Promise.resolve({ username: 'ops@example.com', credentialId: 'cred-1', isOtpBased: null }),
  rememberOtpMode: vi.fn()
}))
vi.mock('@trackvid/automation-core/common/probeSession', () => ({
  // "Cannot tell" — the capture proceeds, which is the path under test.
  probePlatformSession: () => Promise.resolve(null)
}))
vi.mock('@main/services/pendingSession.store', () => ({
  discardPending: vi.fn(),
  listPending: () => Promise.resolve([]),
  queuePending: vi.fn(),
  readPending: () => Promise.resolve(null)
}))
vi.mock('@main/services/sessionRejection.store', () => ({
  sessionRejectionKey: (platform: string, username: string) => `${platform}:${username}`,
  // A Map, not an object — the reader asks it for `.size` and `.get`.
  sessionRejections: () => Promise.resolve(new Map())
}))
vi.mock('@main/services/sessionReuse.service', () => ({ reusableSession: vi.fn() }))
vi.mock('@main/services/offlineCache', () => ({
  withOfflineCache: (_key: string, fetcher: () => unknown) => fetcher()
}))
vi.mock('@main/services/preferences.service', () => ({
  getPreferences: () => ({ myntraHeadlessLogin: false })
}))
vi.mock('@main/services/credentialSecret.service', () => ({ credentialSecret: vi.fn() }))
vi.mock('@main/services/serverRenew.service', () => ({ renewSessionOnServer: vi.fn() }))
vi.mock('@main/services/loginDriver.service', () => ({ driveLogin: vi.fn() }))

const { captureSession } = await import('@main/services/platformSession.service')
const { PLATFORM_SESSION_EVENTS } = await import('@shared/constants/channels')

const changed = (): { platform: string; username: string }[] =>
  state.broadcasts
    .filter(entry => entry.channel === PLATFORM_SESSION_EVENTS.changed)
    .map(entry => entry.payload as { platform: string; username: string })

beforeEach(() => {
  state.broadcasts.length = 0
  state.ingestOk = true
  state.loginOk = true
  state.stored = false
})

describe('the scripted capture the nightly run uses', () => {
  it('announces the account the moment its session is stored', async () => {
    const result = await captureSession({
      platform: 'snapdeal',
      username: 'ops@example.com',
      credentialId: 'cred-1'
    })

    expect(result.success).toBe(true)
    // Named, so a listener can turn THAT chip green rather than re-reading
    // everything and hoping.
    expect(changed()).toEqual([{ platform: 'snapdeal', username: 'ops@example.com' }])
  })

  it('says nothing when the sign-in failed', async () => {
    state.loginOk = false

    const result = await captureSession({
      platform: 'snapdeal',
      username: 'ops@example.com',
      credentialId: 'cred-1'
    })

    expect(result.success).toBe(false)
    // A chip that went green here would be claiming a session that does not
    // exist — worse than the silence this fixes.
    expect(changed()).toEqual([])
  })

  it('says nothing when the backend refused to store it', async () => {
    state.ingestOk = false

    await captureSession({
      platform: 'snapdeal',
      username: 'ops@example.com',
      credentialId: 'cred-1'
    })

    expect(changed()).toEqual([])
  })
})
