import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true, in the main process: any running
 * work may re-capture an expired login — but only on a platform whose auto-login
 * is on, and only by script.
 */

const flag = vi.hoisted(() => ({ on: true }))

vi.mock('@main/config/sessionCapturePolicy', () => ({ autoCaptureOnRunningProcess: () => flag.on }))
vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { rememberAutoLoginSettings, signInAllowed, withoutSignIn } = await import('@main/services/signInPolicy')

beforeEach(() => {
  flag.on = true
  rememberAutoLoginSettings({ delhivery: true, myntra: false })
})

describe('with the flag on', () => {
  it('lets any process sign in to a platform whose auto-login is on — unset counts as on', () => {
    expect(signInAllowed('Delhivery')).toBe(true)
    // Not in the settings at all: the company has not said off.
    expect(signInAllowed('Snapdeal')).toBe(true)
  })

  it('never a platform whose auto-login is off — a person signs in there', () => {
    expect(signInAllowed('Myntra')).toBe(false)
  })

  it('reaches inside work that otherwise never signs in, Refill included', async () => {
    await withoutSignIn(() => {
      expect(signInAllowed('Delhivery')).toBe(true)
      expect(signInAllowed('Myntra')).toBe(false)

      return Promise.resolve()
    })
  })

  it('needs a platform: a gate that names none is not opened by it', () => {
    expect(signInAllowed()).toBe(false)
  })
})

describe('with the flag off — the default build', () => {
  it('changes nothing: no process signs in on auto-login alone', () => {
    flag.on = false

    expect(signInAllowed('Delhivery')).toBe(false)
  })
})

describe('before the settings have been read', () => {
  it('signs in nowhere — unknown is not on', async () => {
    vi.resetModules()
    const fresh = await import('@main/services/signInPolicy')

    expect(fresh.signInAllowed('Delhivery')).toBe(false)
  })
})
