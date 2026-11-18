import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Flipkart gates its seller-portal login behind an emailed one-time code.
 *
 * The code is read on THIS machine, from the inbox set up in Settings → OTP
 * mailbox — there is no TrackVid relay. With no mailbox the poll returns null
 * at once, without polling anything.
 *
 * The behaviour that matters is what happens when there is NO code: this must
 * return null rather than throw, because null is what makes the login fall back
 * to asking the operator instead of failing a claim over a slow email.
 */

const mail = vi.hoisted(() => ({ read: vi.fn(), here: true }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/platformSkip.store', () => ({
  whenPlatformSkipped: () => ({ promise: new Promise(() => undefined), cancel: vi.fn() })
}))
vi.mock('@main/services/otpSource', () => ({
  OTP_WAIT_MS: 20 * 60_000,
  OTP_POLL_SCHEDULE: [20_000, 20_000, 20_000, 15_000],
  canReadOtpHere: () => mail.here,
  otpAddressFor: (_platform: string, username: string) => Promise.resolve(username),
  readOtpLocally: mail.read,
  diagnoseOtpWait: () => Promise.resolve()
}))

// The waiting and the shape check are the core's, shared with the automation
// server's Gmail lookup — the real one, not a stand-in, so this exercises the
// same loop both runners use.
vi.mock('@main/automations/common/coreLoader', async () => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)

  return {
    loadCore: (subpath: string): unknown => require_(`@trackvid/automation-core/${subpath}`)
  }
})

const { fetchFlipkartOtp } = await import('@main/services/flipkartOtp.service')

beforeEach(() => {
  vi.useFakeTimers()
  mail.read.mockReset()
  mail.here = true
})

/** Runs the poll to completion without waiting out its real window. */
const run = async (username = 'seller@example.com', since?: Date): Promise<string | null> => {
  const pending = fetchFlipkartOtp(username, since)

  await vi.runAllTimersAsync()

  return pending
}

describe('fetchFlipkartOtp', () => {
  it('returns the code as soon as one arrives', async () => {
    mail.read.mockResolvedValueOnce('483920')

    await expect(run()).resolves.toBe('483920')
    expect(mail.read).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while the mail is still on its way', async () => {
    mail.read.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('112233')

    await expect(run()).resolves.toBe('112233')
    expect(mail.read).toHaveBeenCalledTimes(3)
  })

  it('passes the cutoff so a stale code from a previous attempt is never used', async () => {
    const since = new Date('2026-09-08T07:00:00.000Z')

    mail.read.mockResolvedValueOnce('999999')
    await run('seller@example.com', since)

    expect(mail.read).toHaveBeenCalledWith('flipkart', 'seller@example.com', since)
  })

  it('returns null when nothing ever arrives, so the operator is asked', async () => {
    mail.read.mockResolvedValue(null)

    await expect(run()).resolves.toBeNull()
  })

  it('does not poll at all when no mailbox is set up on this machine', async () => {
    mail.here = false

    await expect(run()).resolves.toBeNull()
    expect(mail.read).not.toHaveBeenCalled()
  })

  it('ignores an answer that is not a code', async () => {
    mail.read.mockResolvedValueOnce('not-a-code').mockResolvedValueOnce('654321')

    await expect(run()).resolves.toBe('654321')
  })
})
