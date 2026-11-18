import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AJIO's ticket window: the ticket read into the shared shape, the core's
 * `getTicket`, and the rules in front of a reply — a comment, files, or both.
 *
 * The fixture is ticket 792589971166 as AJIO's castellan API returned it
 * (recorded 2026-10-26), trimmed.
 */

const providerOpen = vi.fn()
const providerReply = vi.fn()

vi.mock('@main/automations/registry', () => ({
  ticketThreadProvider: (platform: string) =>
    platform.toLowerCase() === 'ajio' ? { open: providerOpen, reply: providerReply } : null
}))

const { toTicketThread, humaniseKey } = await import(
  '@main/automations/platforms/ajio/claim-management/api-based-flow/ticketView'
)
const { openTicketThread, replyToTicketThread } = await import('@main/services/ticketThread.service')

const require_ = createRequire(import.meta.url)
const core = require_(
  '@trackvid/automation-core/platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow'
) as {
  getTicket: (page: unknown, input: { sellerId: string; ticketId: string }) => Promise<unknown>
  htmlToText: (html: string) => string
}

const TICKET = {
  ticketId: '792589971166',
  createdDate: '2026-10-21T19:09:31.272',
  status: 'REJECTED',
  issueType: 'RETURNS',
  orderId: '1251838268',
  ticketType: 'SPF',
  fulfilmentType: 'DROPSHIP',
  tenant: 'AJIO',
  description: 'Dear Support Team,\n\nForward CCTV Footage: https://drive.google.com/file/d/1c2B/view',
  priority: 'CRITICAL',
  storeName: 'KREVY FAB - 395010',
  issueTitle: 'Claiming SPF | Return Order ID: RT231544069',
  subIssueType: 'DIFFERENT BRAND PRODUCT RECEIVED',
  attachments: [
    {
      fileName: 'R2670327981AJI - Side Images.pdf',
      url: 'https://kapture-p-v2.storage.googleapis.com/14500/ticket/1026/1792/R2670327981AJI_-_Side_Images.pdf'
    },
    { fileName: 'bad.pdf', url: 'javascript:alert(1)' }
  ],
  resolvedBy: null,
  orderDetails: {
    customerOrderId: 'FN0254803972',
    forwardAwbNumber: '13670626712422',
    forwardInvoiceAmount: 832.04,
    returnAwbNumber: 'R2670327981AJI',
    quantity: 1,
    returnCarrier: 'SHADOWFAX'
  },
  comments: [
    {
      content: '1.Greetings, Seller<br /><br />The claim has been rejected.<br />Regards,<br />Team AJIO',
      authorName: 'Sunil Darur',
      authorType: 'AGENT',
      createdAt: '2026-10-22T17:03:15'
    },
    {
      content: 'Hi Team, any update on this ticket please?',
      authorName: 'vmsuser',
      authorType: 'SELLER',
      createdAt: '2026-10-26T13:31:50.925155268'
    }
  ]
}

describe('toTicketThread (AJIO)', () => {
  const thread = toTicketThread(TICKET, '792589971166', core.htmlToText)

  it('reads the ticket the portal window shows', () => {
    expect(thread?.status).toBe('REJECTED')
    expect(thread?.title).toBe('Claiming SPF | Return Order ID: RT231544069')
    expect(thread?.description).toContain('Forward CCTV Footage: https://drive.google.com/')
  })

  it('turns AJIO comment HTML into text and puts the seller on the right', () => {
    expect(thread?.comments).toEqual([
      {
        author: 'Sunil Darur',
        mine: false,
        at: '2026-10-22T17:03:15',
        text: '1.Greetings, Seller\n\nThe claim has been rejected.\nRegards,\nTeam AJIO'
      },
      { author: 'You', mine: true, at: '2026-10-26T13:31:50.925155268', text: 'Hi Team, any update on this ticket please?' }
    ])
  })

  it('keeps only https attachment links', () => {
    expect(thread?.attachments).toEqual([
      {
        name: 'R2670327981AJI - Side Images.pdf',
        url: 'https://kapture-p-v2.storage.googleapis.com/14500/ticket/1026/1792/R2670327981AJI_-_Side_Images.pdf'
      },
      { name: 'bad.pdf', url: null }
    ])
  })

  it('shows every value: ticket fields, the order, and anything else AJIO sends', () => {
    const byTitle = Object.fromEntries((thread?.sections ?? []).map((section) => [section.title, section.fields]))

    expect(byTitle.Ticket).toContainEqual({ label: 'Sub issue type', value: 'DIFFERENT BRAND PRODUCT RECEIVED' })
    expect(byTitle.Ticket?.map((field) => field.label)).not.toContain('Resolved by')
    expect(byTitle['Order details']).toContainEqual({ label: 'Forward awb number', value: '13670626712422' })
    expect(byTitle['Order details']).toContainEqual({ label: 'Forward invoice amount', value: '832.04' })
    expect(byTitle.Other).toEqual([{ label: 'Tenant', value: 'AJIO' }])
  })

  it('refuses an answer for a different ticket', () => {
    expect(toTicketThread(TICKET, '1', core.htmlToText)).toBeNull()
    expect(toTicketThread(null, '792589971166', core.htmlToText)).toBeNull()
  })

  it('humanises AJIO keys', () => {
    expect(humaniseKey('forwardAwbNumber')).toBe('Forward awb number')
    expect(humaniseKey('jioCode')).toBe('Jio code')
  })
})

