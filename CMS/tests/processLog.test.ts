import { describe, expect, it } from 'vitest'
import {
  processLine,
  processName,
  withProcessLog
} from '@trackvid/automation-core/common/processLog'

/**
 * The wording is the contract.
 *
 * This app and the automation server both print these lines, and the whole
 * point of building them in the core is that one `grep` finds a run on either
 * side. Asserting the sentence — rather than that a logger was called — is what
 * makes a reworded line a failing test instead of a silent divergence.
 */
describe('processLine', () => {
  it('reports a start and a close in the agreed wording', () => {
    expect(processLine('Snapdeal master import', 'started')).toBe(
      'Snapdeal master import has been started successfully'
    )
    expect(processLine('Snapdeal master import', 'closed')).toBe(
      'Snapdeal master import has been closed successfully'
    )
  })

  // The one deliberate deviation from the template: "has been failed
  // successfully" would read as a success at the exact moment the line matters
  // most, so a failure says it plainly and carries the reason.
  it('says a failure plainly rather than "failed successfully"', () => {
    expect(processLine('Ajio claim', 'failed', 'the portal rejected the sign-in')).toBe(
      'Ajio claim has failed — the portal rejected the sign-in'
    )
    expect(processLine('Ajio claim', 'failed')).toBe('Ajio claim has failed')
  })

  it('never prints an empty subject', () => {
    expect(processLine('', 'started')).toBe('Automation has been started successfully')
  })
})

describe('processName', () => {
  it('normalises the platform so one grep finds every run of it', () => {
    expect(processName('ajio', 'master import', 'seller@example.com')).toBe(
      'Ajio master import (seller@example.com)'
    )
    expect(processName('AJIO', 'master import')).toBe('Ajio master import')
  })

  it('omits the account when there is not one', () => {
    expect(processName('myntra', 'session capture', '   ')).toBe('Myntra session capture')
  })
})

describe('withProcessLog', () => {
  const sink = () => {
    const info: string[] = []
    const error: string[] = []

    return { info: (l: string) => info.push(l), error: (l: string) => error.push(l), info_: info, error_: error }
  }

  it('writes exactly one closing line for a run that completes', async () => {
    const logger = sink()

    await withProcessLog('Meesho master import', () => Promise.resolve('done'), { logger })

    expect(logger.info_).toEqual([
      'Meesho master import has been started successfully',
      'Meesho master import has been closed successfully'
    ])
    expect(logger.error_).toEqual([])
  })

  it('reports a throw as a failure and lets it through', async () => {
    const logger = sink()

    await expect(
      withProcessLog(
        'Meesho master import',
        () => Promise.reject(new Error('portal timed out')),
        { logger }
      )
    ).rejects.toThrow('portal timed out')

    expect(logger.error_).toEqual(['Meesho master import has failed — portal timed out'])
  })

  // The server's cron jobs are called without a `.catch()`, so rethrowing to
  // get an accurate line would trade a wrong sentence for a crash.
  it('can absorb the error it reports', async () => {
    const logger = sink()

    const result = await withProcessLog(
      'Ajio master import',
      () => Promise.reject(new Error('mongo unreachable')),
      { logger, rethrow: false }
    )

    expect(result).toBeUndefined()
    expect(logger.error_).toEqual(['Ajio master import has failed — mongo unreachable'])
  })

  it('never claims a close for a run that failed', async () => {
    const logger = sink()

    await withProcessLog('Ajio master import', () => Promise.reject(new Error('boom')), {
      logger,
      rethrow: false
    })

    expect(logger.info_).toEqual(['Ajio master import has been started successfully'])
  })
})
