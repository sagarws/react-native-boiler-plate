import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseReturnRow,
  submitQcFail
} from '@trackvid/automation-core/platforms/tatacliq/claim-management/api-based-flow/claimApiFlow'
import {
  fileTataCliqClaim,
  planUploads
} from '@trackvid/automation-core/platforms/tatacliq/claim-management/api-based-flow/fileClaim'
import {
  needsSubReason,
  needsVideo,
  validateQcSelection
} from '@trackvid/automation-core/platforms/tatacliq/claim-management/common/qcReasons'
import { parseSlaveList, findSlave } from '@trackvid/automation-core/platforms/tatacliq/common/slaveSync'
import { probeTataCliqAwb } from '@trackvid/automation-core/platforms/tatacliq/account-mapping/api-based-flow/probeAwb'

/**
 * Tata CliQ's claim, at the points where getting it wrong is expensive.
 *
 * The portal is a JSP app: every response is HTML, so the claim's own
 * identifiers are read out of markup, and the QC vocabulary decides what the
 * claim is even allowed to say. Both are the kind of thing that fails quietly —
 * a claim that looks filed and has the wrong evidence, or none — so they are
 * pinned here rather than discovered on a seller's return.
 */

const quiet = { logger: { info: () => undefined, warn: () => undefined } }

