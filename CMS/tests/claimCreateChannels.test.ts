import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAIM_CREATE_CHANNELS,
  EVENT_CHANNELS,
  isAllowedChannel
} from '@shared/constants/channels'

/**
 * Create Claim's channels, and the three ways they can silently not work.
 *
 * A handler registered on a channel that is not on the allowlist THROWS at
 * startup — which is loud, and fine. The quiet failures are the other
 * direction: a channel declared and never handled (the renderer waits forever),
 * or one the renderer calls by a name nobody declared (the preload refuses it
 * and the form reports a generic error). Both are caught here.
 */

const read = (relative: string): string =>
  readFileSync(resolve(__dirname, '..', relative), 'utf8')

const handlers = read('electron/main/ipc/claimCreate.ipc.ts')
const rendererService = read('electron/renderer/services/claimCreate.service.ts')
const registration = read('electron/main/ipc/index.ts')

describe('the Create Claim channels', () => {
  it('are all on the shared allowlist', () => {
    for (const channel of Object.values(CLAIM_CREATE_CHANNELS)) {
      expect(isAllowedChannel(channel), channel).toBe(true)
    }
  })

  it('are invoke channels, never event channels', () => {
    // The two lists are deliberately disjoint: an invoke channel the renderer
    // could also subscribe to is a second, unvalidated way in.
    for (const channel of Object.values(CLAIM_CREATE_CHANNELS)) {
      expect(EVENT_CHANNELS.includes(channel), channel).toBe(false)
    }
  })

  it('every one has a handler in the main process', () => {
    for (const name of Object.keys(CLAIM_CREATE_CHANNELS)) {
      expect(handlers, name).toContain(`CLAIM_CREATE_CHANNELS.${name}`)
    }
  })

  it('every one is reachable from the renderer', () => {
    for (const name of Object.keys(CLAIM_CREATE_CHANNELS)) {
      expect(rendererService, name).toContain(`CLAIM_CREATE_CHANNELS.${name}`)
    }
  })

  it('the handlers are actually registered at startup', () => {
    // A file full of handlers nobody calls is the failure this catches: every
    // call would answer "no handler registered for channel".
    expect(registration).toContain('registerClaimCreateIpc()')
  })

  it('are named under one prefix, so an audit can find them', () => {
    for (const channel of Object.values(CLAIM_CREATE_CHANNELS)) {
      expect(channel.startsWith('claim-create:'), channel).toBe(true)
    }
  })

  it('include the three writes a claim needs and the file delete beside them', () => {
    // Named explicitly: dropping one of these would still pass every check
    // above, because the checks are all about consistency rather than coverage.
    expect(CLAIM_CREATE_CHANNELS.create).toBeTruthy()
    expect(CLAIM_CREATE_CHANNELS.update).toBeTruthy()
    expect(CLAIM_CREATE_CHANNELS.uploadImage).toBeTruthy()
    expect(CLAIM_CREATE_CHANNELS.deleteFile).toBeTruthy()
  })
})
