import { describe, expect, it } from 'vitest'
import {
  documentHasEvidence,
  isRowSelectable,
  isSelectableStatus,
  MAX_CLAIM_ATTEMPTS,
  resolveActiveStatus,
  selectionBlockReason,
  type SelectableRow
} from '@shared/constants/claims'

/**
 * Which claims may be selected for filing.
 *
 * Filing is for claims that have not reached the marketplace yet. Everything
 * else on that page — In Review, Approved, Rejected, Customer Replied — is a
 * claim that already exists there, and Create Ticket on one raises a SECOND
 * ticket for the same return. That is the single outcome on this screen nobody
 * can undo, so the checkbox column is hidden on those tabs rather than merely
 * ignored: a control that looks usable is an invitation to use it.
 */

const canSelect = isSelectableStatus

// The core's cap as vitest inlines it (vitest.config.ts) — a number here, so the
// cap's own behaviour can be pinned. "unlimited" is claimAttemptLimit's to test.
const CAP = MAX_CLAIM_ATTEMPTS ?? Number.NaN

describe('isSelectableStatus', () => {
  it('allows the two statuses that have not been filed yet', () => {
    expect(canSelect('Failed to Proceed')).toBe(true)
    expect(canSelect('Pending')).toBe(true)
  })

  it('refuses every status that means the claim is already with the marketplace', () => {
    for (const status of [
      'In Review',
      'Un Attended',
      'In Progress',
      'Customer Replied',
      'Approved',
      'Rejected',
      'Resolved',
      'Awaiting Seller Response',
      'Awaiting Agent Response',
      'Paid'
    ]) {
      expect(canSelect(status)).toBe(false)
    }
  })

  it('refuses "All", which mixes both', () => {
    // A Select-all there would tick claimable rows and already-filed ones
    // together — the worst of the two behaviours.
    expect(canSelect('All')).toBe(false)
  })
})

/**
 * Keeping the operator's place when they change marketplace.
 *
 * Switching platform used to call `setStatus('All')`, so someone working
 * through Pending claims lost their filter every time they moved between
 * marketplaces — which is most of what that page is for.
 */
const AJIO_TABS = [
  { value: 'All' },
  { value: 'Failed to Proceed' },
  { value: 'Pending' },
  { value: 'In Review' },
  { value: 'Un Attended' },
  { value: 'Resolved' }
]
const MEESHO_TABS = [
  { value: 'All' },
  { value: 'Failed to Proceed' },
  { value: 'Pending' },
  { value: 'In Review' },
  { value: 'Approved' },
  { value: 'Rejected' }
]

describe('resolveActiveStatus', () => {
  it('keeps the chosen tab when the new platform has it', () => {
    expect(resolveActiveStatus('Pending', MEESHO_TABS)).toBe('Pending')
    expect(resolveActiveStatus('Failed to Proceed', MEESHO_TABS)).toBe('Failed to Proceed')
  })

  it('falls back to All only when the platform genuinely lacks that tab', () => {
    // "Un Attended" is AJIO's; Meesho has no such state, so there is no tab to
    // highlight and no rows it could ever return.
    expect(resolveActiveStatus('Un Attended', MEESHO_TABS)).toBe('All')
  })

  it('restores the choice when they switch back', () => {
    // The fallback is a display decision, not a reset — the choice stays in
    // state, so returning to AJIO returns to where they were.
    const chosen = 'Resolved'

    expect(resolveActiveStatus(chosen, MEESHO_TABS)).toBe('All')
    expect(resolveActiveStatus(chosen, AJIO_TABS)).toBe('Resolved')
  })
})

/**
 * Which ROWS may be selected, on a tab that already allows selecting.
 *
 * The desktop checkbox has one consumer — Create Ticket — so a row that cannot
 * be filed has no business being tickable. The admin panel is deliberately
 * looser on POB ID because its checkbox also drives Master Sync, the one action
 * that repairs a POB-less AJIO row; it filters those out at dispatch instead.
 * Here there is nothing to repair, so the gate sits on the checkbox and
 * explains itself on hover.
 */