describe("the portal's QC vocabulary", () => {
  it('gives a sub-reason to Wrong Product and to nothing else', () => {
    expect(needsSubReason('10')).toBe(true)

    for (const code of ['06', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20']) {
      expect(needsSubReason(code)).toBe(false)
    }
  })

  it('asks for no video on the six the portal does not ask footage for', () => {
    for (const code of ['06', '13', '14', '18', '19', '20']) expect(needsVideo(code)).toBe(false)
    for (const code of ['10', '11', '12', '15', '16', '17']) expect(needsVideo(code)).toBe(true)
  })

  it('refuses Wrong Product with no sub-reason, and names the options', () => {
    const verdict = validateQcSelection('10', '')

    expect(verdict.ok).toBe(false)

    if (verdict.ok) return

    expect(verdict.message).toContain('Other brand delivered')
  })

  it('drops a sub-reason inherited from a previously chosen reason', () => {
    // The portal's own page clears the select when the reason changes, so a
    // value carried over is one it would never send with this reason.
    expect(validateQcSelection('18', '01')).toEqual({ ok: true, reason: '18', subReason: null })
  })

  it('refuses a code the portal does not have', () => {
    expect(validateQcSelection('99', '').ok).toBe(false)
  })
})

describe('reading the return out of the portal HTML', () => {
  // The shape the eligibility response actually has: a header row whose cells
  // carry the same classes as the data row's, then the data row.
  const html = `
    <div class="col-12" id="finalTable">
      <div id="removeCIRInward_129602062267213" class="CNCNDRCIRHeader">
        <ul class="user-search row tableheading">
          <li class="width-srno">Sr.No</li>
          <li class="width-1 light-blue">Forward AWB</li>
          <li class="width-1">Invoice Number</li>
          <li class="width-1 revawbbuttton light-blue">Reverse AWB</li>
          <li class="width-1">CRM Ticket<br>Number</li>
          <li class="width-2 light-blue">Product Name</li>
        </ul>
        <ul class="user-search row imgHoverFullView">
          <li class="width-srno">1</li>
          <li class="width-1 light-blue">
            <a class="commonPopper FWD" id="commonPopper_14136861584362">14136861584362</a>
          </li>
          <li class="width-1">G3312926CA001853</li>
          <li class="width-1 revawbbuttton light-blue">
            <a class="commonPopper REV" id="commonPopper_2377760377949">2377760377949</a>
          </li>
          <li class="width-1"></li>
          <li class="width-2 light-blue">WROGN Mens Blue Relaxed Fit Solid Jeans</li>
        </ul>
        <input class="submit Inward" id="Inward_129602062267213" type="button" value="QC Fail" />
      </div>
    </div>`

  it('reads the ids off the elements, not off column positions', () => {
    expect(parseReturnRow(html)).toEqual({
      found: true,
      transId: '129602062267213',
      forwardAwb: '14136861584362',
      reverseAwb: '2377760377949',
      crmTicket: null,
      claimable: true,
      productName: 'WROGN Mens Blue Relaxed Fit Solid Jeans',
      invoiceNumber: 'G3312926CA001853'
    })
  })

  it('does not mistake the header row for the data row', () => {
    // The bug this guards: parsing the whole fragment read "CRM Ticket Number"
    // as the ticket and "Product Name" as the product, so every return looked
    // already claimed.
    const row = parseReturnRow(html)

    expect(row.crmTicket).not.toBe('CRM Ticket Number')
    expect(row.productName).not.toBe('Product Name')
  })

  it('reports a ticket in the row — the already-claimed guard', () => {
    const claimed = html.replace('<li class="width-1"></li>', '<li class="width-1">487554</li>')

    expect(parseReturnRow(claimed).crmTicket).toBe('487554')
  })

  it('answers found: false on anything else, rather than half a row', () => {
    expect(parseReturnRow('<div>nothing here</div>').found).toBe(false)
    expect(parseReturnRow('').found).toBe(false)
  })
})

describe('the slave list', () => {
  const html =
    '<ul class="slaveList"><li id="58020">wms-prozo-blr (129602-1101225062)</li>' +
    '<li id="58021">wms-new-del (129602-1101225099)</li></ul>'

  it('reads the id from the attribute and the code from the label', () => {
    expect(parseSlaveList(html)).toEqual([
      { id: '58020', name: 'wms-prozo-blr (129602-1101225062)', code: '129602-1101225062' },
      { id: '58021', name: 'wms-new-del (129602-1101225099)', code: '129602-1101225099' }
    ])
  })

  it('matches what a claim row calls a slave — by code, name or part of it', () => {
    const slaves = parseSlaveList(html)

    expect(findSlave(slaves, '129602-1101225062')?.id).toBe('58020')
    expect(findSlave(slaves, 'wms-new-del (129602-1101225099)')?.id).toBe('58021')
    expect(findSlave(slaves, 'wms-prozo-blr')?.id).toBe('58020')
    expect(findSlave(slaves, 'not-a-slave')).toBeNull()
  })
})

describe('planning the six uploads', () => {
  it('accepts a URL, a { url }, or bytes — the shapes its two callers send', () => {
    const planned = planUploads({
      productImage: 'https://s3/a.png',
      productCode: { url: 'https://s3/b.png' },
      brandMarking: { base64: 'aGk=' },
      packingSlip: 'https://s3/d.png'
    })

    expect(planned.missingRequired).toEqual([])
    expect(planned.ready.map((image: { slot: number }) => image.slot)).toEqual([1, 2, 3, 4])
  })

  it('names the starred slots it is missing, by the portal\'s own labels', () => {
    const planned = planUploads({ packingSlip: 'https://s3/d.png' })

    expect(planned.missingRequired).toEqual([
      'Product Image',
      'IMEI No./Sr. No./Product Code',
      'Brand/Company marking'
    ])
  })

  it('does not treat the two Additional slots as required', () => {
    const planned = planUploads({
      productImage: 'a',
      productCode: 'b',
      brandMarking: 'c',
      packingSlip: 'd'
    })

    expect(planned.missingRequired).toEqual([])
    expect(planned.ready).toHaveLength(4)
  })
})

describe('filing a claim: the refusals that happen before the portal is touched', () => {
  // Any call would throw, so reaching the page at all is a visible failure.
  const page = {
    evaluate: () => Promise.reject(new Error('the portal must not be reached'))
  }

  it('refuses a claim whose QC pair the portal would not accept', async () => {
    const result = await fileTataCliqClaim(
      page,
      { reverseAwb: '2377760377949', slaves: [{ id: '1', name: 'a' }], reason: '10' },
      quiet
    )

    expect(result.status).toBe('failed')
    expect(result.message).toContain('needs a sub-reason')
  })

  it('refuses a named slave that is not on the login, rather than picking one', async () => {
    // The bug this guards: falling back to "the only slave" made a typo'd name
    // file against a warehouse nobody chose — and succeed.
    const result = await fileTataCliqClaim(
      page,
      {
        reverseAwb: '2377760377949',
        slaveName: 'wms-typo',
        slaves: [{ id: '1', name: 'wms-prozo-blr' }],
        reason: '18'
      },
      quiet
    )

    expect(result.status).toBe('failed')
    expect(result.message).toContain('No slave named "wms-typo"')
  })

  it('says to sync when the login has no slaves at all', async () => {
    const result = await fileTataCliqClaim(
      page,
      { reverseAwb: '2377760377949', slaves: [], reason: '18' },
      quiet
    )

    expect(result.status).toBe('failed')
    expect(result.message).toContain('Sync slaves')
  })

  it('never throws for a marketplace answer — every outcome is a status', async () => {
    // Deliberately against the type. The contract requires a reverse AWB and a
    // reason, and this asserts the runtime guard behind it: the runners map a
    // STATUS onto their reporting, so a throw from here — from a caller with a
    // missing field, a stale config, a bug — would surface as an unhandled
    // error instead of a claim marked failed with a reason.
    const result = await fileTataCliqClaim(page, {} as never, quiet)

    expect(result.status).toBe('failed')
    expect(result.ticketId).toBeNull()
  })
})

describe('the submit', () => {
  /** A page whose in-page fetch answers with whatever the portal would. */
  const pageAnswering = (text: string, ok = true) => ({
    evaluate: vi.fn().mockResolvedValue({ status: ok ? 200 : 500, ok, text })
  })

  it('reads the ticket out of "{id}_Sucess" — the portal\'s own spelling', async () => {
    const result = await submitQcFail(pageAnswering('487554_Sucess'), {
      transId: '129602062267213',
      reason: '18'
    })

    expect(result).toEqual({ ok: true, ticketId: '487554', raw: '487554_Sucess' })
  })

  it('does not call a 200 without that marker a success', async () => {
    // A claim reported as filed with no ticket is the worst outcome available:
    // nothing retries it and the seller never gets their money.
    const result = await submitQcFail(pageAnswering('<html>session expired</html>'), {
      transId: '129602062267213',
      reason: '18'
    })

    expect(result.ok).toBe(false)
    expect(result.ticketId).toBeNull()
  })

  it('sends no sub-reason for a reason that takes none', async () => {
    const page = pageAnswering('487554_Sucess')

    await submitQcFail(page, { transId: '1', reason: '18', subReason: '01' })

    const url = String(page.evaluate.mock.calls[0]?.[1] ?? '')

    expect(url).toContain('qcFailCIRDD=18')
    expect(url).toContain('qcFailSubReasonCIRDD=&')
    // The portal sends both; so do we.
    expect(url).toContain('qcFail=18')
  })

  it('joins the uploaded file names into imagesList', async () => {
    const page = pageAnswering('487554_Sucess')

    await submitQcFail(page, {
      transId: '1',
      reason: '10',
      subReason: '01',
      imagesList: ['1_1.png', '1_2.png']
    })

    expect(String(page.evaluate.mock.calls[0]?.[1] ?? '')).toContain(
      'imagesList=1_1.png%2C1_2.png'
    )
  })
})

describe('sweeping the slaves for one AWB', () => {
  // The row the portal returns for the AWB the slave owns.
  const rowFor = (reverseAwb: string) => `
    <div id="removeCIRInward_129602062267213" class="CNCNDRCIRHeader">
      <ul class="user-search row tableheading"><li class="width-1">Forward AWB</li></ul>
      <ul class="user-search row imgHoverFullView">
        <li class="width-1 light-blue">
          <a class="commonPopper FWD" id="commonPopper_14136861584362">14136861584362</a>
        </li>
        <li class="width-1">G3312926CA001853</li>
        <li class="width-1 revawbbuttton light-blue">
          <a class="commonPopper REV" id="commonPopper_${reverseAwb}">${reverseAwb}</a>
        </li>
        <li class="width-1"></li>
        <li class="width-2 light-blue">WROGN Mens Blue Relaxed Fit Solid Jeans</li>
      </ul>
      <input class="submit Inward" id="Inward_129602062267213" type="button" value="QC Fail" />
    </div>`

  /**
   * A portal whose returns are owned by named slaves. Its whole point is that
   * the search answers for the slave the session was last SET to — which is
   * the behaviour the sweep exists for, and the thing a mock that ignored
   * `setSession` would hide.
   */
  const portal = (owners: Record<string, string>) => {
    const searched: string[] = []
    let selected = ''

    return {
      searched,
      evaluate: (_fn: unknown, url: string) => {
        if (url.includes('flag=setSession')) {
          selected = decodeURIComponent(new URL(url).searchParams.get('text') ?? '')
          searched.push(selected)

          return Promise.resolve(true)
        }

        if (url.includes('selectSearchFlagER')) {
          const owned = owners[selected]

          return Promise.resolve({
            status: 200,
            ok: true,
            text: owned ? rowFor(owned) : '<div id="finalTable"></div>'
          })
        }

        return Promise.reject(new Error(`unexpected call: ${url}`))
      }
    }
  }

  const slaves = [
    { id: '1', name: 'wms-prozo-blr', code: null },
    { id: '2', name: 'wms-new-del', code: null },
    { id: '3', name: 'wms-blr-2', code: null }
  ]

  it('stops at the slave that owns the AWB', async () => {
    const page = portal({ 'wms-new-del': '2377760377949' })
    const answer = await probeTataCliqAwb(page, { reverseAwb: '2377760377949', slaves }, quiet)

    expect(answer.found).toBe(true)
    expect(answer.slave?.name).toBe('wms-new-del')
    // The third warehouse is never asked. Each search is a round trip to a
    // portal behind Cloudflare, and claims arrive in batches from one slave.
    expect(page.searched).toEqual(['wms-prozo-blr', 'wms-new-del'])
  })

  it('brings back every field Refill wants from that one search', async () => {
    const page = portal({ 'wms-prozo-blr': '2377760377949' })
    const answer = await probeTataCliqAwb(page, { reverseAwb: '2377760377949', slaves }, quiet)

    expect(answer.forwardAwb).toBe('14136861584362')
    expect(answer.transId).toBe('129602062267213')
    expect(answer.crmTicket).toBeNull()
    expect(answer.claimable).toBe(true)
  })

  it('names the slaves it tried when the AWB is on none of them', async () => {
    const page = portal({})
    const answer = await probeTataCliqAwb(page, { reverseAwb: '2377760377949', slaves }, quiet)

    // A miss on one warehouse is a different fact from a miss on all three,
    // and `found: false` alone cannot tell a caller which it got.
    expect(answer.found).toBe(false)
    expect(answer.searched).toEqual(['wms-prozo-blr', 'wms-new-del', 'wms-blr-2'])
  })

  it('throws when a slave cannot be selected, rather than reporting a miss', async () => {
    // The session dying mid-sweep must not read as "not on this account": the
    // mapping run would move to the next login carrying a wrong answer, and
    // the claim would be filed against the wrong seller or not at all.
    const dead = {
      evaluate: (_fn: unknown, url: string) =>
        url.includes('flag=setSession')
          ? Promise.reject(new Error('Execution context destroyed'))
          : Promise.resolve({ status: 200, ok: true, text: '' })
    }

    await expect(
      probeTataCliqAwb(dead, { reverseAwb: '2377760377949', slaves }, quiet)
    ).rejects.toThrow('Could not switch to slave wms-prozo-blr')
  })

  it('says to sync rather than searching when the login has no slaves', async () => {
    const page = portal({})
    const answer = await probeTataCliqAwb(page, { reverseAwb: '2377760377949', slaves: [] }, quiet)

    expect(answer.found).toBe(false)
    expect(page.searched).toEqual([])
  })
})

describe('No Search Found', () => {
  const SLAVE_LIST = '<ul class="slaveList"><li id="1">wms-prozo-mumbai (129602-1)</li></ul>'

  const SEARCHED = [
    { id: '1', name: 'wms-prozo-mumbai' },
    { id: '2', name: 'wms-prozo-blr' }
  ]

  /** A portal that lists no return. `signedIn` and `switches` are what vary. */
  const portal = ({ signedIn = true, switches = true } = {}) => {
    const calls: string[] = []

    return {
      calls,
      evaluate: (_fn: unknown, target: string) => {
        calls.push(target)

        if (target.includes('selectSearchFlagER')) {
          return Promise.resolve({ status: 200, ok: true, text: '<div id="finalTable"></div>' })
        }

        if (target.includes('SlavesUnderSeller')) {
          return Promise.resolve(signedIn ? SLAVE_LIST : '')
        }

        return Promise.resolve(switches)
      }
    }
  }

  const warn = vi.fn()
  const logger = { logger: { info: vi.fn(), warn } }

  beforeEach(() => {
    warn.mockClear()
  })

  it('is TAT Expired once every slave has been searched', async () => {
    const page = portal()
    const result = await fileTataCliqClaim(
      page,
      { reverseAwb: '77255303720', slaves: SEARCHED, reason: '18' },
      logger
    )

    expect(result.status).toBe('not_found')
    expect(result.message).toBe('TAT Expired')
    expect(result.ticketId).toBeNull()
    expect(page.calls.filter(call => call.includes('selectSearchFlagER'))).toHaveLength(2)
    // The row carries one filterable string; which slaves were asked is logged.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('any of 2 slaves (wms-prozo-mumbai, wms-prozo-blr)'))
  })

  it('is TAT Expired on the slave the claim names, without trying the others', async () => {
    const page = portal()
    const result = await fileTataCliqClaim(
      page,
      { reverseAwb: '77255303720', slaves: SEARCHED, slaveName: 'wms-prozo-mumbai', reason: '18' },
      logger
    )

    expect(result.message).toBe('TAT Expired')
    expect(page.calls.filter(call => call.includes('selectSearchFlagER'))).toHaveLength(1)
  })

  it('stays a retryable failure when the session is dead', async () => {
    // A signed-out page also answers the search 200 with no row. Calling that
    // TAT Expired would close a claim that only needed a new session.
    const result = await fileTataCliqClaim(
      portal({ signedIn: false }),
      { reverseAwb: '77255303720', slaves: SEARCHED, reason: '18' },
      logger
    )

    expect(result.status).toBe('failed')
    expect(result.message).not.toContain('TAT Expired')
  })

  it('does not search when the portal refuses the slave switch', async () => {
    // It would be asking the previous slave, and read that miss as this one's.
    const page = portal({ switches: false })
    const result = await fileTataCliqClaim(
      page,
      { reverseAwb: '77255303720', slaves: SEARCHED, reason: '18' },
      logger
    )

    expect(result.status).toBe('failed')
    expect(result.message).toContain('Could not switch to slave wms-prozo-mumbai')
    expect(page.calls.some(call => call.includes('selectSearchFlagER'))).toBe(false)
  })
})
