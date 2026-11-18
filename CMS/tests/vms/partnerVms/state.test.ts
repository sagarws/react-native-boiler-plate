import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOW } from '@main/vms/partnerVms/flowConfig'
import {
  RESTORE_COOLDOWN_MS,
  STARTUP_GRACE_MS,
  classifyProbe,
  isFlowOrigin,
  isSameDocument,
  probeTargets,
  reportedState,
  shouldRestore
} from '@main/vms/partnerVms/state'

/** The controller's page-state decisions (TrackVid-App's probe / navigate), without a page. */
const wanted = probeTargets(DEFAULT_FLOW.selectors)

describe('probe classification', () => {
  it('probes only configured selectors', () => {
    expect(Object.keys(wanted).sort()).toEqual(['appShell', 'awbInput', 'feedInput', 'loggedOut', 'recording'])
    expect(Object.keys(probeTargets({ ...DEFAULT_FLOW.selectors, appShellSignal: '' }))).not.toContain('appShell')
  })

  it('reads the page in priority order', () => {
    expect(classifyProbe({ loggedOut: true, feedInput: true, awbInput: true }, wanted).state).toBe('LOGGED_OUT')
    expect(classifyProbe({ loggedOut: false, feedInput: true, awbInput: true }, wanted).state).toBe('NOT_CONNECTED')
    expect(classifyProbe({ awbInput: true, recording: false }, wanted).state).toBe('READY')
    expect(classifyProbe({ awbInput: true, recording: true }, wanted).state).toBe('MIRRORING')
    expect(classifyProbe({ appShell: true }, wanted).state).toBe('WRONG_SCREEN')
    expect(classifyProbe({}, wanted).state).toBe('DEGRADED')
  })

  it('calls a selector that THREW a mismatch, and names it', () => {
    expect(classifyProbe({ awbInput: null, recording: false }, wanted)).toEqual({ state: 'DEGRADED', broken: ['awbInput'] })
  })
})

describe('restoring the operator screen', () => {
  const base = { state: 'WRONG_SCREEN' as const, hash: '#/feeds', route: DEFAULT_FLOW.route, visible: false, lastRestoreAt: 0, now: 100_000 }

  it('restores a hidden page that drifted off the route', () => {
    expect(shouldRestore(base)).toBe(true)
    expect(shouldRestore({ ...base, state: 'DEGRADED' })).toBe(true)
  })

  it('never yanks a page the seller is looking at, except from the landing page', () => {
    expect(shouldRestore({ ...base, visible: true })).toBe(false)
    expect(shouldRestore({ ...base, visible: true, hash: '#/dashboard' })).toBe(true)
    expect(shouldRestore({ ...base, visible: true, hash: '#/' })).toBe(true)
  })

  it('leaves usable, on-route and recently-restored pages alone', () => {
    expect(shouldRestore({ ...base, state: 'READY' })).toBe(false)
    expect(shouldRestore({ ...base, hash: '#/operator/vms' })).toBe(false)
    expect(shouldRestore({ ...base, lastRestoreAt: base.now - RESTORE_COOLDOWN_MS + 1 })).toBe(false)
    expect(shouldRestore({ ...base, hash: undefined })).toBe(false)
  })
})

describe('startup grace', () => {
  it('reports BOOTING until the page has settled or the grace window passes', () => {
    expect(reportedState('WRONG_SCREEN', false, 0, STARTUP_GRACE_MS - 1)).toBe('BOOTING')
    expect(reportedState('WRONG_SCREEN', false, 0, STARTUP_GRACE_MS)).toBe('WRONG_SCREEN')
    expect(reportedState('LOGGED_OUT', true, 0, 10)).toBe('LOGGED_OUT')
  })
})

describe('navigation and origin helpers', () => {
  it('treats a hash-only change as same-document', () => {
    expect(isSameDocument('https://fkvms.synlabs.io/index.html#/dashboard', DEFAULT_FLOW.url)).toBe(true)
    expect(isSameDocument('about:blank', DEFAULT_FLOW.url)).toBe(false)
    expect(isSameDocument('', DEFAULT_FLOW.url)).toBe(false)
  })

  it('scopes camera permission to the operator page origin', () => {
    const origin = 'https://fkvms.synlabs.io'
    expect(isFlowOrigin('https://fkvms.synlabs.io/index.html#/operator/vms', origin)).toBe(true)
    expect(isFlowOrigin('https://fkvms.synlabs.io', origin)).toBe(true)
    expect(isFlowOrigin('https://evil.example/fkvms.synlabs.io', origin)).toBe(false)
    expect(isFlowOrigin('http://fkvms.synlabs.io/', origin)).toBe(false)
    expect(isFlowOrigin(undefined, origin)).toBe(false)
  })
})
