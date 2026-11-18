import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface MeeshoFileClaim {
  attachmentName: (awbNumber: unknown, tag: string) => string
}

interface MeeshoFlow {
  createTicket: unknown
}

const fileClaim = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/fileClaim'
) as MeeshoFileClaim

const { meeshoId } = require_('@trackvid/automation-core/platforms/meesho/common/identifiers') as {
  meeshoId: (value: unknown) => string
}

// Imported only to assert the two agree about what an identifier looks like.
void (require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/claimApiFlow'
) as MeeshoFlow)

/**
 * One claim, one spelling of its AWB.
 *
 * Observed 2026-09-18: a video reached Meesho as
 * "r2485756038fp_video_1789741986434.mp4" while the ticket it hung off carried
 * R2485756038FP, because the ticket payload went through `meeshoId` and the
 * file name did not. Everything an operator or a Meesho reviewer matches on —
 * the ticket fields, the uploaded file, the copy kept on this machine — has to
 * say the same thing.
 */

describe('an uploaded attachment is named with the AWB Meesho uses', () => {
  it('upper-cases the AWB the row happened to carry', () => {
    expect(fileClaim.attachmentName('r2485756038fp', 'video')).toBe('R2485756038FP_video')
  })

  it('agrees with the identifier the ticket payload is built from', () => {
    // The two are written in different files; this is the check that they
    // cannot drift, since drifting is exactly what produced the mismatch.
    for (const awb of ['r2485756038fp', 'VLR9988', ' mixedCase123 ']) {
      expect(fileClaim.attachmentName(awb, 'barcode')).toBe(`${meeshoId(awb)}_barcode`)
    }
  })

  it('trims what the sheet left around it', () => {
    expect(fileClaim.attachmentName('  vlr123  ', 'product_1')).toBe('VLR123_product_1')
  })

  it('keeps the tag, which is what says WHICH piece of evidence this is', () => {
    expect(fileClaim.attachmentName('vlr123', 'waybill')).toBe('VLR123_waybill')
    expect(fileClaim.attachmentName('vlr123', 'attach_2')).toBe('VLR123_attach_2')
  })

  it('still names something when the AWB is not a usable string', () => {
    // Evidence with an odd name beats no evidence: the upload must not throw
    // here, because the claim it belongs to is otherwise fileable.
    expect(() => fileClaim.attachmentName(null, 'video')).not.toThrow()
    expect(fileClaim.attachmentName(null, 'video')).toContain('video')
  })
})
