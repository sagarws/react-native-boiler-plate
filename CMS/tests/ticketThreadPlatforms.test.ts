import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Meesho and Snapdeal in the ticket window — the same window as AJIO, their own
 * APIs. Fixtures are the recorded answers (2026-10-26), trimmed: Meesho ticket
 * 792752896625 and Snapdeal case 7793019767038.
 */

const providerOpen = vi.fn()
const providerReply = vi.fn()

vi.mock('@main/automations/registry', () => ({
  ticketThreadProvider: (platform: string) =>
    ['ajio', 'meesho', 'snapdeal'].includes(platform.toLowerCase()) ? { open: providerOpen, reply: providerReply } : null
}))

const meeshoView = await import('@main/automations/platforms/meesho/claim-management/api-based-flow/ticketView')
const snapdealView = await import('@main/automations/platforms/snapdeal/claim-management/api-based-flow/ticketView')
const { replyToTicketThread } = await import('@main/services/ticketThread.service')

const require_ = createRequire(import.meta.url)
const snapdealCore = require_(
  '@trackvid/automation-core/platforms/snapdeal/claim-management/api-based-flow/claimApiFlow'
) as { queryUploadUrl: (raw: string) => string }

const GCS = 'https://gcs-supl-xp-agent-support-aggregator-prd.storage.googleapis.com/TicketInputAttachments/9764'

const MEESHO_TICKET = {
  ticket_id: 792752896625,
  title: 'I have received wrong return',
  description: 'We sent new saree to customer , now we got old clothes in return',
  details: [
    { key: 'sub_order_number', type: 'action_single_text_box', label: 'Sub Order Number', value: '338182289811243648_1' },
    { key: 'packet_state', type: 'drop_down', label: 'State of the packet', value: 'tampered', selectedLabel: 'Tampered' },
    { key: 'barcode_image_link', type: 'img_file', label: 'Barcode Image', value: [`${GCS}/1/Screenshot_2.png`] },
    { key: 'attachments', type: 'img_file', label: 'Attachments', value: [`${GCS}/2/a.pdf`, 'javascript:alert(1)'] },
    { key: 'ticket_desc', type: 'text_area', label: 'Description', value: 'We sent new saree' }
  ],
  status: 'Open',
  supplier_id: 9764,
  updates: [
    { ticket_update: 'We have escalated your claim', created_at: '2026-10-23T16:24:58', entity_type: 'AGENT' },
    { ticket_update: 'Meesho support agent will share an update within 3 hours', created_at: '2026-10-23T16:24:57', entity_type: 'AGENT' },
    { ticket_update: 'Hi Team, any update?', created_at: '2026-10-26T10:00:00', entity_type: 'SUPPLIER' }
  ],
  created_at: '2026-10-23T16:24:57',
  category_title: 'Returns/RTO & Exchange',
  subOrderNum: '338182289811243648_1',
  estimated_response_time: '2026-10-30T16:24:57',
  enable_reply_workflow: true,
  feedback: { enable: false }
}

describe('toTicketThread (Meesho)', () => {
  const thread = meeshoView.toTicketThread(MEESHO_TICKET, '792752896625')

  it('reads the claim form into Details rows, dropdowns by their label', () => {
    expect(thread?.sections.find((section) => section.title === 'Claim details')?.fields).toEqual([
      { label: 'Sub Order Number', value: '338182289811243648_1' },
      { label: 'State of the packet', value: 'Tampered' }
    ])
  })

  it('lists image and file fields as evidence under their own labels, https only', () => {
    expect(thread?.attachments).toEqual([
      { name: 'Barcode Image', url: `${GCS}/1/Screenshot_2.png` },
      { name: 'Attachments 1', url: `${GCS}/2/a.pdf` },
      { name: 'Attachments 2', url: null }
    ])
  })

  it('reads the updates oldest first, the supplier on the right', () => {
    expect(thread?.comments.map((comment) => [comment.author, comment.mine])).toEqual([
      ['Meesho', false],
      ['Meesho', false],
      ['You', true]
    ])
    expect(thread?.comments[0]?.text).toBe('Meesho support agent will share an update within 3 hours')
  })

  it('takes a reply only when Meesho says so', () => {
    expect(thread?.canReply).toBe(true)
    expect(meeshoView.toTicketThread({ ...MEESHO_TICKET, enable_reply_workflow: false }, '792752896625')?.canReply).toBe(false)
  })

  it('refuses an answer for a different ticket', () => {
    expect(meeshoView.toTicketThread(MEESHO_TICKET, '1')).toBeNull()
  })
})

const S3 = 'https://snapdeal-sf-prod-mum.s3.ap-south-1.amazonaws.com'

