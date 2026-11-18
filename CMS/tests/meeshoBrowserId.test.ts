import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * The `browser-id` header Meesho's claim submit started requiring.
 *
 * Claims filed normally for a day or two, then failed every time with a bare
 * HTTP 500 and an empty `backendData.error` — while the same seller filing the
 * same AWB by hand went through. Nothing had changed here, so something had
 * changed there: `createTicket` began caring about a header this code
 * deliberately did not send.
 *
 * It was left out as a per-browser fingerprint nothing here could honestly
 * supply. That was half right. The value is already in the session — the
 * `browser_id` cookie carries the same string, percent-encoded — so forwarding
 * it invents nothing, and avoids the far worse alternative of one hard-coded
 * fingerprint shared by every seller on every machine.
 *
 * See Error_Case/MeeshoClaim/createTicket-500-empty-backendData.txt.
 */

interface BrowserId {
  browserId: (jar: unknown) => string
  browserIdHeader: (jar: unknown) => Record<string, string>
}

const { browserId, browserIdHeader } = require_(
  '@trackvid/automation-core/platforms/meesho/common/browserId'
) as BrowserId

/** The shapes from the 2026-09-19 capture, with the token itself replaced. */
const TOKEN = 'QUJDICsgMTIzICsgeHl6'
const ENCODED = `${TOKEN}%3D%3D`
const DECODED = `${TOKEN}==`

describe('the browser-id header', () => {
  it('reads it from the jar this package stores (a name/value map)', () => {
    expect(browserId({ browser_id: ENCODED, connect_sid: 'x' })).toBe(DECODED)
  })

  it('reads it from the array shape too', () => {
    // Meesho stores a name-value map, but the harvest hands round arrays of
    // cookie objects and this is called on whatever the caller holds.
    expect(browserId([{ name: 'other', value: 'x' }, { name: 'browser_id', value: ENCODED }])).toBe(
      DECODED
    )
  })

  it('percent-decodes, because the cookie and the header are not the same string', () => {
    // The cookie carries "…%3D%3D" where the header carries "…==". Sending the
    // encoded form would be sending a different value — which is the whole bug
    // this guards, one layer down.
    expect(browserId({ browser_id: ENCODED })).not.toBe(ENCODED)
    expect(browserId({ browser_id: ENCODED })).toBe(DECODED)
  })

  it('leaves an already-decoded value alone', () => {
    expect(browserId({ browser_id: DECODED })).toBe(DECODED)
  })

  it('sends nothing when the jar has no such cookie', () => {
    // An older session must behave exactly as it did before this existed, not
    // worse: no header at all, rather than an empty one.
    expect(browserIdHeader({ connect_sid: 'x' })).toEqual({})
    expect(browserIdHeader({})).toEqual({})
    expect(browserIdHeader(null)).toEqual({})
    expect(browserIdHeader(undefined)).toEqual({})
  })

  it('sends the header when it can', () => {
    expect(browserIdHeader({ browser_id: ENCODED })).toEqual({ 'browser-id': DECODED })
  })

  it('does not confuse browser_uid with browser_id', () => {
    // The jar carries both. `browser_uid` is a UUID and a different thing.
    expect(browserId({ browser_uid: '5689d8e2-9950-448c-9cc4-211b7a1d41ae' })).toBe('')
  })

  it('survives a value that will not decode', () => {
    // A stray "%" is not a reason to drop the header: as it stands is still
    // closer to right than nothing.
    expect(browserId({ browser_id: '100%' })).toBe('100%')
  })
})
