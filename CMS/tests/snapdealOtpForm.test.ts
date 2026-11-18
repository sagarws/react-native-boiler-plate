import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * Snapdeal's OTP panel: recognising it, and being able to ANSWER it.
 *
 * WHY BOTH ARE PINNED. `otp` says a code was asked for; `otpEntry` says where
 * to type one. A form carrying the first without the second looks fine in every
 * reading of the code and silently hands every challenged account back to the
 * operator — which is the state this change exists to end, and exactly what it
 * would regress to.
 *
 * The selectors are the portal's own, from the panel that reads "Attention! To
 * access this panel you need to validate the OTP".
 */

const load = createRequire(import.meta.url)

interface Form {
  platform: string
  otp?: { anySelector?: string[] }
  otpEntry?: { input: string; submit: string }
}

const form = load('@trackvid/automation-core/platforms/snapdeal/common/loginForm') as Form

describe('the Snapdeal sign-in form', () => {
  it('recognises the one-time code panel', () => {
    expect(form.otp?.anySelector).toContain('#otp')
  })

  it('knows where to type a code and how to submit it', () => {
    // Without this the driver can only report "challenged": it can see the
    // panel and has nowhere to put the code it just read.
    expect(form.otpEntry).toEqual({ input: '#otp', submit: '#otp-button' })
  })

  it('answers the panel it recognises', () => {
    // The two must describe the SAME panel. A recogniser pointing at one
    // element and an entry at another is a driver that types into a box the
    // portal is not reading.
    const recognised = form.otp?.anySelector ?? []

    expect(recognised.some(selector => selector.endsWith(form.otpEntry?.input ?? ''))).toBe(true)
  })
})

describe('the Snapdeal mailbox reader', () => {
  const otp = load('@trackvid/automation-core/platforms/snapdeal/common/getOtp') as {
    codeIn: (body: string) => string | null
    SENDER: string
    SUBJECT: string
    pollForOtp: unknown
  }

  it('reads the code out of the mail body', () => {
    expect(otp.codeIn('Dear seller, your OTP is 835374. Valid for 10 minutes.')).toBe('835374')
  })

  it('is not fooled by the validity window or the year', () => {
    // The body carries "10 minutes" and a footer year. Either would be a
    // plausible code to a naive reader, and a wrong code reads to an operator
    // exactly like a wrong password.
    expect(otp.codeIn('This code is valid for 10 minutes. (c) 2026 Snapdeal')).toBe(null)
  })

  it('filters on the envelope sender, not the reply-to', () => {
    // Filtering on support@cxesnapdeal.in matches nothing at all.
    expect(otp.SENDER).toBe('snapdeal@sdseller.co.in')
    expect(otp.SUBJECT).toBe('Snapdeal(OTP) - Your OTP details!')
  })

  it('exposes the shared waiter, so a caller never reaches into Flipkart', () => {
    // A module that used it without re-exporting it is how another platform
    // shipped "r is not a function" into a packaged build.
    expect(typeof otp.pollForOtp).toBe('function')
  })
})