describe('core getTicket', () => {
  const page = (status: number, json: unknown) => ({
    evaluate: vi.fn((_fn: unknown, url: string, method: string, headers: Record<string, string>) => {
      calls.push({ url, method, headers })

      return Promise.resolve({ status, json, text: JSON.stringify(json) })
    })
  })
  let calls: { url: string; method: string; headers: Record<string, string> }[] = []

  beforeEach(() => {
    calls = []
  })

  it('reads one ticket with the seller and tenant headers the portal sends', async () => {
    const ticket = await core.getTicket(page(200, { result: TICKET }), { sellerId: 'seller-1', ticketId: '792589971166' })

    expect(ticket).toEqual(TICKET)
    expect(calls[0]?.url).toBe('/malekith/castellan/api/v1/tickets/792589971166')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers).toMatchObject({ 'X-Tenant': 'AJIO', 'X-Tenant-Id': 'AJIO', 'x-seller-id': 'seller-1' })
  })

  it("throws with AJIO's own wording", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      core.getTicket(page(404, { errorMessage: 'Ticket not found' }), { sellerId: 's', ticketId: '1' })
    ).rejects.toThrow(/Ticket not found/)
  })
})

describe('ticketThread.service', () => {
  beforeEach(() => vi.clearAllMocks())

  const pdf = { name: 'proof.pdf', data: new Uint8Array([1, 2, 3]) }
  const reply = (override: Record<string, unknown>) =>
    replyToTicketThread({ platform: 'Ajio', username: 'a@b.c', ticket: '792589971166', text: '', files: [], ...override })

  it('refuses a ticket id that is not digits before any marketplace is touched', async () => {
    expect((await openTicketThread({ platform: 'Ajio', username: 'a@b.c', ticket: '../x' })).success).toBe(false)
    expect(providerOpen).not.toHaveBeenCalled()
  })

  it('refuses a platform with no ticket window', async () => {
    expect((await openTicketThread({ platform: 'Myntra', username: 'a@b.c', ticket: '1' })).success).toBe(false)
  })

  it('sends a comment on its own', async () => {
    providerReply.mockResolvedValue({ success: true, data: {} })

    await reply({ text: '  Any update?  ' })

    expect(providerReply).toHaveBeenCalledWith({ username: 'a@b.c', ticket: '792589971166', text: 'Any update?', files: [] })
  })

  it('sends files on their own, with the type taken from the extension', async () => {
    providerReply.mockResolvedValue({ success: true, data: {} })

    await reply({ files: [pdf, { name: 'shot.JPG', data: new Uint8Array([9]) }] })

    expect(providerReply).toHaveBeenCalledWith({
      username: 'a@b.c',
      ticket: '792589971166',
      text: '',
      files: [
        { name: 'proof.pdf', mimeType: 'application/pdf', data: pdf.data, video: false },
        { name: 'shot.JPG', mimeType: 'image/jpeg', data: new Uint8Array([9]), video: false }
      ]
    })
  })

  it('sends both together', async () => {
    providerReply.mockResolvedValue({ success: true, data: {} })

    expect((await reply({ text: 'See attached', files: [pdf] })).success).toBe(true)
  })

  it.each([
    ['neither a comment nor a file', {}],
    ['a type the portal does not take', { files: [{ name: 'run.exe', data: new Uint8Array([1]) }] }],
    ['a file over 10 MB', { files: [{ name: 'big.mp4', data: new Uint8Array(10 * 1024 * 1024 + 1) }] }],
    ['an empty file', { files: [{ name: 'empty.pdf', data: new Uint8Array(0) }] }],
    ['more than five files', { files: Array.from({ length: 6 }, () => pdf) }]
  ])('refuses %s', async (_label, override) => {
    expect((await reply(override)).success).toBe(false)
    expect(providerReply).not.toHaveBeenCalled()
  })
})