const SNAPDEAL_CASE = {
  success: true,
  noOfReopens: 0,
  caseReopened: false,
  tktCase: {
    ticketSFDCId: '1227539381',
    ticketNumber: '7793019767038',
    subject: 'Returns-Issue with return-Dispute returned product',
    subCategoryName: 'Issue with return',
    subCategoryId: 'Issue with return',
    status: 'Pending',
    problemAreaName: 'Dispute returned product',
    createdDate: '2026-10-26T18:32:00',
    categoryName: 'Returns',
    caseSummary: 'Returns',
    videoLink: `${S3}/sfRCVideoAttachments/2026-10-26/Sdda2c/video.mp4`
  },
  lstCaseComments: [
    { createdDate: '2026-10-26 19:48:42', commentBody: 'Hi Team, any update on this ticket please?', commentator: 'System' },
    { createdDate: '2026-10-26 18:32:48', commentBody: 'Attaching customer and updating approval status', commentator: 'System' },
    { createdDate: '2026-10-26 20:00:00', commentBody: 'We are checking', commentator: 'Snapdeal Agent' }
  ],
  lstCaseAttachments: [{ url: `${S3}/sfRCAttachments/2026/44/a.png`, name: 'Attachment 1', createdDate: null }]
}

describe('toTicketThread (Snapdeal)', () => {
  const thread = snapdealView.toTicketThread(SNAPDEAL_CASE, '7793019767038')

  it('reads the case, its summary as the opening line', () => {
    expect(thread?.title).toBe('Returns-Issue with return-Dispute returned product')
    expect(thread?.status).toBe('Pending')
    expect(thread?.description).toBe('Returns')
  })

  it('orders comments oldest first; the seller ("System") on the right', () => {
    expect(thread?.comments.map((comment) => [comment.author, comment.text])).toEqual([
      ['You', 'Attaching customer and updating approval status'],
      ['You', 'Hi Team, any update on this ticket please?'],
      ['Snapdeal Agent', 'We are checking']
    ])
  })

  it('lists the files and the case video together', () => {
    expect(thread?.attachments).toEqual([
      { name: 'Attachment 1', url: `${S3}/sfRCAttachments/2026/44/a.png` },
      { name: 'Video', url: `${S3}/sfRCVideoAttachments/2026-10-26/Sdda2c/video.mp4` }
    ])
  })

  it('does not repeat id spellings of fields it already shows', () => {
    const labels = thread?.sections.flatMap((section) => section.fields.map((field) => field.label))

    expect(labels).toContain('Sub category')
    expect(labels).not.toContain('Sub category id')
  })

  it('carries the case video forward, and refuses another case', () => {
    expect(snapdealView.currentVideoLink(SNAPDEAL_CASE)).toBe(`${S3}/sfRCVideoAttachments/2026-10-26/Sdda2c/video.mp4`)
    expect(snapdealView.toTicketThread(SNAPDEAL_CASE, '1')).toBeNull()
  })

  it('strips the token Snapdeal puts in front of an uploaded link', () => {
    expect(snapdealCore.queryUploadUrl(`/N2CQLDnOc0= - ${S3}/sfRCAttachments/2026/44/1.png`)).toBe(
      `${S3}/sfRCAttachments/2026/44/1.png`
    )
    expect(snapdealCore.queryUploadUrl(`${S3}/v.mp4`)).toBe(`${S3}/v.mp4`)
  })
})

describe('reply rules per marketplace', () => {
  beforeEach(() => vi.clearAllMocks())

  const send = (platform: string, files: { name: string; data: Uint8Array }[], text = '') =>
    replyToTicketThread({ platform, username: 'a@b.c', ticket: '7793019767038', text, files })
  const bytes = (n: number) => new Uint8Array(n).fill(1)

  it('marks an MP4 as the comment video on Snapdeal, and as a plain file on Meesho', async () => {
    providerReply.mockResolvedValue({ success: true, data: {} })

    await send('Snapdeal', [{ name: 'proof.png', data: bytes(3) }, { name: 'unbox.mp4', data: bytes(3) }])
    await send('Meesho', [{ name: 'unbox.mp4', data: bytes(3) }])

    const videoFlags = providerReply.mock.calls.map(
      ([input]) => (input as { files: { video: boolean }[] }).files.map((file) => file.video)
    )

    expect(videoFlags).toEqual([[false, true], [false]])
  })

  it('refuses two videos in one Snapdeal comment', async () => {
    expect((await send('Snapdeal', [{ name: 'a.mp4', data: bytes(3) }, { name: 'b.mp4', data: bytes(3) }])).success).toBe(false)
    expect(providerReply).not.toHaveBeenCalled()
  })

  it('applies each platform its own types and sizes', async () => {
    // AJIO takes DOCX; Meesho does not.
    expect((await send('Meesho', [{ name: 'a.docx', data: bytes(3) }])).success).toBe(false)
    // AJIO stops at 10 MB; Meesho goes to 25 MB.
    expect((await send('Ajio', [{ name: 'a.pdf', data: bytes(10 * 1024 * 1024 + 1) }])).success).toBe(false)

    providerReply.mockResolvedValue({ success: true, data: {} })
    expect((await send('Meesho', [{ name: 'a.pdf', data: bytes(10 * 1024 * 1024 + 1) }])).success).toBe(true)
  })

  it('refuses a reply with neither text nor files, on every platform', async () => {
    for (const platform of ['Ajio', 'Meesho', 'Snapdeal']) {
      expect((await send(platform, [])).success).toBe(false)
    }
    expect(providerReply).not.toHaveBeenCalled()
  })
})