const row = (over: Partial<SelectableRow> = {}): SelectableRow => ({
  platform: 'Meesho',
  status: 'Pending',
  username: 'ops@example.com',
  returnAwb: '1490711725948834',
  pobId: '',
  subOrderNumber: '12345678_1',
  driveStatus: '',
  scriptStatus: 'Not Started',
  attempts: 0,
  ...over
})

describe('selectionBlockReason', () => {
  it('allows a row that carries everything its platform needs', () => {
    expect(selectionBlockReason(row())).toBeNull()
    expect(isRowSelectable(row())).toBe(true)
  })

  it('refuses a row with no marketplace account — there is no login to file it with', () => {
    expect(selectionBlockReason(row({ username: '   ' }))).toMatch(/account/i)
  })

  it('exempts Nykaa, which signs in with the company integration rather than a row account', () => {
    expect(selectionBlockReason(row({ platform: 'Nykaa', username: '' }))).toBeNull()
  })

  it('requires a POB ID on AJIO and nowhere else', () => {
    expect(selectionBlockReason(row({ platform: 'Ajio', pobId: '' }))).toMatch(/POB ID/)
    expect(selectionBlockReason(row({ platform: 'Ajio', pobId: 'POB-1' }))).toBeNull()
    // Meesho has no POB ID at all; a missing one must not block it.
    expect(selectionBlockReason(row({ pobId: '' }))).toBeNull()
  })

  it('treats a master-import placeholder as a missing POB ID', () => {
    // parseExcel writes String(cell), so a file without the column yields the
    // literal "undefined" — truthy, and a plain emptiness check waves it
    // through into a claim AJIO rejects.
    for (const placeholder of ['undefined', 'null', '-', 'N/A', ' NA ']) {
      expect(selectionBlockReason(row({ platform: 'Ajio', pobId: placeholder }))).toMatch(/POB ID/)
    }
  })

  it('holds an AJIO row back while its evidence links are still being made', () => {
    const ajio = { platform: 'Ajio', pobId: 'POB-1' }

    expect(selectionBlockReason(row({ ...ajio, driveStatus: 'pending' }))).toMatch(/Evidence/)
    expect(selectionBlockReason(row({ ...ajio, driveStatus: 'failed' }))).toMatch(/Evidence/)
    // "uploaded", and rows that predate the field, are ready.
    expect(selectionBlockReason(row({ ...ajio, driveStatus: 'uploaded' }))).toBeNull()
    expect(selectionBlockReason(row({ ...ajio, driveStatus: '' }))).toBeNull()
  })

  it('requires a sub-order number on Meesho and nowhere else', () => {
    // The Meesho claim form is filled and its ticket found by this number, so a
    // row without one cannot be filed at all.
    expect(selectionBlockReason(row({ subOrderNumber: '' }))).toMatch(/Sub-order/i)
    expect(selectionBlockReason(row({ platform: 'Ajio', pobId: 'P', subOrderNumber: '' }))).toBeNull()
  })

  it('refuses a claim that is being filed right now', () => {
    // A second dispatch means a second ticket for the same return — the one
    // action on this screen nobody can undo.
    expect(selectionBlockReason(row({ scriptStatus: 'Running' }))).toMatch(/right now/)
  })

  it('refuses a claim that has given up — but only once it says so', () => {
    const failed = { status: 'Failed to Proceed' }

    expect(selectionBlockReason(row({ ...failed, attempts: 2 }))).toBeNull()
    expect(selectionBlockReason(row({ ...failed, attempts: CAP }))).toMatch(
      /retry limit/
    )
    // Rows can sit ABOVE the cap — the runner processed them before it existed
    // — so the message quotes the row's real count, not the cap.
    expect(selectionBlockReason(row({ ...failed, attempts: 7 }))).toContain('7 attempts')
  })

  // Developer mode's override lifts the cap and nothing else — a claim that is
  // running, or has no account to file with, is not something a retry fixes.
  it('lets developer mode re-file a capped Failed to Proceed claim, and nothing more', () => {
    const capped = row({ status: 'Failed to Proceed', attempts: CAP })
    const devMode = { allowCappedRetry: true }

    expect(selectionBlockReason(capped, devMode)).toBeNull()
    expect(isRowSelectable(capped, devMode)).toBe(true)
    expect(isRowSelectable(capped)).toBe(false)

    expect(selectionBlockReason({ ...capped, scriptStatus: 'Running' }, devMode)).toMatch(/being filed/)
    expect(selectionBlockReason({ ...capped, username: '' }, devMode)).toMatch(/account/i)
    expect(selectionBlockReason({ ...capped, platform: 'Ajio', pobId: '' }, devMode)).toMatch(/POB ID/)
  })

  it('leaves a Pending claim selectable however many attempts it carries', () => {
    // A Pending row showing three attempts is one whose promotion to "Failed to
    // Proceed" has not landed. Blocking on the count alone left an operator with
    // a claim they could neither run nor clear — which is what this is for.
    expect(selectionBlockReason(row({ status: 'Pending', attempts: CAP }))).toBeNull()
    expect(selectionBlockReason(row({ status: 'Pending', attempts: 9 }))).toBeNull()
  })

  it('names the first thing wrong, so the operator fixes one at a time', () => {
    expect(
      selectionBlockReason(row({ scriptStatus: 'Running', username: '', subOrderNumber: '' }))
    ).toMatch(/right now/)
  })

  /**
   * The return AWB, which every platform's claim begins from.
   *
   * THE ONE REQUIREMENT COMMON TO ALL NINE, and the one nothing checked. A row
   * with a blank AWB could be ticked and sent to Create Ticket, and would fail
   * deep inside whichever marketplace it belonged to — nine failures, eight
   * different spellings, one cause. Nykaa is the worst of them: it has no
   * field guards at all, so it files a ticket with an empty AWB and raises no
   * complaint whatsoever.
   */
  it('refuses a row with no return AWB, on every platform', () => {
    for (const platform of [
      'Ajio', 'Myntra', 'Snapdeal', 'Meesho', 'Flipkart',
      'Nykaa', 'Delhivery', 'Xbees', 'TataCliq'
    ]) {
      // Everything else filled, so only the AWB can be the reason — including
      // the fields those platforms need and the account Nykaa does not.
      const blank = row({
        platform,
        returnAwb: '',
        username: 'ops@example.com',
        pobId: 'DV00349597',
        subOrderNumber: '12345678_1'
      })

      expect(selectionBlockReason(blank), `${platform} allowed a claim with no AWB`).toMatch(
        /return AWB/i
      )
      expect(isRowSelectable(blank)).toBe(false)
    }
  })

  it('treats a master-data placeholder as no AWB at all', () => {
    // An import writes cells with String(cell), so a missing column arrives as
    // the literal "undefined" — truthy, and a plain emptiness check waves it
    // through into a claim the marketplace then rejects.
    for (const value of ['', '   ', 'undefined', 'null', '-', 'N/A']) {
      expect(
        selectionBlockReason(row({ returnAwb: value })),
        `"${value}" was accepted as an AWB`
      ).toMatch(/return AWB/i)
    }
  })

  it('checks the AWB before the account, because it is the deeper failure', () => {
    // Both missing: the AWB is what the claim is FOR. An operator told "no
    // account" would go and map one, then find there was never a return to
    // file against.
    expect(selectionBlockReason(row({ returnAwb: '', username: '' }))).toMatch(/return AWB/i)
  })

  /**
   * Evidence, which five platforms refuse a claim without.
   *
   * THE FAILURE THIS MOVES EARLIER. `EVIDENCE_MISSING` is thrown from inside
   * the claim flow — after a browser has opened, a marketplace session has been
   * spent and the return has been located. Every bit of it was knowable from
   * the row before anybody ticked the box.
   */
  it('refuses a Meesho claim with no barcode, product, waybill or video', () => {
    const noEvidence = row({ platform: 'Meesho', hasEvidence: false })

    expect(selectionBlockReason(noEvidence)).toMatch(/no evidence/i)
    expect(isRowSelectable(noEvidence)).toBe(false)
  })

  it('allows it as soon as one of the four is present', () => {
    // The core's guard is `!barcode && !product && !waybill && !video`, so ONE
    // is enough. Demanding more here would freeze a claim that would file.
    expect(selectionBlockReason(row({ platform: 'Meesho', hasEvidence: true }))).toBeNull()
  })

  it('says nothing when the caller never answered the question', () => {
    // `hasEvidence` is optional. A screen not yet taught to fill it in must not
    // have every row frozen — a gate whose default is "block" fails in the one
    // direction an operator cannot work around.
    const unanswered = row({ platform: 'Meesho' })

    delete (unanswered as { hasEvidence?: boolean }).hasEvidence

    expect(selectionBlockReason(unanswered)).toBeNull()
  })

  it('reads the evidence slots off the document, per platform', () => {
    // Meesho's four, as TrackVid-BE maps them into the claim config.
    expect(documentHasEvidence('meesho', {})).toBe(false)
    expect(documentHasEvidence('meesho', { barcodeImage: { fileKey: 'k' } })).toBe(true)
    expect(documentHasEvidence('meesho', { receivedProductImage_2: { fileKey: 'k' } })).toBe(true)
    expect(documentHasEvidence('meesho', { reverseWayBillImage: { fileKey: 'k' } })).toBe(true)
    expect(documentHasEvidence('meesho', { returnVideoLink: 'https://example.invalid/v.mp4' })).toBe(true)
  })

  it('treats a slot with no fileKey as empty', () => {
    // The document keeps `{ fileKey, createdAt }`, and BE filters on fileKey
    // before building a URL — `getObjectURL(undefined)` returns a truthy
    // ".../undefined", which is how an empty slot passes for a full one.
    expect(documentHasEvidence('meesho', { barcodeImage: {} })).toBe(false)
    expect(documentHasEvidence('meesho', { barcodeImage: { fileKey: '' } })).toBe(false)
    expect(documentHasEvidence('meesho', { returnVideoLink: 'undefined' })).toBe(false)
  })

  it('walks a nested slot, and reads a list', () => {
    expect(documentHasEvidence('myntra', { myntraClaimDetails: {} })).toBe(false)
    expect(
      documentHasEvidence('myntra', { myntraClaimDetails: { shippingLabelImage: { fileKey: 'k' } } })
    ).toBe(true)
    expect(
      documentHasEvidence('delhivery', { otherClaimDetails: { packingImages: [{ fileKey: 'k' }] } })
    ).toBe(true)
    expect(documentHasEvidence('delhivery', { otherClaimDetails: { packingImages: [] } })).toBe(false)
  })

  it('demands nothing of a platform whose flow demands nothing', () => {
    // AJIO files from its email template and Drive links — `driveLinksReady`
    // covers it. Nykaa has no evidence guard at all. Listing either here would
    // block a claim that files perfectly well.
    expect(documentHasEvidence('ajio', {})).toBe(true)
    expect(documentHasEvidence('nykaa', {})).toBe(true)
  })

  it('still allows a row that has one', () => {
    expect(selectionBlockReason(row({ returnAwb: '1490711725948834' }))).toBeNull()
    // Nykaa carries no per-claim account, and must not be blocked for it — but
    // it is still held to the AWB.
    expect(selectionBlockReason(row({ platform: 'Nykaa', username: '' }))).toBeNull()
  })
})
