/**
 * Types for the Flipkart VMS mirror — main-process side.
 *
 * Ported from TrackVid-App @ c188745 (src/main/partnerVms/types.ts). The shapes
 * that cross IPC live in shared/vms/partnerVms.ts and are re-exported here; the
 * flow-config shapes, which only the controller reads, stay in main.
 */
export type {
  CameraFormat,
  MirrorOutcome,
  MirrorRequest,
  MirrorState,
  MirrorStatus,
  ViewRect
} from '@shared/vms/partnerVms'

/** How the page is made to start recording once the AWB is in the box. */
export type EntryMethod =
  | 'insertText' // typing alone starts it (their "Automatic" mode)
  | 'insertText+enter' // typing then Enter
  | 'insertText+click' // typing then a click on Record

/**
 * How to end a recording on their side. All four are implemented and config
 * picks one — the answer costs a config change, not a release.
 */
export type ParkStrategy =
  | 'stopButton' // they have an explicit stop control
  | 'disconnect' // Disconnect finalises and uploads the in-flight video
  | 'sentinelAwb' // only a new AWB can end a recording
  | 'none' // do not park; every mirrored order logged contamination-risk

/**
 * Some of their controls are bare divs with no id and no class - the Automatic
 * and Forward tiles are literally `<div>Forward</div>`. CSS cannot select by
 * text, so those are addressed by scope plus label instead.
 */
export interface TextSelector {
  /** CSS narrowing the search, e.g. 'span.ant-typography'. */
  scope: string
  /** The labels this control cycles through, e.g. ['Forward', 'Return']. */
  anyOf: string[]
}

export interface FlowSelectors {
  awbInput: string
  recordButton: string
  /** Their Record button toggles into this while a recording is in flight. */
  stopButton?: string
  disconnectButton: string
  orderTypeToggle: string | TextSelector
  feedIdInput: string
  connectButton?: string
  recordingSignal: string
  loggedOutSignal: string
  /** Present only once logged in — their app shell nav. Distinguishes
   *  "logged in, wrong page" from "page unrecognised". */
  appShellSignal?: string
  errorCount?: string
}

export interface FlowConfig {
  version: number
  /** Full URL of the operator screen, including the hash route. */
  url: string
  /** Location hash that must match before any write action is allowed. */
  route: string
  selectors: FlowSelectors
  entryMethod: EntryMethod
  parkStrategy: ParkStrategy
  /** Only read when parkStrategy is 'sentinelAwb'. */
  sentinelAwb?: string
  timings: {
    probeMs: number
    settleMs: number
    parkConfirmMs: number
    /** How long to wait for their recording indicator to appear. */
    recordConfirmMs?: number
  }
  /** Configs newer than this client are ignored rather than half-applied. */
  minAppVersion?: string
}

/**
 * What the probe read off their page: which configured selectors matched
 * (null = the selector threw) and the location hash.
 */
export interface ProbeRead {
  hash?: unknown
  loggedOut?: boolean | null
  feedInput?: boolean | null
  awbInput?: boolean | null
  recording?: boolean | null
  appShell?: boolean | null
}
