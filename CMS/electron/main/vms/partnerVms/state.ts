import type { FlowSelectors, MirrorState, ProbeRead } from './types'

/**
 * The controller's decisions that do not need a page or Electron, so they are
 * unit-tested directly (tests/vms/partnerVms). Ported from the body of
 * TrackVid-App's PartnerVmsController.probe / navigate.
 */

/** How long a launch may look unsettled before its state is taken at face value. */
export const STARTUP_GRACE_MS = 40_000

/** At most one "put the operator screen back" navigation per this long. */
export const RESTORE_COOLDOWN_MS = 15_000

/**
 * Which selectors to probe. Only ones actually configured: an unset selector
 * means "not set up yet", and DEGRADED must mean "their page changed under us".
 */
export const probeTargets = (s: FlowSelectors): Record<string, string> => {
  const wanted: Record<string, string> = {}
  if (s.loggedOutSignal) wanted.loggedOut = s.loggedOutSignal
  if (s.feedIdInput) wanted.feedInput = s.feedIdInput
  if (s.awbInput) wanted.awbInput = s.awbInput
  if (s.recordingSignal) wanted.recording = s.recordingSignal
  if (s.appShellSignal) wanted.appShell = s.appShellSignal
  return wanted
}

/**
 * The page's state from one probe read. A configured selector that THREW is a
 * genuine mismatch (`broken`), and the controller stops acting.
 */
export const classifyProbe = (
  read: ProbeRead,
  wanted: Record<string, string>
): { state: MirrorState; broken: string[] } => {
  const broken = Object.keys(wanted).filter((k) => (read as Record<string, unknown>)[k] === null)
  if (broken.length) return { state: 'DEGRADED', broken }

  let state: MirrorState
  if (read.loggedOut === true) state = 'LOGGED_OUT'
  else if (read.feedInput === true) state = 'NOT_CONNECTED'
  else if (read.awbInput === true) state = read.recording === true ? 'MIRRORING' : 'READY'
  // Their nav is on screen, so the seller IS logged in, just on another page.
  else if (read.appShell === true) state = 'WRONG_SCREEN'
  else state = 'DEGRADED'
  return { state, broken: [] }
}

/**
 * Whether to navigate their page back to the operator screen.
 *
 * Only from WRONG_SCREEN / DEGRADED, only when the hash is off-route, at most
 * once per RESTORE_COOLDOWN_MS — and only while the tab is HIDDEN, except from
 * the post-login landing page (nobody works on the dashboard), so the seller is
 * never yanked off Feeds or Reports mid-task.
 */
export const shouldRestore = (input: {
  state: MirrorState
  hash: unknown
  route: string
  visible: boolean
  lastRestoreAt: number
  now: number
}): boolean => {
  const { state, hash, route, visible, lastRestoreAt, now } = input
  if (state !== 'DEGRADED' && state !== 'WRONG_SCREEN') return false
  if (typeof hash !== 'string') return false
  if (hash.includes(route)) return false
  if (now - lastRestoreAt <= RESTORE_COOLDOWN_MS) return false
  const onLandingPage = /#\/(dashboard)?$/.test(hash.trim())
  return !visible || onLandingPage
}

/**
 * What to report. Their app takes ~25 s from launch to a connected feed and
 * passes through screens that look like real faults; until it has been READY
 * or MIRRORING once, or the grace window passes, report BOOTING instead.
 */
export const reportedState = (
  next: MirrorState,
  hasSettled: boolean,
  enabledAt: number,
  now: number
): MirrorState => (!hasSettled && now - enabledAt < STARTUP_GRACE_MS ? 'BOOTING' : next)

/**
 * Whether going from `current` to `target` is a same-document (hash-only)
 * navigation, which fires `did-navigate-in-page` and never `did-finish-load`.
 * Unparseable / empty current URL → false: wait for a real load.
 */
export const isSameDocument = (current: string, target: string): boolean => {
  try {
    const a = new URL(current)
    const b = new URL(target)
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

/** Whether a permission request / check comes from the operator page's origin. */
export const isFlowOrigin = (url: string | undefined | null, origin: string): boolean => {
  if (!url) return false
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}
