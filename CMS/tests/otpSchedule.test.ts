import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { OTP_POLL_SCHEDULE, OTP_WAIT_MS } from '@main/services/otpSource'

/**
 * The OTP wait: up to twenty minutes, reading at 20s, 40s, 60s and then every
 * 15s. A sign-in that gave up at ninety seconds failed accounts whose mail was
 * simply late.
 */

vi.mock('@main/services/company.service', () => ({ credentialFor: () => Promise.resolve(null) }))

const { pollForOtp } = createRequire(import.meta.url)(
  '@trackvid/automation-core/platforms/flipkart/common/getOtp'
) as {
  pollForOtp: (
    fetchOnce: () => Promise<string | null>,
    options: { timeoutMs?: number; intervalMs?: number; schedule?: number[]; logger?: unknown }
  ) => Promise<string | null>
}

const quiet = { warn: () => undefined }

afterEach(() => {
  vi.useRealTimers()
})

describe('OTP poll schedule', () => {
  it('waits twenty minutes, reading at 20s, 40s, 60s and then every 15s', async () => {
    vi.useFakeTimers()

    const readAt: number[] = []
    const started = Date.now()
    const done = pollForOtp(
      () => {
        readAt.push(Math.round((Date.now() - started) / 1000))

        return Promise.resolve(null)
      },
      { timeoutMs: OTP_WAIT_MS, schedule: OTP_POLL_SCHEDULE, logger: quiet }
    )

    await vi.advanceTimersByTimeAsync(OTP_WAIT_MS + 1000)

    expect(await done).toBeNull()
    expect(readAt.slice(0, 6)).toEqual([20, 40, 60, 75, 90, 105])
    expect(readAt.at(-1)).toBe(1200)
  })

  it('stops at the first code', async () => {
    vi.useFakeTimers()

    let reads = 0
    const done = pollForOtp(
      () => {
        reads += 1

        return Promise.resolve(reads === 2 ? '123456' : null)
      },
      { timeoutMs: OTP_WAIT_MS, schedule: OTP_POLL_SCHEDULE, logger: quiet }
    )

    await vi.advanceTimersByTimeAsync(45_000)

    expect(await done).toBe('123456')
    expect(reads).toBe(2)
  })

  it('without a schedule, reads at once and then every intervalMs, as before', async () => {
    vi.useFakeTimers()

    const readAt: number[] = []
    const started = Date.now()
    const done = pollForOtp(
      () => {
        readAt.push(Date.now() - started)

        return Promise.resolve(null)
      },
      { timeoutMs: 10_000, intervalMs: 3000, logger: quiet }
    )

    await vi.advanceTimersByTimeAsync(12_000)

    expect(await done).toBeNull()
    expect(readAt).toEqual([0, 3000, 6000, 9000])
  })
})
