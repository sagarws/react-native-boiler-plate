import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface NykaaFlow {
  mapNaykaaStatus: (status: unknown) => string | null
  NAYKAA_TO_CMS_STATUS: Record<string, string | null>
}

interface StatusRegistry {
  claimStatusesFor: (platform: string) => string[]
  CMS_STATUS: Record<string, string>
}

const flow = require_(
  '@trackvid/automation-core/platforms/nykaa/claim-management/api-based-flow/claimApiFlow'
) as NykaaFlow

const statuses = require_('@trackvid/automation-core/common/claimStatuses') as StatusRegistry

/**
 * Nykaa's disputes are Zoho Desk tickets, and Zoho lets the department name its
 * own states — so the set is open-ended and its spellings are not ours to
 * choose. An acceptance has arrived as both "Approved" and "Accepted", a
 * refusal as both "Rejected" and "Declined".
 *
 * The table of exact keys that used to do this read every unseen spelling as
 * "no status". What is pinned here is the two things that must hold however
 * Nykaa words it: a decision is never missed, and a decision is never invented.
 */

describe('a Nykaa ticket status becomes a CMS status', () => {
  it('keeps each lifecycle state as itself', () => {
    expect(flow.mapNaykaaStatus('Open')).toBe('Open')
    expect(flow.mapNaykaaStatus('In Progress')).toBe('In Progress')
    expect(flow.mapNaykaaStatus('Pending')).toBe('Pending')
    expect(flow.mapNaykaaStatus('On Hold')).toBe('On Hold')
    expect(flow.mapNaykaaStatus('Resolved')).toBe('Resolved')
    expect(flow.mapNaykaaStatus('Closed')).toBe('Closed')
  })

  it('reads both words for each decision', () => {
    expect(flow.mapNaykaaStatus('Rejected')).toBe('Rejected')
    expect(flow.mapNaykaaStatus('Declined')).toBe('Rejected')
    expect(flow.mapNaykaaStatus('Approved')).toBe('Approved')
    expect(flow.mapNaykaaStatus('Accepted')).toBe('Approved')
  })

  it('reads the decision first when a status carries both', () => {
    // "Closed - Rejected" is a refusal that happens to be closed. Filing it
    // under "finished" loses a claim somebody still has to argue.
    expect(flow.mapNaykaaStatus('Closed - Rejected')).toBe('Rejected')
    expect(flow.mapNaykaaStatus('closed_approved')).toBe('Approved')
  })

  it('does not care how the words are joined or cased', () => {
    // An underscore is a WORD character, so `\bapprov` never matches
    // `closed_approved` until the separators are normalised.
    expect(flow.mapNaykaaStatus('on-hold')).toBe('On Hold')
    expect(flow.mapNaykaaStatus('in_progress')).toBe('In Progress')
    expect(flow.mapNaykaaStatus('  REJECTED  ')).toBe('Rejected')
  })

  it('treats a reopened ticket as open again', () => {
    expect(flow.mapNaykaaStatus('Reopened')).toBe('Open')
  })

  it('says nothing about a status it does not know', () => {
    // Null LEAVES THE ROW ALONE. A state nobody has taught this app — Zoho
    // departments invent them — is not a reason to overwrite what the row says,
    // and guessing "Closed" from an unknown word would retire a live claim.
    expect(flow.mapNaykaaStatus('Waiting on Third Party')).toBeNull()
    expect(flow.mapNaykaaStatus('')).toBeNull()
    expect(flow.mapNaykaaStatus(null)).toBeNull()
    expect(flow.mapNaykaaStatus(undefined)).toBeNull()
  })

  it('only ever answers with a status Nykaa actually has a tab for', () => {
    // The mapping and the tab list are written in different files, and a status
    // with no tab is a row that vanishes from every filter on the page.
    const tabs = statuses.claimStatusesFor('nykaa')

    for (const status of Object.values(flow.NAYKAA_TO_CMS_STATUS)) {
      if (status !== null) expect(tabs).toContain(status)
    }
  })
})
