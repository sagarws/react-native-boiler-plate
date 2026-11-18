import { describe, expect, it } from 'vitest'
import { JOB_HAS_REPORT, JOB_RECORDING, hasJobReport, recordsJob } from '@shared/constants/jobs'
import type { JobKind } from '@shared/types/jobs'

/**
 * Which jobs leave a record on this machine.
 *
 * The switch decides whether a finished run is written to the local database,
 * and for two of the three kinds that archive is the ONLY trace the run leaves
 * — a re-claim and a mapping sweep tell TrackVid nothing about the run itself.
 * So a kind missing from the table would silently stop being recorded, which is
 * the one failure nobody would notice until they went looking for the history.
 */

const EVERY_KIND: JobKind[] = [
  'ajio-bulk-claim',
  'myntra-re-claim',
  'account-map',
  'refill-data',
  'ajio-master-backup',
  'snapdeal-master-backup',
  'scheduled-run'
]

/** The kinds whose outcome is a list of rows worth exporting. */
const WITHOUT_REPORT: JobKind[] = [
  'ajio-master-backup',
  'snapdeal-master-backup',
  'scheduled-run'
]

describe('JOB_RECORDING', () => {
  it('names every job kind, so none can silently stop being recorded', () => {
    expect(Object.keys(JOB_RECORDING).sort()).toEqual([...EVERY_KIND].sort())
  })

  it('records all of them by default', () => {
    for (const kind of EVERY_KIND) expect(recordsJob(kind)).toBe(true)
  })

  it('reads the switch rather than assuming', () => {
    // How a machine that must not keep operator history turns one off.
    const original = JOB_RECORDING['account-map']

    JOB_RECORDING['account-map'] = false
    expect(recordsJob('account-map')).toBe(false)
    // The others are unaffected — the switch is per kind.
    expect(recordsJob('myntra-re-claim')).toBe(true)

    JOB_RECORDING['account-map'] = original
  })
})

/**
 * Which jobs have a spreadsheet worth saving.
 *
 * A registry rather than a check where the button is drawn, so the Jobs page
 * stays ignorant of what kinds exist. A kind missing from the table would take
 * the download button with it — or worse, offer one that exports nothing.
 */
describe('JOB_HAS_REPORT', () => {
  it('names every job kind', () => {
    expect(Object.keys(JOB_HAS_REPORT).sort()).toEqual([...EVERY_KIND].sort())
  })

  it('has no report for a backup — those rows went into the backup', () => {
    expect(hasJobReport('ajio-master-backup')).toBe(false)
    expect(hasJobReport('snapdeal-master-backup')).toBe(false)
  })

  it('has no report for a scheduled run — the work it started keeps its own', () => {
    // A scheduled Refill Data run still writes its own `refill-data` job with
    // every AWB it touched. Exporting this row would export a summary of that.
    expect(hasJobReport('scheduled-run')).toBe(false)
  })

  it('keeps one for every job whose outcome is a list of rows', () => {
    for (const kind of EVERY_KIND.filter(entry => !WITHOUT_REPORT.includes(entry))) {
      expect(hasJobReport(kind)).toBe(true)
    }
  })
})
