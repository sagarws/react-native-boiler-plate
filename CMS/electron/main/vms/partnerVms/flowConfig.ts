import type { FlowConfig } from './types'

export { MIRRORED_PLATFORMS, normalisePlatform, shouldMirror } from '@shared/vms/partnerVms'

/**
 * How to operate Flipkart's VMS operator screen. Ported verbatim from
 * TrackVid-App @ c188745 (src/main/partnerVms/flowConfig.ts).
 *
 * TrackVid-App's PHASE 2 replaces this with a backend fetch: when their page is
 * redesigned the fix should be a config push, not a release. Until then this is
 * the shape that endpoint returns and the last-known-good fallback.
 *
 * Selectors were read off the live page (Ant Design) by TrackVid-App's team. A
 * wrong selector is the DEGRADED case, which is safe (we stop acting) but
 * useless — verify against the real DOM before a pilot on this app.
 */
export const DEFAULT_FLOW: FlowConfig = {
  version: 1,

  url: 'https://fkvms.synlabs.io/index.html#/operator/vms',
  route: '#/operator/vms',

  selectors: {
    awbInput: '#awbInput',
    feedIdInput: "input.ant-input[placeholder*='Feed Id' i]",
    connectButton: 'button.ant-btn-primary.ant-btn-lg',
    loggedOutSignal: "input[type='password']",
    appShellSignal: '.ant-menu-item',

    // CAREFUL. The blue scan icon in the top-right shares
    // `ant-btn-round ant-btn-primary ant-btn-lg` with Record AND comes first in
    // DOM order, so the obvious selector would click the wrong control every
    // time. `:not(.ant-btn-icon-only)` is what makes this unambiguous.
    recordButton: 'button.ant-btn-round.ant-btn-primary.ant-btn-lg:not(.ant-btn-icon-only)',
    disconnectButton: 'button.ant-btn-round.ant-btn-default.ant-btn-lg',

    // Appears only while their page is recording. This is what lets the
    // controller tell READY from MIRRORING, and what stops it clicking Record on
    // a recording that already started.
    recordingSignal: '.recordingDot',

    // Record and Stop are the same physical button. While recording it loses
    // `ant-btn-primary` and its label becomes "Stop".
    stopButton:
      'button.ant-btn-round.ant-btn-lg:not(.ant-btn-primary):not(.ant-btn-default):not(.ant-btn-icon-only)',

    // Their order-type tile is `<div>Forward</div>` - no id, no class, and it
    // relabels to "Return" when toggled. Addressed by label; the label doubles
    // as the current value.
    orderTypeToggle: { scope: 'span.ant-typography', anyOf: ['Forward', 'Return'] }
  },

  // Their "Automatic" mode starts recording the moment an AWB lands in the box.
  // The controller reads the recording signal back either way and only clicks
  // Record if nothing started — clicking blind would toggle an auto-started
  // recording straight back off and lose the video entirely.
  entryMethod: 'insertText',

  // Their page has an explicit Stop control: the clean way to end a recording
  // between orders, so the next order's footage is not appended to this AWB.
  parkStrategy: 'stopButton',

  timings: {
    probeMs: 3000,
    settleMs: 400,
    // Their page will not stop a clip until it is about ten seconds long
    // (measured by TrackVid-App: Stop clicks at 2.2s, 4.9s and 9.4s all took
    // effect at 11-12s). The budget clears their minimum plus time to notice.
    parkConfirmMs: 15000,
    // Their page takes a few seconds to spin up the camera and show the
    // recording dot after an AWB lands.
    recordConfirmMs: 8000
  }
}

/** The origin of the operator page — the only origin the view may use the camera from. */
export const flowOrigin = (flow: FlowConfig): string => new URL(flow.url).origin
